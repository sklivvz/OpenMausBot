import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ObjectiveController, validateCheckpoint, type ObjectiveConfig } from "./objective-controller.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "omb-objective-")); roots.push(root);
  const config: ObjectiveConfig = { id: "fixture", botId: "owner", threadId: "thread", approvalMode: "ask", objective: "Achieve the fixture outcome", instructions: "Use fixture data", initialLeafId: null, checkpointDirectory: join(root, "checkpoints") };
  let now = 1000;
  let phase = "working";
  let cancelled = false;
  let loseResponse = false;
  const sends: any[] = [];
  const api = async (method: string, path: string, body?: any) => {
    if (method === "POST") { sends.push(body); if (loseResponse) { loseResponse = false; throw new Error("response lost"); } return {}; }
    if (path.includes("/requests/")) return { phase, activeLeafId: "reply", messages: [{ sendId: sends.at(-1).sendId, requestCancelled: cancelled }] };
    return { activeLeafId: sends.length ? "reply" : null };
  };
  const make = () => new ObjectiveController(config, root, api, () => now);
  let controller = make();
  const checkpoint = (state = "ready", extra = {}) => {
    mkdirSync(join(config.checkpointDirectory, config.id), { recursive: true });
    const sendId = sends.at(-1).sendId;
    writeFileSync(join(config.checkpointDirectory, config.id, `${sendId}.json`), JSON.stringify({ sendId, state, progress: "One accepted fixture artifact", evidence: ["fixture-artifact"], next: "Verify next deliverable", ...extra }));
  };
  return { get controller() { return controller; }, sends, checkpoint, phase: (value: string) => { phase = value; }, time: (value: number) => { now = value; }, cancel: () => { cancelled = true; }, lose: () => { loseResponse = true; }, restart: () => { controller = make(); } };
}

it("continues after settlement, survives restart and never duplicates active work", async () => {
  const f = setup(); await f.controller.tick();
  for (let i = 0; i < 4; i++) await f.controller.tick();
  expect(f.sends).toHaveLength(1);
  f.checkpoint(); f.phase("settled"); f.restart(); await f.controller.tick();
  expect(f.controller.state.status).toBe("ready");
  await f.controller.tick(); expect(f.sends).toHaveLength(2);
  expect(f.sends[0].sendId).not.toBe(f.sends[1].sendId);
});

it("retries an ambiguous admission using the identical persisted id and body", async () => {
  const f = setup(); f.lose(); await f.controller.tick(); f.restart(); await f.controller.tick();
  expect(f.sends).toHaveLength(2); expect(f.sends[0]).toEqual(f.sends[1]);
});

it("retains a genuine dependency without provider polling and wakes at its deadline", async () => {
  const f = setup(); await f.controller.tick(); f.checkpoint("waiting", { dependencies: [{ outcome: "Publication", owner: "Reviewer", condition: "Signed review" }], wakeAt: 2000 }); f.phase("settled");
  await f.controller.tick(); f.restart();
  await f.controller.tick(); expect(f.sends).toHaveLength(1);
  f.time(2000); await f.controller.tick(); expect(f.sends).toHaveLength(2);
});

it("does not interpret operator Stop as idle or resume it after restart", async () => {
  const f = setup(); await f.controller.tick(); f.cancel(); f.phase("untracked"); await f.controller.tick();
  expect(f.controller.state.status).toBe("stopped"); f.restart(); await f.controller.tick(); expect(f.sends).toHaveLength(1);
});

it("keeps provider failure unfinished and visible instead of replaying side effects", async () => {
  const f = setup(); await f.controller.tick(); f.phase("untracked"); await f.controller.tick();
  expect(f.controller.state.status).toBe("maintenance"); await f.controller.tick(); expect(f.sends).toHaveLength(1);
});

it("bounds missing-checkpoint recovery and never declares the objective complete", async () => {
  const f = setup();
  for (let i = 0; i < 3; i++) { await f.controller.tick(); f.phase("settled"); await f.controller.tick(); }
  expect(f.controller.state.status).toBe("maintenance"); expect(f.sends).toHaveLength(3);
});

it("requires attributable dependencies and separates completion claims from acceptance", () => {
  expect(() => validateCheckpoint({ sendId: "one", state: "waiting", progress: "Blocked", next: "Wait", evidence: [], wakeAt: 2000 }, "one", 1000)).toThrow(/wait requires/);
  expect(() => validateCheckpoint({ sendId: "old", state: "ready", progress: "Done", next: "Continue", evidence: [] }, "one", 1000)).toThrow(/match/);
  expect(() => validateCheckpoint({ sendId: "one", state: "verification", progress: "Done", next: "Accept", evidence: [] }, "one", 1000)).toThrow(/evidence/);
});

it("detects repeated ready checkpoints instead of spending indefinitely on unchanged work", async () => {
  const f = setup();
  for (let i = 0; i < 4; i++) { await f.controller.tick(); f.checkpoint(); f.phase("settled"); await f.controller.tick(); }
  expect(f.controller.state.status).toBe("maintenance");
  expect(f.controller.state.detail).toContain("unchanged");
});

it("holds acceptance claims without converting them into completed business outcomes", async () => {
  const f = setup(); await f.controller.tick(); f.checkpoint("verification"); f.phase("settled"); await f.controller.tick();
  expect(f.controller.state.status).toBe("verification"); f.restart(); await f.controller.tick(); expect(f.sends).toHaveLength(1);
});
