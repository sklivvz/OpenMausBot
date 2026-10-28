import { describe, expect, it } from "vitest";

import {
  applyTimeExtension,
  canStartEffect,
  inheritedTimeAllocation,
  isExplicitNewObjective,
  parseExplicitTimeAllocation,
  remainingMs,
  timeAllocationLine,
  timeAllocationState,
  updateTimeAllocation,
} from "./time-allocation.ts";

const NOW = Date.parse("2026-10-24T19:00:00Z");

describe("explicit time allocations", () => {
  it("records a missed commitment without stopping the requested work", () => {
    const start = parseExplicitTimeAllocation("YOU HAVE 5 SECONDS TO START GROCERY SHOPPING", { now: NOW })!;
    expect(timeAllocationState(start, NOW + 6_000)).toBe("missed");
    expect(canStartEffect(start, NOW + 6_000)).toBe(true);
    expect(canStartEffect(inheritedTimeAllocation(start), NOW + 6_000)).toBe(true);
    expect(timeAllocationLine(start, NOW + 6_000)).toContain("START COMMITMENT (missed)");

    const completion = parseExplicitTimeAllocation("You have 5 seconds to start and stop", { now: NOW })!;
    expect(timeAllocationState(completion, NOW + 6_000)).toBe("missed");
    expect(canStartEffect(completion, NOW + 6_000)).toBe(true);
    const line = timeAllocationLine(completion, NOW + 6_000);
    expect(line).toContain("TIME ALLOCATION (missed)");
    expect(line).toContain("continue the authorized work");
    expect(line).toContain("not a stop instruction");
  });

  it("records a person's duration and its source", () => {
    const allocation = parseExplicitTimeAllocation("YOU HAVE 60 SECONDS", { now: NOW, messageId: "m1" })!;
    expect(allocation).toMatchObject({
      sourceMessageId: "m1", sourceText: "YOU HAVE 60 SECONDS", startedAt: NOW, sourceAt: NOW,
      deadlineAt: NOW + 60_000, originalDeadlineAt: NOW + 60_000, allocatedMs: 60_000, kind: "duration",
    });
  });

  it("finds a bounded directive anywhere in a person's message", () => {
    expect(parseExplicitTimeAllocation("Finish the packet in 10 minutes and report back", { now: NOW })).toMatchObject({
      deadlineAt: NOW + 10 * 60_000, kind: "duration",
    });
    expect(parseExplicitTimeAllocation("YOU HAVE 2 HOURS", { now: NOW })?.deadlineAt).toBe(NOW + 2 * 3_600_000);
  });

  it("does not turn ambient prose into a deadline", () => {
    expect(parseExplicitTimeAllocation("The meeting is in 5 minutes", { now: NOW })).toBeNull();
    expect(parseExplicitTimeAllocation("in 5 minutes", { now: NOW })).toBeNull();
    expect(parseExplicitTimeAllocation("I waited 30 minutes for the train", { now: NOW })).toBeNull();
    expect(parseExplicitTimeAllocation("I waited 30 minutes. Please send the report when ready.", { now: NOW })).toBeNull();
  });

  it("requires an unambiguous timestamp, not a local-looking date", () => {
    expect(parseExplicitTimeAllocation("Deadline is 2026-10-24T19:30:00Z", { now: NOW })?.deadlineAt)
      .toBe(Date.parse("2026-10-24T19:30:00Z"));
    expect(parseExplicitTimeAllocation("Deadline is 2026-10-24T19:30:00", { now: NOW })).toBeNull();
    expect(parseExplicitTimeAllocation("by 18:00 UTC", { now: NOW })?.deadlineAt)
      .toBe(Date.parse("2026-10-24T18:00:00Z") + 24 * 60 * 60_000);
  });

  it("preserves the original commitment across an explicit extension", () => {
    const first = parseExplicitTimeAllocation("YOU HAVE 60 SECONDS", { now: NOW })!;
    const extension = parseExplicitTimeAllocation("You have another 30 seconds", { now: NOW + 50_000, messageId: "m2" })!;
    const extended = applyTimeExtension(first, extension, NOW + 50_000);
    expect(extended.originalDeadlineAt).toBe(NOW + 60_000);
    expect(extended.deadlineAt).toBe(NOW + 80_000);
    expect(extended.extensions).toEqual([expect.objectContaining({
      sourceMessageId: "m2", previousDeadlineAt: NOW + 60_000, deadlineAt: NOW + 80_000,
    })]);
  });

  it("keeps a child inside the parent's deadline and does not reset on a later start", () => {
    const parent = parseExplicitTimeAllocation("YOU HAVE 10 MINUTES", { now: NOW })!;
    const child = inheritedTimeAllocation(parent);
    expect(child.deadlineAt).toBe(parent.deadlineAt);
    expect(remainingMs(child, NOW + 4 * 60_000)).toBe(6 * 60_000);
    expect(timeAllocationState(child, NOW + 9 * 60_000)).toBe("at_risk");
    expect(timeAllocationState(child, NOW + 10 * 60_000)).toBe("missed");
    expect(canStartEffect(child, NOW + 9 * 60_000)).toBe(true);
    expect(canStartEffect(child, NOW + 10 * 60_000)).toBe(true);
  });

  it("does not let a status question, continue, or an unrelated clarification extend or clear the clock", () => {
    const first = parseExplicitTimeAllocation("YOU HAVE 60 SECONDS", { now: NOW, messageId: "m1" })!;
    for (const followup of ["status?", "continue", "which file did you mean?", "can you clarify the last line?", "You have another 5 minutes."]) {
      const parsed = parseExplicitTimeAllocation(followup, { now: NOW + 50_000, messageId: "m2" });
      const next = updateTimeAllocation(first, followup, parsed, NOW + 50_000);
      if (followup === "You have another 5 minutes.") {
        expect(next?.deadlineAt).toBe(NOW + 50_000 + 5 * 60_000);
        expect(next?.extensions).toHaveLength(1);
      } else {
        expect(next).toEqual(first);
        expect(next?.extensions).toBeUndefined();
      }
    }
  });

  it("clears a stale allocation only for an explicitly identified new objective", () => {
    const first = parseExplicitTimeAllocation("YOU HAVE 60 SECONDS", { now: NOW, messageId: "m1" })!;
    expect(isExplicitNewObjective("status?")).toBe(false);
    expect(isExplicitNewObjective("continue")).toBe(false);
    expect(isExplicitNewObjective("start a new objective: launch the beta")).toBe(true);
    expect(updateTimeAllocation(first, "status?", null, NOW + 120_000)).toEqual(first);
    expect(updateTimeAllocation(first, "start a new objective: launch the beta", null, NOW + 120_000)).toBeNull();
  });

  it("keeps the original deadline across two reworks and later starts", () => {
    const parent = parseExplicitTimeAllocation("YOU HAVE 10 MINUTES", { now: NOW })!;
    const firstChild = inheritedTimeAllocation(parent);
    const secondChild = inheritedTimeAllocation(firstChild);
    for (const child of [firstChild, secondChild]) {
      expect(child.originalDeadlineAt).toBe(NOW + 10 * 60_000);
      expect(child.deadlineAt).toBe(NOW + 10 * 60_000);
    }
    expect(remainingMs(secondChild, NOW + 9 * 60_000)).toBe(60_000);
  });

  it("reserves integration time in the state and prompt", () => {
    const allocation = parseExplicitTimeAllocation("Finish in 10 minutes", { now: NOW })!;
    expect(timeAllocationState(allocation, NOW + 8 * 60_000, 2 * 60_000)).toBe("at_risk");
    expect(timeAllocationState(allocation, NOW + 7 * 60_000, 60_000)).toBe("within");
    const line = timeAllocationLine(allocation, NOW + 8 * 60_000, 2 * 60_000);
    expect(line).toContain("TIME ALLOCATION (at_risk)");
    expect(line).toContain("not a stop instruction");
    expect(line).toContain("Continue authorized work");
    expect(line).toContain("report a missed deadline honestly");
    expect(line).toContain("Only a new explicit person allocation changes the deadline");
  });

  it("rejects an unbounded or malformed allocation", () => {
    expect(parseExplicitTimeAllocation("you have 999 days", { now: NOW })).toBeNull();
    expect(parseExplicitTimeAllocation("you have -5 minutes", { now: NOW })).toBeNull();
    expect(parseExplicitTimeAllocation("you have 5 fortnights", { now: NOW })).toBeNull();
  });
});
