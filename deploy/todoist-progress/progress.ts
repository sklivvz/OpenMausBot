import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const text = z.string().trim().min(1).max(1500);
const statuses = ['ready', 'in_progress', 'in_review', 'waiting_external', 'waiting_user', 'held'] as const;
const status = z.enum(statuses);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const targetSchema = z.object({ taskId: id, projectId: id }).strict();
export const progressSchema = targetSchema.extend({ operationId: id, expectedTaskSha256: hash, owner: text, status, nextAction: text, evidenceIds: z.array(id).min(1).max(12), blocker: text.optional(), followUp: z.iso.datetime().optional() }).strict();
export type VerifiedEvidence = { receiptId: string; taskId: string; sha256: string; reference: string; supportedStatuses: string[] };
type Task = { id: string; project_id: string; content: string; description?: string; updated_at?: string; [key: string]: unknown };
type Rpc = (slug: 'TODOIST_GET_ALL_TASKS' | 'TODOIST_UPDATE_TASK', args: Record<string, unknown>) => Promise<unknown>;
type Deps = { rpc: Rpc; receiptDir: string; allowedProjects: string[]; verifyEvidence: (ids: string[], target: { taskId: string; projectId: string; status: string }) => Promise<VerifiedEvidence[]>; now?: () => string };
const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const taskSha256 = (value: unknown) => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const begin = '<!-- openmaus-progress:start -->';
const end = '<!-- openmaus-progress:end -->';
function need(ok: unknown, reason: string): asserts ok { if (!ok) throw Error(reason); }
function block(description: string) {
  const start = description.indexOf(begin), finish = description.indexOf(end);
  need((start === -1 && finish === -1) || (start >= 0 && finish > start && description.lastIndexOf(begin) === start && description.lastIndexOf(end) === finish), 'Ambiguous progress block; no write attempted');
  return { start, finish: finish < 0 ? -1 : finish + end.length, text: start < 0 ? null : description.slice(start, finish + end.length) };
}
const preserved = (task: Task) => Object.fromEntries(Object.entries(task).filter(([key]) => !['description', 'updated_at'].includes(key)));
function save(file: string, value: unknown) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
export function createTodoistProgress({ rpc, receiptDir, allowedProjects, verifyEvidence, now = () => new Date().toISOString() }: Deps) {
  need(path.isAbsolute(receiptDir) && allowedProjects.length && allowedProjects.every(p => id.safeParse(p).success), 'Invalid trusted progress configuration');
  fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  async function read(target: z.infer<typeof targetSchema>): Promise<Task> {
    need(allowedProjects.includes(target.projectId), 'Project is outside this tool scope');
    const raw = await rpc('TODOIST_GET_ALL_TASKS', { ids: [target.taskId], limit: 5 }) as { tasks?: Task[]; next_cursor?: unknown; has_more?: unknown };
    need(Array.isArray(raw?.tasks) && raw.tasks.length <= 1, 'Invalid targeted task snapshot');
    need(!raw.next_cursor && !raw.has_more, 'Targeted task response is incomplete; no broader lookup was attempted');
    need(raw.tasks.every(task => task.id === target.taskId && typeof task.content === 'string' && typeof task.project_id === 'string'), 'Connector ignored the requested task filter');
    const task = raw.tasks[0];
    need(task && task.project_id === target.projectId && task.is_completed !== true && task.checked !== true && task.is_deleted !== true, 'Task is not currently open in the selected project');
    need(task.description === undefined || typeof task.description === 'string', 'Invalid task description');
    return task;
  }
  async function inspect(raw: unknown) {
    const target = targetSchema.parse(raw), task = await read(target);
    return { ...target, taskSha256: taskSha256(task), title: task.content, updatedAt: task.updated_at ?? null, currentProgress: block(task.description ?? '').text, checkedAt: now(), scope: 'Progress metadata only; task content, dates, labels, ownership fields and subtasks are not writable.' };
  }
  async function update(raw: unknown) {
    const input = progressSchema.parse(raw);
    need(new Set(input.evidenceIds).size === input.evidenceIds.length, 'Duplicate evidence identities');
    if (['waiting_user', 'waiting_external', 'held'].includes(input.status)) need(input.blocker && input.followUp, 'Waiting or held progress requires an exact blocker and follow-up time');
    const lock = path.join(receiptDir, `task-${input.taskId}.lock`);
    let fd: number;
    try { fd = fs.openSync(lock, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, taskId: input.taskId, at: now() })); }
    catch { throw Error('A progress writer owns this task lock; reconcile it before retrying'); }
    try {
      const evidence = await verifyEvidence(input.evidenceIds, input);
      need(Array.isArray(evidence) && evidence.length === input.evidenceIds.length && new Set(evidence.map(e => e.receiptId)).size === evidence.length && evidence.every(e => input.evidenceIds.includes(e.receiptId) && e.taskId === input.taskId && hash.safeParse(e.sha256).success && text.safeParse(e.reference).success && e.supportedStatuses.includes(input.status)), 'Host-verified evidence does not support this task progress state');
      const details = { owner: input.owner, status: input.status, nextAction: input.nextAction, evidence: [...evidence].sort((a, b) => a.receiptId.localeCompare(b.receiptId)).map(({ receiptId, sha256, reference }) => ({ receiptId, sha256, reference })), blocker: input.blocker ?? null, followUp: input.followUp ?? null };
      const encoded = JSON.stringify(details, null, 2);
      need(!encoded.includes(begin) && !encoded.includes(end), 'Progress data contains reserved block delimiters');
      const replacement = `${begin}\n${encoded}\n${end}`;
      const fingerprint = taskSha256({ taskId: input.taskId, projectId: input.projectId, details });
      const file = path.join(receiptDir, `operation-${input.taskId}-${input.operationId}.json`);
      const pendingFile = path.join(receiptDir, `pending-${input.taskId}.json`);
      if (fs.existsSync(pendingFile)) need(JSON.parse(fs.readFileSync(pendingFile, 'utf8')).operationId === input.operationId, 'An earlier progress write needs reconciliation; a new operation cannot bypass it');
      const before = await read(input);
      if (fs.existsSync(file)) {
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        need(receipt.fingerprint === fingerprint && receipt.taskId === input.taskId, 'Operation identity belongs to different progress');
        need(before.description === receipt.description && taskSha256(preserved(before)) === receipt.preservedSha256, 'Prior progress write needs reconciliation; no write was repeated');
        save(file, { ...receipt, state: 'verified', verifiedAt: now(), taskSha256: taskSha256(before) });
        fs.rmSync(pendingFile, { force: true });
        return { state: 'verified', changed: receipt.changed, replayed: true, taskId: input.taskId, taskSha256: taskSha256(before), operationId: input.operationId, receiptFile: file };
      }
      need(taskSha256(before) === input.expectedTaskSha256, 'Task changed since inspection; reread and merge before updating');
      const previous = before.description ?? '', old = block(previous);
      const description = old.start < 0 ? previous + (previous ? '\n\n' : '') + replacement : previous.slice(0, old.start) + replacement + previous.slice(old.finish);
      need(description.length <= 15000, 'Progress would exceed the description size limit');
      const receipt = { schemaVersion: 1, operationId: input.operationId, taskId: input.taskId, projectId: input.projectId, fingerprint, before, description, preservedSha256: taskSha256(preserved(before)), changed: old.text !== replacement, state: 'prepared', startedAt: now() };
      save(file, receipt);
      if (!receipt.changed) { save(file, { ...receipt, state: 'verified', verifiedAt: now() }); return { state: 'verified', changed: false, taskId: input.taskId, taskSha256: taskSha256(before), operationId: input.operationId, receiptFile: file }; }
      save(file, { ...receipt, state: 'write_started' });
      save(pendingFile, { operationId: input.operationId, receiptFile: file });
      let transportFailed = false;
      try { await rpc('TODOIST_UPDATE_TASK', { task_id: input.taskId, description }); } catch { transportFailed = true; }
      try {
        const after = await read(input);
        need(after.description === description && taskSha256(preserved(after)) === receipt.preservedSha256, 'Readback differs from the requested progress or preserved task fields');
        save(file, { ...receipt, state: 'verified', verifiedAt: now(), taskSha256: taskSha256(after), transportFailed });
        fs.rmSync(pendingFile, { force: true });
        return { state: 'verified', changed: true, reconciledTransportFailure: transportFailed, taskId: input.taskId, taskSha256: taskSha256(after), operationId: input.operationId, receiptFile: file };
      } catch {
        save(file, { ...receipt, state: 'needs_reconciliation', transportFailed });
        throw Error('Progress write outcome is unverified; inspect its receipt and current task before any new operation');
      }
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  return { inspect, update, call: (name: string, input: unknown) => {
    if (name === 'inspect_todoist_progress') return inspect(input);
    if (name === 'update_todoist_progress') return update(input);
    throw Error('Unknown Todoist progress tool');
  } };
}
export const progressToolDefinitions = [
  { name: 'inspect_todoist_progress', description: 'Read only the requested Todoist task and return its exact hash and managed progress block. No model or task changes.', inputSchema: z.toJSONSchema(targetSchema), annotations: { readOnlyHint: true } },
  { name: 'update_todoist_progress', description: 'Update only the managed progress block of an open task using host-verified evidence. Preserves task fields, rejects stale snapshots, suppresses unchanged writes, and verifies readback. Does not close tasks or infer approval. Reuse operationId for uncertain outcomes.', inputSchema: z.toJSONSchema(progressSchema), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
];
