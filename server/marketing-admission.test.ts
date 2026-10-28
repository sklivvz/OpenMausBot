import { describe, expect, it } from "vitest";

import {
  AdmissionBounceGuard,
  PublicationAttempts,
  admissionBrief,
  effectWithinAdmission,
  outwardWithinAdmission,
  validateMarketingAdmission,
  type MarketingAdmission,
} from "./marketing-admission.ts";

const NOW = Date.parse("2026-10-24T19:00:00Z");
const single = (channel = "linkedin"): MarketingAdmission => ({
  objectiveId: "launch", briefRevision: "brief-v1", workflow: "single-channel",
  deliverables: [{ id: "post", channel, account: "fixture-account", acceptance: "provider permalink and exact copy hash" }],
  operations: ["prepare", "publish", "verify"],
});
const six = (): MarketingAdmission => ({
  objectiveId: "launch", briefRevision: "brief-v1", workflow: "multi-channel",
  deliverables: ["linkedin", "x", "mastodon", "bluesky", "threads", "hackernews"].map(channel => ({
    id: channel, channel, acceptance: "provider permalink",
  })),
  operations: ["prepare", "publish", "verify"],
});

describe("marketing admission", () => {
  it("admits one exact channel deliverable", () => {
    const result = validateMarketingAdmission(single(), { now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.admission.deliverables).toHaveLength(1);
  });

  it("bounces six channel jobs hidden in one admission before an executor starts", () => {
    const result = validateMarketingAdmission(six(), { now: NOW, owner: "Blake" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result).toMatchObject({ status: "needs_decomposition", code: "capability_not_demonstrated", ownership: "Blake", objectiveId: "launch" });
      expect(result.offending.channels).toEqual(["linkedin", "x", "mastodon", "bluesky", "threads", "hackernews"]);
      expect(result.nextAction).toContain("Blake");
      expect(JSON.stringify(result)).not.toContain("Darcy");
    }
  });

  it("keeps a demonstrated multi-step newsletter workflow valid", () => {
    const result = validateMarketingAdmission({
      objectiveId: "newsletter", briefRevision: "brief-v2", workflow: "newsletter-platform-production",
      deliverables: [
        { id: "template", acceptance: "saved template id and readback hash" },
        { id: "campaign", acceptance: "saved campaign id and rendered preview" },
      ],
      operations: ["install_template", "configure_campaign", "assemble", "verify"],
      estimatedDurationMs: 120_000,
    }, { now: NOW, deadlineAt: NOW + 10 * 60_000, reserveMs: 60_000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.timing).toMatchObject({ remainingMs: 9 * 60_000, estimate: "known" });
  });

  it("rejects an undeclared batch even when it names one channel shape", () => {
    const result = validateMarketingAdmission({ ...single(), workflow: "single-channel",
      deliverables: [single().deliverables[0]!, { id: "second", channel: "bluesky", acceptance: "permalink" }] }, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("too_many_deliverables");
  });

  it("refuses publication without the exact target account", () => {
    const { account: _account, ...deliverable } = single().deliverables[0]!;
    const result = validateMarketingAdmission({ ...single(), deliverables: [deliverable] }, { now: NOW, owner: "Blake" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result).toMatchObject({ status: "needs_information", code: "account_required", ownership: "Blake" });
  });

  it("refuses a child estimate that cannot fit inside the parent's remaining window", () => {
    const result = validateMarketingAdmission({ ...single(), estimatedDurationMs: 2 * 60_000 }, {
      now: NOW + 9 * 60_000, deadlineAt: NOW + 10 * 60_000, owner: "Blake",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("time_budget_insufficient");
  });

  it("counts multiple same-channel publishes in one wrapper and permits one publish attempt per deliverable", () => {
    const sixPublishes = {
      tools: Array.from({ length: 6 }, () => ({ tool_slug: "LINKEDIN_CREATE_LINKED_IN_POST" })),
    };
    expect(effectWithinAdmission(single(), "COMPOSIO_MULTI_EXECUTE_TOOL", sixPublishes))
      .toMatchObject({ ok: true, channels: ["linkedin"], publishCalls: 6 });
    for (const preparation of ["LINKEDIN_INITIALIZE_IMAGE_UPLOAD", "THREADS_CREATE_CONTAINER", "LINKEDIN_GET_POST_CONTENT"]) {
      expect(effectWithinAdmission(single(), preparation, {})).toMatchObject({ ok: true, publishCalls: 0 });
    }
    const attempts = new PublicationAttempts();
    expect(attempts.take("assignment-a", single(), 1)).toEqual({ ok: true });
    expect(attempts.take("assignment-a", single(), 1)).toMatchObject({ ok: false, reason: expect.stringContaining("already attempted") });
    expect(attempts.take("assignment-b", single(), 0)).toEqual({ ok: true });
    expect(attempts.take("assignment-c", single(), 6)).toMatchObject({ ok: false, reason: expect.stringContaining("several") });
  });

  it("returns a known-infeasible scope before dispatch instead of granting an extension", () => {
    const result = validateMarketingAdmission({ ...single(), estimatedDurationMs: 5 * 60_000 }, {
      now: NOW, deadlineAt: NOW + 2 * 60_000, reserveMs: 30_000, owner: "Blake",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result).toMatchObject({ status: "time_budget_insufficient", code: "time_budget_insufficient" });
      expect(result.reason).toContain("known-infeasible");
    }
  });

  it("keeps work authorized after the allocation ends and reports the miss", () => {
    const result = validateMarketingAdmission({ ...single(), estimatedDurationMs: 5 * 60_000 }, {
      now: NOW + 11 * 60_000, deadlineAt: NOW + 10 * 60_000, owner: "Blake",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timing).toMatchObject({ estimate: "known", missed: true });
      expect(result.note).toContain("remains authorized");
      expect(result.note).toContain("report the missed deadline");
      const brief = admissionBrief(result.admission, result.timing);
      expect(brief).toContain("Time allocation: missed");
      expect(brief).toContain("continue it");
    }
  });

  it("does not pretend an unknown duration is feasible", () => {
    const result = validateMarketingAdmission(single(), { now: NOW, deadlineAt: NOW + 10 * 60_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timing).toMatchObject({ estimate: "unknown", remainingMs: 9 * 60_000 });
      expect(result.note).toContain("feasibility is unknown");
    }
  });

  it("rejects a generic bundle name instead of a concrete channel", () => {
    const result = validateMarketingAdmission({ ...single("social") }, { now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result).toMatchObject({ status: "needs_information", code: "unknown_channel" });
  });

  it("rejects duplicate channels and operations outside the workflow", () => {
    const duplicate = validateMarketingAdmission({ ...single(), deliverables: [single().deliverables[0]!, single().deliverables[0]!] }, { now: NOW });
    expect(duplicate.ok).toBe(false);
    const outside = validateMarketingAdmission({ ...single(), operations: ["install_template"] }, { now: NOW });
    expect(outside.ok).toBe(false);
  });

  it("renders the admitted scope for the executor", () => {
    const result = validateMarketingAdmission(single(), { now: NOW, deadlineAt: NOW + 5 * 60_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const brief = admissionBrief(result.admission, result.timing);
      expect(brief).toContain("ADMITTED SCOPE");
      expect(brief).toContain("linkedin");
      expect(brief).toContain("Extra work");
    }
  });

  it("refuses a second channel or an opaque send before the effect starts", () => {
    expect(effectWithinAdmission(single(), "LINKEDIN_CREATE_LINKED_IN_POST", {})).toMatchObject({ ok: true });
    expect(effectWithinAdmission(single(), "BLUESKY_CREATE_POST", {})).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(effectWithinAdmission({ ...single(), operations: ["prepare", "verify"] }, "LINKEDIN_CREATE_LINKED_IN_POST", {})).toMatchObject({ ok: false, code: "out_of_scope" });
    expect(effectWithinAdmission(single(), "COMPOSIO_REMOTE_WORKBENCH", {})).toMatchObject({ ok: false, code: "scope_unverifiable" });
  });

  it("flags an outward action outside the admitted operations or channel", () => {
    expect(outwardWithinAdmission(single(), ["LINKEDIN_CREATE_LINKED_IN_POST"])).toBe("within");
    expect(outwardWithinAdmission({ ...single(), operations: ["prepare", "verify"] }, ["LINKEDIN_CREATE_LINKED_IN_POST"])).toBe("outside");
    expect(outwardWithinAdmission(single(), ["BLUESKY_CREATE_POST"])).toBe("outside");
    expect(outwardWithinAdmission(single(), ["COMPOSIO_PROXY_EXECUTE"])).toBe("unverifiable");
  });

  it("bounds repeated invalid dispatch and clears on a valid admission", () => {
    const guard = new AdmissionBounceGuard(2, 60_000);
    expect(guard.record("thread:liz", NOW)).toEqual({ count: 1, blocked: false });
    expect(guard.record("thread:liz", NOW + 1)).toEqual({ count: 2, blocked: true });
    guard.clear("thread:liz");
    expect(guard.record("thread:liz", NOW + 2)).toEqual({ count: 1, blocked: false });
  });
});
