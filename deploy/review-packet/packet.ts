import crypto from 'node:crypto';
import { z } from 'zod';
import { threadRefUrl } from '../../src/lib/thread-refs.ts';

const id = z.string().regex(/^[\w-]{1,200}$/);
const text = z.string().trim().min(1).max(2000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const source = z.object({ botId: id, threadId: id, messageId: id }).strict();
const artifact = z.object({
  id, version: text, label: text, sha256, source,
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('message_file'), path: text }).strict(),
    z.object({ kind: z.literal('external'), url: z.url().max(2000) }).strict(),
  ]),
}).strict();
const assembledReceipt = z.object({
  schema_version: z.literal(1), verifier_version: z.string(),
  artifact: z.object({ id, version: text, sha256, expected_sha256: sha256, source_ref: z.string().optional() }).strict(),
  contract_sha256: sha256, status: z.enum(['failed', 'needs_review']),
  checks: z.array(z.object({ id: text, status: z.enum(['pass', 'fail', 'unknown']), detail: z.string(), evidence: z.unknown().optional() }).strict()).max(100),
  approval: z.literal('not_assessed'), publication_authorized: z.literal(false),
}).strict();
export const packetSchema = z.object({
  taskId: id, briefRevision: text, decision: z.object({ question: text, source }).strict(),
  requiredArtifactIds: z.array(id).min(1).max(12), artifacts: z.array(artifact).min(1).max(12),
  verificationReceipts: z.array(assembledReceipt).max(12).default([]),
}).strict();
type Source = z.infer<typeof source>;
type Check = { id: string; status: 'pass' | 'fail' | 'unknown'; detail: string };
type Message = { id: string; kind: string; role: string; text?: string; at?: number };
type Bot = { id: string; threadId: string; tasks?: { threadId: string }[] };
const hash = (value: string | Uint8Array) => crypto.createHash('sha256').update(value).digest('hex');
const label = (value: string) => value.replace(/[[\]<>\r\n]/g, ' ').replace(/\\/g, '\\\\');
const target = (value: string) => '<' + value.replace(/</g, '%3C').replace(/>/g, '%3E') + '>';
const sourceUrls = (value: string) => (value.match(/https:\/\/[^\s<>"\\[\]()]+/g) ?? []).map(url => url.replace(/[.,;!?]+$/, ''));

export function packetFreshness(receipt: { checkedAt: string; expiresAt: string }, now = Date.now()) {
  const checked = Date.parse(receipt.checkedAt), expires = Date.parse(receipt.expiresAt);
  return Number.isFinite(checked) && Number.isFinite(expires) && checked <= now && now < expires && expires - checked <= 30 * 60 * 1000;
}

export function createReviewPacket({ appUrl = 'http://127.0.0.1:8799', fetchImpl = fetch, now = Date.now, reviewDestinations = [] as { botId: string; threadId: string }[] } = {}) {
  const origin = new URL(appUrl);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('Invalid configured app origin');
  const read = async (route: string, body?: unknown) => {
    const response = await fetchImpl(new URL(route, origin), { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!response.ok) { await response.body?.cancel(); throw Error(`Source unavailable: HTTP ${response.status}`); }
    if (!response.body) throw Error('Source returned no body');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 8 * 1024 * 1024) throw Error('Source exceeds 8 MiB limit');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    return Buffer.concat(chunks);
  };
  return async (raw: unknown) => {
    const input = packetSchema.parse(raw);
    const checks: Check[] = [];
    const add = (id: string, status: Check['status'], detail: string) => checks.push({ id, status, detail });
    const checkedAt = now();
    const bots = (JSON.parse((await read('/api/bots?messages=0')).toString()) as { bots: Bot[] }).bots;
    if (!Array.isArray(bots)) throw Error('Invalid app inventory');
    const messages = new Map<string, Promise<Message>>();
    const getMessage = (ref: Source) => {
      const key = JSON.stringify(ref);
      if (!messages.has(key)) messages.set(key, (async () => {
        const bot = bots.find(b => b.id === ref.botId);
        if (!bot || (bot.threadId !== ref.threadId && !bot.tasks?.some(t => t.threadId === ref.threadId))) throw Error('Source conversation does not belong to the selected bot');
        const result = JSON.parse((await read(`/api/threads/${ref.threadId}/messages?around=${ref.messageId}&limit=1`)).toString()) as { messages: Message[] };
        const message = result.messages?.find(m => m.id === ref.messageId);
        if (!message || message.kind !== 'text' || message.role !== 'bot' || typeof message.text !== 'string') throw Error('Source is not an existing bot delivery message');
        return message;
      })());
      return messages.get(key)!;
    };
    const artifacts = new Map(input.artifacts.map(item => [item.id, item]));
    if (artifacts.size !== input.artifacts.length || new Set(input.requiredArtifactIds).size !== input.requiredArtifactIds.length) add('unique_artifacts', 'fail', 'Artifact identities must be unique.');
    for (const required of input.requiredArtifactIds) if (!artifacts.has(required)) add(`required:${required}`, 'fail', 'A required artifact is missing.');
    const decisionUrl = threadRefUrl(input.decision.source);
    let decisionMessage: Message | undefined;
    try {
      decisionMessage = await getMessage(input.decision.source);
      add('decision_question', decisionMessage.text!.includes(input.decision.question) ? 'pass' : 'fail', 'The exact decision question must occur in the retrieved delivery message. Semantic suitability is not assessed.');
    } catch (error) { add('decision_question', 'unknown', error instanceof Error ? error.message : 'Decision source unavailable.'); }
    const knownDestination = reviewDestinations.some(ref => ref.botId === input.decision.source.botId && ref.threadId === input.decision.source.threadId);
    add('decision_destination', knownDestination ? 'pass' : 'unknown', knownDestination ? 'Decision is in a configured user-facing review destination. This does not prove the user has read it.' : 'Conversation is not a configured user-facing review destination. A bot’s currently selected thread does not establish human delivery.');
    const rendered: { id: string; version: string; sha256: string; label: string; url: string; sourceMessageId: string; accessibility: string }[] = [];
    for (const item of input.artifacts) {
      let href = threadRefUrl(item.source), access = 'unknown';
      try {
        const message = await getMessage(item.source);
        if (item.target.kind === 'message_file') {
          const bytes = await read(`/api/threads/${item.source.threadId}/messages/${item.source.messageId}/file`, { path: item.target.path });
          const matches = hash(bytes) === item.sha256;
          add(`artifact:${item.id}`, matches ? 'pass' : 'fail', matches ? 'Exact artifact bytes are served by the existing message-scoped file route.' : 'Served artifact bytes do not match the requested version hash.');
          access = matches ? 'message_file_verified' : 'hash_mismatch';
        } else {
          const url = new URL(item.target.url);
          if (url.protocol !== 'https:' || url.username || url.password || /(^|\.)todoist\.com$/i.test(url.hostname)) add(`artifact:${item.id}`, 'fail', 'Use the actual HTTPS artifact, not a task URL or credential-bearing destination.');
          else if (!sourceUrls(message.text!).includes(item.target.url)) add(`artifact:${item.id}`, 'fail', 'Artifact URL does not occur in the retrieved source message.');
          else { href = item.target.url; add(`artifact:${item.id}`, 'unknown', 'Native artifact URL was retrieved, but its current bytes, version and user access were not independently verified.'); }
        }
        const sameMessage = item.source.threadId === input.decision.source.threadId && item.source.messageId === input.decision.source.messageId;
        add(`delivery:${item.id}`, sameMessage || decisionMessage?.text?.includes(href) ? 'pass' : 'fail', 'Decision message must contain the artifact or an exact link to its source conversation/native artifact.');
      } catch (error) { add(`artifact:${item.id}`, 'unknown', error instanceof Error ? error.message : 'Artifact unavailable.'); }
      rendered.push({ id: item.id, version: item.version, sha256: item.sha256, label: item.label, url: href, sourceMessageId: item.source.messageId, accessibility: access });
    }
    for (const receipt of input.verificationReceipts) {
      const item = artifacts.get(receipt.artifact.id);
      const matches = item && receipt.artifact.version === item.version && receipt.artifact.sha256 === item.sha256 && receipt.artifact.expected_sha256 === item.sha256;
      add(`verification_binding:${receipt.artifact.id}`, matches ? 'pass' : 'fail', 'Verification receipt must reference the exact delivered artifact identity, version and hash. Receipt provenance is caller-supplied.');
      for (const check of receipt.checks) add(`verification:${receipt.artifact.id}:${check.id}`, check.status, check.detail);
      if (receipt.status === 'failed' && !receipt.checks.some(c => c.status === 'fail')) add(`verification:${receipt.artifact.id}:failed`, 'fail', 'Verifier reports failure.');
    }
    const status = checks.some(c => c.status === 'fail') ? 'incomplete' : checks.some(c => c.status === 'unknown') ? 'needs_review' : 'mechanically_ready';
    const markdown = [`Decision requested: ${input.decision.question}`, '', `[Open the decision conversation](${target(decisionUrl)})`, '', ...rendered.map(a => `- [${label(a.label)}](${target(a.url)}) — version ${label(a.version)}; SHA-256 ${a.sha256}`), '', `Task: ${input.taskId}; brief revision: ${input.briefRevision}.`].join('\n');
    return { schemaVersion: 1, packetSha256: hash(JSON.stringify(input)), checkedAt: new Date(checkedAt).toISOString(), expiresAt: new Date(checkedAt + 30 * 60 * 1000).toISOString(), status, decisionUrl, artifacts: rendered, checks, markdown,
      canMarkWaitingUser: false, deliveryClaim: 'Existing source messages and file reads only; this tool sends nothing and does not enforce runtime state.',
      limitation: 'Mechanical readiness is not semantic completeness, user access, user acceptance or permission to publish. Re-run after edits or before using an expired receipt. External URL access and native artifact versions remain unknown.' };
  };
}

export const reviewPacketToolDefinition = { name: 'prepare_review_packet', description: 'Read existing app messages and exact attached/file artifacts, verify a complete decision packet, and format usable conversation/native links. No model, sending, editing, approval or status mutation. Missing/unknown evidence cannot claim waiting_user readiness.', inputSchema: z.toJSONSchema(packetSchema), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
