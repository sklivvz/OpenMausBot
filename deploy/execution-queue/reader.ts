import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { departments, type TaskSnapshot } from '../positron-tasks/snapshot.ts';

const id = z.string().regex(/^[\w-]{1,160}$/);
const cursor = z.string().regex(/^[\w-]+:\d+$/);
const queueInput = z.union([z.object({ projectId: id.optional() }).strict(), z.object({ cursor }).strict()]);
const contextInput = z.union([
  z.object({ snapshotId: id, taskId: id, threadId: id, expectedTaskSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ cursor }).strict(),
]);
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Row = Record<string, any>;
type Snapshot = { id: string; at: string; expires: number; full: Row; rows: Row[]; read: Set<number>; file: string; sha256: string; sourceComplete: boolean; gaps: string[] };
const schema = (name: string, description: string, input: z.ZodType) => ({ name, description, inputSchema: { ...z.toJSONSchema(input), type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false } });
export const queueToolDefinitions = [
  schema('read_execution_queue', 'Collect the complete open Positron Tasks queue through its read-only API, without model classification. Return stable compact pages and exact private evidence. Follow returned cursors; sourceComplete differs from allPagesRead. Does not choose work or change tasks.', queueInput),
  schema('read_execution_context', 'Collect the selected task conversation and actual assignment tree without model calls. Pin a task from read_execution_queue. Fetch all bounded source pages, preserve full evidence, and return compact pages with explicit coverage and change detection. Thread relevance and business completion remain unverified.', contextInput),
];

