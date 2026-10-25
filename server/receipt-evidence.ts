import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { sep } from "node:path";

import { connectorCallsIn, isOutboundTool, isReadOnlyTool } from "../shared/outbound.ts";

export interface ReceiptActivity {
  at: number;
  kind?: string;
  tool?: { name?: string; ok?: boolean; input?: string; output?: string };
}

export interface ReceiptVerificationConfig {
  /** Absolute directory written by the trusted execution-tools host. */
  receiptDir: string;
  /** HMAC key owned by the host, never supplied by a caller. */
  signingKey: Buffer;
}

export interface ReceiptContext {
  botId?: string;
  /** The current work thread id, which the receipt must name as its task. */
  taskId?: string;
  objectiveId?: string;
  operations?: readonly string[];
  channel?: string;
  account?: string;
  since?: number;
  config?: ReceiptVerificationConfig;
}

export interface ReceiptVerdict {
  ok: boolean;
  reason: string;
  evidence?: string;
}

const RECEIPT_TOOL = /(?:^|__)(record_execution_receipt)$/;
const ASSEMBLED_TOOL = /(?:^|__)(verify_assembled_output)$/;
const HEX64 = /^[a-f0-9]{64}$/;
const ID = /urn:li:[A-Za-z0-9:_-]+|https:\/\/[^\s"'<>]+|\b[A-Za-z0-9][A-Za-z0-9_-]{5,}\b/g;

const canonical = (value: unknown): string => JSON.stringify(value, (_, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item);
const hash = (value: unknown): string => createHash("sha256")
  .update(typeof value === "string" || Buffer.isBuffer(value) ? value : canonical(value)).digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parseOutput(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return;
  try {
    const parsed: unknown = JSON.parse(text);
    return record(parsed) ? parsed : undefined;
  } catch {
    return;
  }
}

function channelOf(label: string): string | undefined {
  const matches: Array<[RegExp, string]> = [
    [/linkedin/i, "linkedin"], [/bluesky/i, "bluesky"], [/threads/i, "threads"],
    [/twitter|(?:^|_)x(?:_|$)/i, "x"], [/mastodon/i, "mastodon"], [/hacker(?:_| )?news/i, "hackernews"],
    [/postmark|keila|gmail|email|newsletter/i, "email"], [/slack/i, "slack"],
  ];
  return matches.find(([pattern]) => pattern.test(label))?.[1];
}

/** Verify a receipt file signed by the trusted execution-tools host. */
function verifiedExecutionReceipt(
  output: Record<string, unknown>,
  context: ReceiptContext,
): ReceiptVerdict {
  const config = context.config;
  if (!config) return { ok: false, reason: "no trusted execution-receipt configuration is installed" };
  if (!context.botId || !context.taskId || !context.objectiveId) {
    return { ok: false, reason: "the current assignment has no stable bot/task/objective identity to bind evidence to" };
  }
  if (typeof output.receiptFile !== "string" || !output.receiptFile) {
    return { ok: false, reason: "the receipt output does not name its signed receipt file" };
  }
  let file: string;
  try {
    file = realpathSync(output.receiptFile);
    const root = realpathSync(config.receiptDir);
    if (file !== root && !file.startsWith(root + sep)) return { ok: false, reason: "the receipt file is outside the trusted receipt directory" };
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return { ok: false, reason: "the receipt file is not a bounded regular file" };
  } catch {
    return { ok: false, reason: "the receipt file is missing or unreadable" };
  }
  let receipt: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!record(parsed)) return { ok: false, reason: "the receipt file is not an object" };
    receipt = parsed;
  } catch {
    return { ok: false, reason: "the receipt file is not valid JSON" };
  }
  const signature = receipt.signature;
  if (typeof signature !== "string" || !HEX64.test(signature)) return { ok: false, reason: "the receipt has no valid signature" };
  const { signature: _signature, ...signed } = receipt;
  const expected = createHmac("sha256", config.signingKey).update(canonical(signed)).digest("hex");
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    return { ok: false, reason: "the receipt signature does not authenticate its contents" };
  }
  const receiptSha256 = receipt.receiptSha256;
  if (typeof receiptSha256 !== "string" || !HEX64.test(receiptSha256)) return { ok: false, reason: "the receipt has no valid content hash" };
  const { receiptSha256: _hash, ...body } = signed;
  if (hash(body) !== receiptSha256) return { ok: false, reason: "the receipt content hash is invalid" };
  if (receipt.schemaVersion !== 1 || receipt.producer !== "execution-receipts") return { ok: false, reason: "the receipt is not an execution-receipts v1 record" };
  const input = receipt.input;
  if (!record(input)) return { ok: false, reason: "the receipt has no bound input" };
  if (receipt.inputSha256 !== hash(input)) return { ok: false, reason: "the receipt input hash is invalid" };
  if (input.botId !== context.botId) return { ok: false, reason: "the receipt belongs to another bot" };
  if (input.taskId !== context.taskId) return { ok: false, reason: "the receipt belongs to another task" };
  if (input.objectiveId !== context.objectiveId) return { ok: false, reason: "the receipt belongs to another objective" };
  if (receipt.sourceComplete !== true) return { ok: false, reason: "the receipt source was incomplete" };
  if (receipt.outcome !== "progressed") return { ok: false, reason: `the receipt outcome is ${String(receipt.outcome ?? "missing")}, not observed progress` };
  if (receipt.acceptance !== "unverified" || receipt.businessOutcome !== "unverified") {
    return { ok: false, reason: "the receipt claims acceptance or a business outcome it cannot establish" };
  }
  const checkedAt = typeof receipt.checkedAt === "string" ? Date.parse(receipt.checkedAt) : NaN;
  if (!Number.isFinite(checkedAt) || checkedAt < (context.since ?? 0)) return { ok: false, reason: "the receipt is stale for this assignment" };
  return { ok: true, reason: "authenticated execution receipt bound to this task and objective", evidence: `receipt:${String(receipt.operationId)}` };
}

