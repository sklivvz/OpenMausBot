import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Collector, health, report } from "../deploy/observability/collector.ts";
import { openRuntimeStore } from "./runtime/store.ts";
import type { Assignment } from "./runtime/types.ts";

const assignment = (id: string, parentId?: string): Assignment => ({
  id, rootId: parentId ?? id, parentId, depth: parentId ? 1 : 0,
  origin: { kind: "person", source: "chat", quote: "Prepare the launch" },
  requester: { kind: parentId ? "bot_turn" : "person", threadId: "room" },
  assignee: { botId: parentId ? "executor" : "lead", destination: { kind: "room_thread", groupId: "leadership", threadId: "room" } },
  mode: "work", reply: "resume", brief: "Prepare the launch", status: "queued", level: "ask", levelSource: "own",
  executions: 0, restarts: 0, createdAt: 1000, lastActivityAt: 1000, result: "", rework: false, version: 1,
});

function fixture(test: (f: any) => void) {
  const dir = mkdtempSync(join(tmpdir(), "omb-observation-"));
  const source = join(dir, "source");
  mkdirSync(source);
  writeFileSync(join(source, "bots.json"), JSON.stringify([{ id: "lead", name: "Lead", soul: "Private instructions", modelSelection: { model: "fixture" } }]));
  writeFileSync(join(source, "groups.json"), JSON.stringify([{ id: "leadership", memberIds: ["lead"] }]));
  const runtime = openRuntimeStore(join(source, "runtime.db"));
  const messages = new DatabaseSync(join(source, "messages.db"));
  messages.exec("CREATE TABLE messages(thread_id TEXT, id TEXT, at INTEGER, role TEXT, kind TEXT, json TEXT, PRIMARY KEY(thread_id,id))");
  const stateFile = join(dir, "observer", "observations.db");
  let observer = new Collector(source, stateFile, () => 10000);
  const put = (id: string, value: any) => messages.prepare(`INSERT INTO messages VALUES ('room', ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id,id) DO UPDATE SET json = excluded.json`).run(id, value.at ?? 1000, value.role ?? "bot", value.kind ?? "text", JSON.stringify({ id, at: 1000, role: "bot", kind: "text", ...value }));
  try {
    test({ runtime, messages, source, stateFile, get observer() { return observer; }, put,
      restart: () => { observer.close(); observer = new Collector(source, stateFile, () => 20000); } });
  } finally { observer.close(); runtime.close(); messages.close(); rmSync(dir, { recursive: true, force: true }); }
}

