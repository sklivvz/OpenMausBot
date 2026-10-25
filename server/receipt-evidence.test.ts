import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { receiptDecision, receiptRecorded, type ReceiptActivity, type ReceiptContext } from "./receipt-evidence.ts";

const canonical = (value: unknown): string => JSON.stringify(value, (_, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item);
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const signingKey = Buffer.alloc(32, 7);
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function signedReceipt(options: { taskId?: string; objectiveId?: string; checkedAt?: number; outcome?: string; sourceComplete?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "receipt-evidence-"));
  directories.push(directory);
  const input = {
    operationId: "op-1", botId: "liz", taskId: options.taskId ?? "thread-1", objectiveId: options.objectiveId ?? "launch",
    sourceVersion: "v1", nextStep: "verify", evidence: [{ kind: "artifact", id: "a", path: "/tmp/a" }],
  };
  const body = {
    schemaVersion: 1, producer: "execution-receipts", operationId: "op-1", inputSha256: digest(input),
    checkedAt: new Date(options.checkedAt ?? 200).toISOString(), input,
    sourceComplete: options.sourceComplete ?? true, outcome: options.outcome ?? "progressed",
    observations: [], gaps: [], changedEvidence: ["a"], supportedStatuses: ["in_progress"],
    businessOutcome: "unverified", acceptance: "unverified", association: "caller_supplied",
  };
  const receiptSha256 = digest(body);
  const signed = { ...body, receiptSha256 };
  const signature = createHmac("sha256", signingKey).update(canonical(signed)).digest("hex");
  const file = join(directory, "op-1.json");
  writeFileSync(file, JSON.stringify({ ...signed, signature }), { mode: 0o600 });
  return { file, directory, output: JSON.stringify({ operationId: "op-1", receiptFile: file, sourceComplete: true, receiptSha256 }) };
}

const receiptActivity = (at: number, output: string): ReceiptActivity =>
  ({ at, kind: "activity", tool: { name: "record_execution_receipt", ok: true, output } });
const base = (directory?: string): ReceiptContext => ({
  botId: "liz", taskId: "thread-1", objectiveId: "launch", operations: ["prepare"], since: 100,
  ...(directory ? { config: { receiptDir: directory, signingKey } } : {}),
});