function assembledOutput(output: Record<string, unknown>, context: ReceiptContext): ReceiptVerdict {
  if (context.operations?.includes("publish")) return { ok: false, reason: "assembled-output proves local artifact preparation, not an external publication" };
  const artifact = output.artifact;
  if (!record(artifact) || typeof artifact.sha256 !== "string" || !HEX64.test(artifact.sha256)) {
    return { ok: false, reason: "the assembled-output result has no exact artifact hash" };
  }
  if (!Array.isArray(output.checks) || !output.checks.some(check => record(check) && check.status === "pass")) {
    return { ok: false, reason: "the assembled-output result has no passing check" };
  }
  if (output.status === "failed") return { ok: false, reason: "the assembled-output result failed" };
  if (output.publication_authorized === true) return { ok: false, reason: "an assembled-output result cannot authorize publication" };
  return { ok: true, reason: "assembled-output verified exact prepared artifact bytes", evidence: `artifact:${artifact.sha256}` };
}

function providerReadback(calls: readonly { at: number; name: string; output: Record<string, unknown> }[], context: ReceiptContext): ReceiptVerdict {
  const channel = context.channel?.toLowerCase();
  if (!channel) return { ok: false, reason: "the admitted deliverable names no channel to bind provider evidence to" };
  const prepared = new Map<string, string>();
  for (const call of calls) {
    if (channelOf(call.name) !== channel || !/_prepare(?:_post)?$/.test(call.name)) continue;
    const operation = call.output.operationId;
    const content = call.output.contentSha256 ?? call.output.manifestSha256;
    if (typeof operation === "string" && typeof content === "string" && HEX64.test(content)) prepared.set(operation, content);
  }
  for (const call of calls) {
    if (channelOf(call.name) !== channel) continue;
    const state = call.output.status ?? call.output.state;
    if (call.name.includes("bluesky_") && state === "verified") {
      const operation = call.output.operationId;
      if (typeof operation !== "string" || !prepared.has(operation) || call.output.contentSha256 !== prepared.get(operation)) continue;
      if (context.account && call.output.accountDid !== context.account) continue;
      if (typeof call.output.uri !== "string" || !call.output.uri.startsWith("at://")) continue;
      if (typeof call.output.cid !== "string" || !call.output.cid) continue;
      if (typeof call.output.permalink !== "string" || !call.output.permalink.startsWith("https://")) continue;
      return { ok: true, reason: "Bluesky connector readback verified the exact prepared content on the provider", evidence: call.output.uri };
    }
    if (call.name.includes("threads_") && state === "published_verified") {
      const operation = call.output.operationId;
      if (typeof operation !== "string" || !prepared.has(operation) || call.output.manifestSha256 !== prepared.get(operation)) continue;
      if (context.account && call.output.accountId !== context.account) continue;
      if (typeof call.output.postId !== "string" || !call.output.postId) continue;
      if (typeof call.output.permalink !== "string" || !/^https:\/\/(?:www\.)?threads\.(?:net|com)\//.test(call.output.permalink)) continue;
      return { ok: true, reason: "Threads connector readback verified the exact manifest on the provider", evidence: call.output.permalink };
    }
    if (call.name.includes("keila_prepare") && state === "verified" && !context.operations?.includes("publish")) {
      if (typeof call.output.operation_id !== "string" || typeof call.output.id !== "string" || typeof call.output.sha256 !== "string") continue;
      return { ok: true, reason: "Keila readback verified the saved provider object", evidence: `keila:${call.output.id}` };
    }
  }
  // A direct provider publish is not acceptance until a later read-only call sees
  // the same provider identifier. This is readback of a real tool result, not a
  // caller-supplied success flag.
  const published: Array<{ at: number; ids: Set<string> }> = [];
  for (const call of calls) {
    if (!isOutboundTool(call.name) || channelOf(call.name) !== channel) continue;
    const ids = new Set([...JSON.stringify(call.output).matchAll(ID)].map(match => match[0]));
    if (ids.size) published.push({ at: call.at, ids });
  }
  for (const call of calls) {
    if (!isReadOnlyTool(call.name) || channelOf(call.name) !== channel) continue;
    const text = JSON.stringify(call.output);
    for (const earlier of published) {
      if (earlier.at >= call.at) continue;
      const matched = [...earlier.ids].find(id => text.includes(id));
      if (matched) return { ok: true, reason: "a later read-only provider call returned the published identifier", evidence: matched };
    }
  }
  return { ok: false, reason: "no provider readback of the published object was recorded; an acknowledgement is not publication evidence" };
}

export function receiptDecision(messages: readonly ReceiptActivity[], context: ReceiptContext): ReceiptVerdict {
  const since = context.since;
  if (since === undefined || !Number.isFinite(since)) return { ok: false, reason: "the assignment has no start time to bind evidence to" };
  const calls: Array<{ at: number; name: string; output: Record<string, unknown> }> = [];
  for (const message of messages) {
    if (message.at < since || message.kind !== "activity" || !message.tool || message.tool.ok === false) continue;
    const name = message.tool.name ?? "";
    const output = parseOutput(message.tool.output);
    if (!output || !name) continue;
    // Composio's multi-execute wrapper is not itself a channel. Decode the
    // caller-visible slugs so the same readback rule applies to app tools.
    const input = parseOutput(message.tool.input);
    const names = name.startsWith("COMPOSIO_") && input
      ? connectorCallsIn(name, input).map(call => call.slug)
      : [name];
    for (const expanded of names) calls.push({ at: message.at, name: expanded, output });
  }
  const publication = context.operations?.includes("publish") === true;
  for (const call of calls) {
    if (!RECEIPT_TOOL.test(call.name)) continue;
    const verdict = verifiedExecutionReceipt(call.output, context);
    if (verdict.ok && !publication) return verdict;
    // A signed artifact receipt is not publication evidence; keep looking for
    // the provider readback rather than treating the extra receipt as a failure.
    // A malformed receipt is not a failure of a later valid provider readback;
    // keep scanning, but never accept the malformed record itself.
  }
  if (!publication) {
    for (const call of calls) {
      if (!ASSEMBLED_TOOL.test(call.name)) continue;
      const verdict = assembledOutput(call.output, context);
      if (verdict.ok) return verdict;
    }
  }
  if (publication) return providerReadback(calls, context);
  return { ok: false, reason: "no authenticated receipt or verified prepared-artifact check was recorded for this assignment" };
}

export function receiptRecorded(messages: readonly ReceiptActivity[], context: ReceiptContext): boolean {
  return receiptDecision(messages, context).ok;
}
