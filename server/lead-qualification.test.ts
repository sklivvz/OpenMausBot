import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Decider } from "./decider/index.ts";
import { appendLeadDecision, qualifyLead } from "./lead-qualification.ts";

const input = { lead_id: "lead-1", evidence: "Source: example.test; 42 developers", icp: "25–250 developers", icp_version: "GTM Bible 2026-10-31" };
const answer = (key: string, choice: string, pTop = 0.9, margin = 0.8, provider = "jev") => ({ ok: true, provider, latencyMs: 1, answers: { [key]: { type: "choice", choice, pTop, margin, probabilities: { [choice]: pTop } } } });
const decider = (ask: ReturnType<typeof vi.fn>) => ({ ask } as unknown as Pick<Decider, "ask">);

describe("lead qualification", () => {
  it("asks sufficiency first, then ICP match, and records inputs and both decisions", async () => {
    const ask = vi.fn().mockResolvedValueOnce(answer("sufficiency", "sufficient")).mockResolvedValueOnce(answer("match", "no"));
    const log = vi.fn();
    const result = await qualifyLead(input, decider(ask), log);
    expect(result.decision).toBe("no");
    expect(ask).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ input, decision: "no", sufficiency: expect.any(Object), match: expect.any(Object) }));
  });
  it("requests further research without judging the match when evidence is insufficient", async () => {
    const ask = vi.fn().mockResolvedValue(answer("sufficiency", "insufficient"));
    expect((await qualifyLead(input, decider(ask), vi.fn())).decision).toBe("needs_research");
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it("does not guess when Jev is uncertain, unavailable or another provider answers", async () => {
    for (const value of [answer("sufficiency", "sufficient", 0.52, 0.04), { ok: false, reason: "timeout" }, answer("sufficiency", "sufficient", 0.9, 0.8, "openrouter")]) {
      expect((await qualifyLead(input, decider(vi.fn().mockResolvedValue(value)), vi.fn())).decision).toBe("needs_review");
    }
  });
  it("does not return an unlogged decision", async () => {
    const ask = vi.fn().mockResolvedValueOnce(answer("sufficiency", "sufficient")).mockResolvedValueOnce(answer("match", "yes"));
    await expect(qualifyLead(input, decider(ask), vi.fn().mockRejectedValue(new Error("disk")))).rejects.toThrow("disk");
  });
  it("shares one timeout across both decisions and logs a timed-out second stage", async () => {
    vi.useFakeTimers();
    try {
      const ask = vi.fn().mockResolvedValueOnce(answer("sufficiency", "sufficient")).mockImplementationOnce((_seam, _state, _questions, options) => new Promise((resolve) => options.signal.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" }))));
      const log = vi.fn();
      const pending = qualifyLead(input, decider(ask), log);
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await pending).decision).toBe("needs_review");
      expect(ask).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ decision: "needs_review", match: expect.objectContaining({ ok: false, reason: "cancelled" }) }));
    } finally { vi.useRealTimers(); }
  });
  it("writes an inspectable private append-only decision log", async () => {
    const root = await mkdtemp(join(tmpdir(), "lead-log-"));
    try {
      await appendLeadDecision(root, { decision: "no" });
      await appendLeadDecision(root, { decision: "yes" });
      const path = join(root, "lead-qualification", "decisions.jsonl");
      expect((await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line))).toEqual([{ decision: "no" }, { decision: "yes" }]);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