export function createQueueReader({ readTasks, fetchImpl = fetch, now = Date.now, appUrl = 'http://127.0.0.1:8799', directory = path.join(os.homedir(), '.openmausbot', 'execution-queue'), maxMessagePages = 100, maxSourceBytes = 8_000_000, maxSnapshotBytes = 32_000_000 }: { readTasks: () => Promise<TaskSnapshot>; fetchImpl?: typeof fetch; now?: () => number; appUrl?: string; directory?: string; maxMessagePages?: number; maxSourceBytes?: number; maxSnapshotBytes?: number }) {
  const snapshots = new Map<string, Snapshot>();
  const pageSize = 15;
  const read = async (url: string) => {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(150000) });
    if (!response.ok) throw Error(`http_${response.status}`);
    let text = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body!) {
      text += decoder.decode(chunk, { stream: true });
      if (Buffer.byteLength(text) > maxSourceBytes) throw Error('source_size_limit');
    }
    text += decoder.decode();
    return JSON.parse(text);
  };
  const save = (full: Row, rows: Row[], gaps: string[]) => {
    if (Buffer.byteLength(JSON.stringify(full)) > maxSnapshotBytes) throw Error('snapshot_size_limit');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const [key, value] of snapshots) if (value.expires <= now()) snapshots.delete(key);
    if (snapshots.size >= 32) throw Error('snapshot_capacity');
    const key = crypto.randomUUID(), file = path.join(directory, `${key}.json`), sha256 = hash(full);
    fs.writeFileSync(file, JSON.stringify(full), { mode: 0o600, flag: 'wx' });
    const snapshot: Snapshot = { id: key, at: new Date(now()).toISOString(), expires: now() + 600000, full, rows, read: new Set(), file, sha256, sourceComplete: gaps.length === 0, gaps };
    snapshots.set(key, snapshot);
    return snapshot;
  };
  const get = (key: string) => {
    const saved = snapshots.get(key);
    if (!saved || saved.expires <= now()) throw Error('Invalid or expired snapshot; collect a fresh source');
    return saved;
  };
  const page = (snapshot: Snapshot, offset = 0) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % pageSize || offset >= Math.max(1, snapshot.rows.length)) throw Error('Invalid cursor; use the returned cursor');
    snapshot.read.add(offset);
    const totalPages = Math.max(1, Math.ceil(snapshot.rows.length / pageSize));
    return { snapshotId: snapshot.id, checkedAt: snapshot.at, sourceCheckedAt: snapshot.full.checkedAt, sourceComplete: snapshot.sourceComplete,
      status: snapshot.sourceComplete ? 'collected' : 'source_failed', gaps: snapshot.gaps, sourceSha256: snapshot.sha256,
      evidenceFile: snapshot.file, totalRows: snapshot.rows.length, pagesTotal: totalPages, pagesRead: snapshot.read.size, allPagesRead: snapshot.read.size === totalPages,
      rows: snapshot.rows.slice(offset, offset + pageSize), nextCursor: offset + pageSize < snapshot.rows.length ? `${snapshot.id}:${offset + pageSize}` : null,
      notice: 'Compact excerpts are not complete source text. Exact retrieved source is retained in evidenceFile. Coverage proves retrieval only, not permission, relevance, acceptance or business completion.' };
  };
  const fromCursor = (value: string, kind: string) => {
    const [key, offset] = value.split(':');
    const saved = get(key);
    if (saved.full.kind !== kind) throw Error('Invalid cursor for this tool');
    return page(saved, Number(offset));
  };
  const failure = (source: string, reason: string) => ({ status: 'source_failed', sourceComplete: false, checkedAt: new Date(now()).toISOString(), gaps: [`${source}:${reason}`], notice: 'No complete current source was established. Previous evidence files remain unchanged; this is not an empty queue or an actionable-work decision.' });
  return async (name: string, raw: unknown = {}) => {
    if (name === 'read_execution_queue') {
      const parsed = queueInput.safeParse(raw);
      if (!parsed.success) throw Error('Invalid queue input');
      const input = parsed.data;
      if ('cursor' in input) return fromCursor(input.cursor, 'queue');
      try {
        const source: Row = await readTasks();
        if (source.complete !== true || !Array.isArray(source.tasks) || !Number.isInteger(source.totalOpen) || source.totalOpen !== source.tasks.length || typeof source.checkedAt !== 'string') return failure('queue', 'incomplete_source');
        if (source.tasks.some((t: Row) => !id.safeParse(t.id).success || !id.safeParse(t.projectId).success || typeof t.title !== 'string' || typeof t.description !== 'string') || new Set(source.tasks.map((t: Row) => t.id)).size !== source.tasks.length) return failure('queue', 'invalid_or_duplicate_tasks');
        const tasks = source.tasks.filter((t: Row) => !input.projectId || t.projectId === input.projectId);
        const rows = tasks.map((t: Row) => ({ record: 'task', taskId: t.id, projectId: t.projectId, project: t.project, title: t.title.slice(0, 160), titleTruncated: t.title.length > 160, status: t.status, due: t.due, responsible: t.responsible, updatedAt: t.updatedAt ?? null, taskSha256: hash(t), descriptionCharacters: t.description.length }));
        return page(save({ kind: 'queue', checkedAt: source.checkedAt, source, tasks, projectId: input.projectId ?? null }, rows, []));
      } catch { return failure('queue', 'retrieval_unavailable_or_limit'); }
    }
    if (name !== 'read_execution_context') throw Error('Invalid execution queue tool');
    const parsed = contextInput.safeParse(raw);
    if (!parsed.success) throw Error('Invalid context input');
    const input = parsed.data;
    if ('cursor' in input) return fromCursor(input.cursor, 'context');
    const queue = get(input.snapshotId);
    if (queue.full.kind !== 'queue') throw Error('Invalid task snapshot');
    const task = queue.full.tasks.find((row: Row) => row.id === input.taskId);
    if (!task || (input.expectedTaskSha256 && input.expectedTaskSha256 !== hash(task))) throw Error('Invalid or stale task reference');
    const full: Row = { kind: 'context', checkedAt: new Date(now()).toISOString(), queueSnapshotId: queue.id, task, threadId: input.threadId, messages: [], associationVerified: false };
    const gaps: string[] = [], rows: Row[] = [];
    try {
      const inventory = await read(`${appUrl}/api/bots?messages=0`);
      if (!Array.isArray(inventory.bots)) return failure('threads', 'invalid_inventory');
      const owner = inventory.bots.find((bot: Row) => bot.tasks?.some((thread: Row) => thread.threadId === input.threadId));
      if (!owner || (departments[task.projectId] && owner.section !== departments[task.projectId])) return failure('thread', 'missing_or_wrong_team');
      full.owner = { id: owner.id, name: owner.name, section: owner.section };
      const seen = new Set(), max = maxMessagePages;
      let before: string | undefined, leaf: string | null | undefined, finished = false;
      for (let n = 0; n < max; n++) {
        const source = await read(`${appUrl}/api/threads/${input.threadId}/messages?limit=100${before ? '&before=' + encodeURIComponent(before) : ''}`);
        if (!Array.isArray(source.messages) || !Object.hasOwn(source, 'activeLeafId') || typeof source.hasMore !== 'boolean') { gaps.push('conversation:invalid_page'); break; }
        if (n === 0) leaf = source.activeLeafId;
        if (source.activeLeafId !== leaf) { gaps.push('conversation:changed_during_read'); break; }
        if (source.messages.some((message: Row) => !id.safeParse(message.id).success || seen.has(message.id))) { gaps.push('conversation:overlapping_page'); break; }
        for (const message of source.messages) seen.add(message.id);
        full.messages.unshift(...source.messages);
        if (Buffer.byteLength(JSON.stringify(full)) > maxSnapshotBytes) return failure('conversation', 'snapshot_size_limit');
        if (!source.hasMore) { finished = true; break; }
        if (!source.messages.length) { gaps.push('conversation:empty_continuation'); break; }
        before = source.messages[0].id;
      }
      if (!finished && !gaps.length) gaps.push('conversation:page_limit');
      full.activeLeafId = leaf;
      const job = await read(`${appUrl}/api/threads/${input.threadId}/job?since=0&full=1`);
      full.job = job;
      if (job.threadId !== input.threadId || !Array.isArray(job.nodes) || typeof job.version !== 'string' || !job.counts || !Number.isInteger(job.hidden)) gaps.push('assignments:invalid_job');
      else {
        const counted = Object.values(job.counts).reduce<number>((sum, count) => sum + (Number.isInteger(count) && (count as number) >= 0 ? count as number : NaN), 0);
        if (!Number.isFinite(counted) || counted !== job.nodes.length || job.hidden !== 0) gaps.push('assignments:hidden_or_truncated');
      }
      const latest = await read(`${appUrl}/api/threads/${input.threadId}/messages?limit=1`);
      const jobAgain = await read(`${appUrl}/api/threads/${input.threadId}/job?since=0&full=1`);
      if (latest.activeLeafId !== leaf) gaps.push('conversation:changed_after_read');
      const jobContent = (value: Row) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'now'));
      if (hash(jobContent(jobAgain)) !== hash(jobContent(job))) gaps.push('assignments:changed_after_read');
    } catch { gaps.push('context:retrieval_unavailable_or_limit'); }
    for (const message of full.messages) rows.push({ record: 'message', id: message.id, at: message.at, role: message.role, kind: message.kind, text: typeof message.text === 'string' ? message.text.slice(0, 240) : undefined, textTruncated: typeof message.text === 'string' && message.text.length > 240, messageSha256: hash(message) });
    for (const node of Array.isArray(full.job?.nodes) ? full.job.nodes : []) rows.push({ record: 'assignment', id: node.id, rootId: node.rootId, parentId: node.parentId, botId: node.botId, threadId: node.threadId, status: node.status, outcome: node.outcome, createdAt: node.createdAt, finishedAt: node.finishedAt, assignmentSha256: hash(node) });
    try { return { ...page(save(full, rows, gaps)), taskId: input.taskId, threadId: input.threadId, taskSha256: hash(task), associationVerified: false, assignmentVersion: full.job?.version ?? null, activeLeafId: full.activeLeafId ?? null }; }
    catch { return failure('context', 'evidence_storage_unavailable_or_limit'); }
  };
}