describe("passive observation", () => {
  it("preserves claimed success as unverified and follows actual child execution", () => fixture(f => {
    const root = assignment("root");
    f.runtime.insert(root, { kind: "enqueued", at: 1000 });
    f.runtime.insert(assignment("child", "root"), { kind: "enqueued", at: 1100 });
    root.status = "completed"; root.result = "Everything is verified and achieved"; root.finishedAt = 1200;
    f.runtime.update(root, { kind: "settled", at: 1200 });
    expect(f.observer.collect()).toEqual({ ok: true });
    const observed = report(f.observer.state, { rootId: "root" }, 2_000_000).runs[0]!;
    expect(observed.businessOutcome).toBe("unverified");
    expect(observed.nodes).toHaveLength(2);
    expect(observed.nodes[0]!.agentClaim).toBe(root.result);
    expect(observed.nodes[0]!.reviewSignals).toContain("completed_without_recorded_tool_calls");
    expect(observed.nodes[1]!.reviewSignals).toContain("no_recorded_start");
    expect(observed.nodes[1]!.reviewSignals).toContain("no_runtime_progress_for_30_minutes");
    expect(observed.nodes[0]!.events.map(e => e.kind)).toEqual(["enqueued", "settled"]);
  }));

  it("retains changed receipts across restart without duplicating history or changing sources", () => fixture(f => {
    f.runtime.insert(assignment("root"), { kind: "enqueued", at: 1000 });
    f.put("tool", { kind: "activity", tool: { name: "publish" } });
    expect(f.observer.collect().ok).toBe(true);
    const count = () => Number(f.observer.state.prepare("SELECT COUNT(*) AS n FROM revisions").get().n);
    const initial = count();
    f.restart();
    expect(f.observer.collect().ok).toBe(true);
    expect(count()).toBe(initial);
    f.put("tool", { kind: "activity", tool: { name: "publish", ok: false, output: "Rejected" } });
    expect(f.observer.collect().ok).toBe(true);
    expect(count()).toBe(initial + 1);
    expect(report(f.observer.state, { threadId: "room" }).threadContext[0]!.message.tool.ok).toBe(false);
    expect(f.runtime.events("root")).toHaveLength(1);
    expect(f.messages.prepare("SELECT COUNT(*) AS n FROM messages").get().n).toBe(1);
  }));

  it("pages source reads and eventually refreshes an older changed message", () => fixture(f => {
    for (let i = 0; i < 1100; i++) f.put(`m${i}`, { text: "initial" });
    expect(f.observer.collect().ok).toBe(true);
    expect(health(f.observer.state)["messages.caughtUp"]).toBe(false);
    for (let i = 0; i < 2; i++) expect(f.observer.collect().ok).toBe(true);
    expect(health(f.observer.state)["messages.caughtUp"]).toBe(true);
    f.put("m0", { text: "corrected later" });
    expect(f.observer.collect().ok).toBe(true);
    expect(JSON.parse(f.observer.state.prepare("SELECT json FROM snapshots WHERE key = 'room:m0'").get().json).text).toBe("corrected later");
    expect(f.observer.state.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE source = 'message'").get().n).toBe(1100);
  }));

  it("rolls back cursor advances on malformed evidence and recovers without skipping it", () => fixture(f => {
    f.runtime.insert(assignment("root"), { kind: "enqueued", at: 1000 });
    f.put("bad", { text: "placeholder" });
    f.messages.exec("UPDATE messages SET json = 'broken'");
    expect(f.observer.collect().ok).toBe(false);
    expect(health(f.observer.state).ok).toBe(false);
    expect(f.observer.state.prepare("SELECT COUNT(*) AS n FROM runtime_events").get().n).toBe(0);
    f.put("bad", { text: "repaired" });
    expect(f.observer.collect().ok).toBe(true);
    expect(health(f.observer.state, 10000).ok).toBe(true);
    expect(health(f.observer.state, 200000).ok).toBe(false);
    expect(f.observer.state.prepare("SELECT COUNT(*) AS n FROM runtime_events").get().n).toBe(1);
    expect(f.observer.state.prepare("SELECT COUNT(*) AS n FROM collection_errors").get().n).toBe(1);
  }));

  it("omits secret card contents, scrubs credential-shaped tool text and records oversized gaps", () => fixture(f => {
    f.put("secret", { kind: "secret", text: "sensitive opaque value", secret: { value: "another secret" } });
    f.put("tool", { kind: "activity", tool: { name: "HTTP", output: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456" } });
    f.put("large", { text: "x".repeat(300000) });
    expect(f.observer.collect().ok).toBe(true);
    const captured = JSON.stringify(report(f.observer.state, { threadId: "room" }));
    expect(captured).not.toContain("sensitive opaque value");
    expect(captured).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(captured).toContain("captureGap");
    expect(captured).not.toContain("Private instructions");
  }));

  it("keeps independent roots in one room separate and rejects invalid report sizes", () => fixture(f => {
    f.runtime.insert(assignment("one"), { kind: "enqueued", at: 1000 });
    f.runtime.insert(assignment("two"), { kind: "enqueued", at: 1000 });
    expect(f.observer.collect().ok).toBe(true);
    expect(report(f.observer.state, { rootId: "one" }).runs.map(r => r.rootId)).toEqual(["one"]);
    expect(report(f.observer.state, { threadId: "room", limit: 1 }).moreRuns).toBe(true);
    expect(() => report(f.observer.state, { limit: NaN })).toThrow("limit");
  }));
});