describe("receipt evidence", () => {
  it("accepts an authenticated receipt bound to this bot, task and objective", () => {
    const receipt = signedReceipt();
    expect(receiptRecorded([receiptActivity(200, receipt.output)], base(receipt.directory))).toBe(true);
  });

  it("rejects a hash-shaped string or bot-provided sourceComplete flag without a signed file", () => {
    const forged = JSON.stringify({ operationId: "op-1", sourceComplete: true, receiptSha256: "a".repeat(64) });
    expect(receiptRecorded([receiptActivity(200, forged)], base())).toBe(false);
  });

  it("rejects another task, another objective, a stale receipt, an unresolved outcome and an incomplete source", () => {
    const otherTask = signedReceipt({ taskId: "thread-2" });
    expect(receiptRecorded([receiptActivity(200, otherTask.output)], base(otherTask.directory))).toBe(false);
    const otherObjective = signedReceipt({ objectiveId: "other" });
    expect(receiptRecorded([receiptActivity(200, otherObjective.output)], base(otherObjective.directory))).toBe(false);
    const stale = signedReceipt({ checkedAt: 50 });
    expect(receiptRecorded([receiptActivity(200, stale.output)], base(stale.directory))).toBe(false);
    const unresolved = signedReceipt({ outcome: "unverified" });
    expect(receiptRecorded([receiptActivity(200, unresolved.output)], base(unresolved.directory))).toBe(false);
    const incomplete = signedReceipt({ sourceComplete: false });
    expect(receiptRecorded([receiptActivity(200, incomplete.output)], base(incomplete.directory))).toBe(false);
  });

  it("rejects a receipt whose signed bytes were changed", () => {
    const receipt = signedReceipt();
    const stored = JSON.parse(readFileSync(receipt.file, "utf8"));
    stored.checkedAt = new Date(300).toISOString();
    writeFileSync(receipt.file, JSON.stringify(stored), { mode: 0o600 });
    expect(receiptRecorded([receiptActivity(200, receipt.output)], base(receipt.directory))).toBe(false);
  });

  it("accepts an assembled-output check for preparation but never for publication", () => {
    const output = JSON.stringify({
      artifact: { sha256: "a".repeat(64) }, checks: [{ id: "artifact_version", status: "pass" }],
      status: "needs_review", publication_authorized: false,
    });
    const activity = { at: 200, kind: "activity", tool: { name: "verify_assembled_output", ok: true, output } };
    expect(receiptRecorded([activity], base())).toBe(true);
    expect(receiptRecorded([activity], { ...base(), operations: ["publish"], channel: "linkedin" })).toBe(false);
  });

  it("requires provider readback, not a publish acknowledgement, for publication", () => {
    const acknowledgement = JSON.stringify({ status: "published", operationId: "op-b", sourceComplete: true });
    expect(receiptRecorded([{ at: 200, kind: "activity", tool: { name: "bluesky_publish_post", ok: true, output: acknowledgement } }], {
      ...base(), operations: ["publish"], channel: "bluesky",
    })).toBe(false);
    const prepared = JSON.stringify({ status: "prepared", operationId: "op-b", contentSha256: "b".repeat(64) });
    const verified = JSON.stringify({
      status: "verified", operationId: "op-b", contentSha256: "b".repeat(64), accountDid: "did:plc:fixture",
      uri: "at://did:plc:fixture/app.bsky.feed.post/abc", cid: "cid", permalink: "https://bsky.app/profile/fixture/post/abc",
    });
    const messages = [
      { at: 150, kind: "activity", tool: { name: "bluesky_prepare_post", ok: true, output: prepared } },
      { at: 200, kind: "activity", tool: { name: "bluesky_reconcile_post", ok: true, output: verified } },
    ];
    expect(receiptRecorded(messages, { ...base(), operations: ["publish"], channel: "bluesky", account: "did:plc:fixture" })).toBe(true);
    expect(receiptRecorded(messages, { ...base(), operations: ["publish"], channel: "bluesky", account: "did:plc:other" })).toBe(false);
  });

  it("accepts only a structured LinkedIn post object with matching author, never a person URN or generic words", () => {
    const activity = (at: number, name: string, value: unknown) =>
      ({ at, kind: "activity", tool: { name, ok: true, output: JSON.stringify(value) } });
    const context = { ...base(), operations: ["publish"] as const, channel: "linkedin", account: "urn:li:person:fixture" };
    const share = "urn:li:share:7519844322616258560";
    expect(receiptRecorded([
      activity(150, "LINKEDIN_CREATE_LINKED_IN_POST", { id: share }),
      activity(200, "LINKEDIN_GET_POST_CONTENT", { id: share, author: "urn:li:person:fixture" }),
    ], context)).toBe(true);
    expect(receiptRecorded([
      activity(150, "LINKEDIN_CREATE_LINKED_IN_POST", { success: true, results: ["success"], content: "ok" }),
      activity(200, "LINKEDIN_GET_POST_CONTENT", { success: true, results: ["success"], content: "ok", author: "urn:li:person:fixture" }),
    ], context)).toBe(false);
    expect(receiptRecorded([
      activity(150, "LINKEDIN_CREATE_LINKED_IN_POST", { id: "urn:li:person:fixture" }),
      activity(200, "LINKEDIN_GET_POST_CONTENT", { id: "urn:li:person:fixture", author: "urn:li:person:fixture" }),
    ], context)).toBe(false);
    expect(receiptRecorded([
      activity(150, "LINKEDIN_CREATE_LINKED_IN_POST", { id: share }),
      activity(200, "LINKEDIN_GET_POST_CONTENT", { id: share, author: "urn:li:person:other" }),
    ], context)).toBe(false);
    expect(receiptRecorded([
      activity(150, "LINKEDIN_CREATE_LINKED_IN_POST", { id: share }),
      activity(200, "LINKEDIN_GET_POST_CONTENT", { author: "urn:li:person:fixture", commentary: share }),
    ], context)).toBe(false);
  });

  it("does not attribute a multi-tool Composio wrapper result to every child", () => {
    const input = {
      tools: [{ tool_slug: "LINKEDIN_CREATE_LINKED_IN_POST" }, { tool_slug: "LINKEDIN_GET_POST_CONTENT" }],
    };
    const output = {
      content: [{ type: "text", text: { successful: true, data: { results: [
        { id: "urn:li:share:7519844322616258560" },
      ] } } }],
    };
    const context = { ...base(), operations: ["publish"] as const, channel: "linkedin", account: "urn:li:person:fixture" };
    const wrapper = { at: 150, kind: "activity", tool: {
      name: "COMPOSIO_MULTI_EXECUTE_TOOL", ok: true, input: JSON.stringify(input), output: JSON.stringify(output),
    } };
    const readback = { at: 200, kind: "activity", tool: {
      name: "LINKEDIN_GET_POST_CONTENT", ok: true,
      output: JSON.stringify({ id: "urn:li:share:7519844322616258560", author: "urn:li:person:fixture" }),
    } };
    expect(receiptRecorded([wrapper, readback], context)).toBe(false);
  });

  it("returns a bounded reason for a refused result", () => {
    const decision = receiptDecision([receiptActivity(200, JSON.stringify({ sourceComplete: true }))], base());
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("no authenticated receipt");
  });
});
