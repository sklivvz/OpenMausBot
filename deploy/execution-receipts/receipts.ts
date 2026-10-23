import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const id = z.string().regex(/^[\w-]{1,160}$/);
const text = z.string().trim().min(1).max(2000);
const referenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artifact'), id, path: text }).strict(),
  z.object({ kind: z.literal('assignment'), id, threadId: id, rootId: id }).strict(),
]);
export const receiptInput = z.object({ operationId: id, botId: id, taskId: id, objectiveId: id, projectId: id.optional(), sourceVersion: text, nextStep: text, evidence: z.array(referenceSchema).min(1).max(8) }).strict();
type Reference = z.infer<typeof referenceSchema>;
type Input = z.infer<typeof receiptInput>;
export type Observation = { ref: Reference; observedAt: string; sha256: string; state: 'artifact_present' | 'artifact_absent' | 'assignment_active' | 'assignment_returned' | 'assignment_stopped' | 'assignment_other'; details: Record<string, unknown> };
export type ExecutionReceipt = { schemaVersion: 1; producer: 'execution-receipts'; operationId: string; inputSha256: string; checkedAt: string; input: Input; sourceComplete: boolean; outcome: 'progressed' | 'delegated_active' | 'source_failed' | 'unverified'; observations: Observation[]; gaps: string[]; changedEvidence: string[]; supportedStatuses: string[]; businessOutcome: 'unverified'; acceptance: 'unverified'; association: 'caller_supplied'; receiptSha256: string; signature: string };
const canonical = (value: unknown) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const receiptHash = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const refKey = (ref: Reference) => receiptHash(ref);
const active = new Set(['queued', 'running', 'waiting', 'resume']);
const stopped = new Set(['cancelled', 'stopped']);

export function createEvidenceObserver({ artifactRoots, readJob, now = () => new Date().toISOString() }: { artifactRoots: string[]; readJob: (threadId: string) => Promise<unknown>; now?: () => string }) {
  const roots = artifactRoots.map(root => fs.realpathSync(root));
  return async (ref: Reference): Promise<Observation> => {
    if (ref.kind === 'artifact') {
      if (!path.isAbsolute(ref.path)) throw Error('Artifact path must be absolute');
      let resolved: string;
      try { resolved = fs.realpathSync(ref.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; resolved = path.join(fs.realpathSync(path.dirname(ref.path)), path.basename(ref.path)); }
      if (!roots.some(root => resolved.startsWith(root + path.sep))) throw Error('Artifact outside configured roots');
      if (!fs.existsSync(resolved)) return { ref, observedAt: now(), sha256: receiptHash({ absent: resolved }), state: 'artifact_absent', details: { path: resolved, exists: false } };
      const stat = fs.statSync(resolved); if (!stat.isFile() || stat.size > 3 * 1024 * 1024) throw Error('Artifact unavailable or exceeds limit');
      const bytes = fs.readFileSync(resolved); if (bytes.length > 3 * 1024 * 1024) throw Error('Artifact exceeds limit');
      return { ref, observedAt: now(), sha256: receiptHash(bytes), state: 'artifact_present', details: { path: resolved, bytes: bytes.length } };
    }
    const before = await readJob(ref.threadId), after = await readJob(ref.threadId);
    const stable = (value: unknown) => value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'now')) : value;
    if (receiptHash(stable(before)) !== receiptHash(stable(after))) throw Error('Assignment source changed during observation');
    const job = after as { threadId?: string; scope?: string; hidden?: number; nodes?: { id: string; rootId: string; parentId?: string; status: string; result?: unknown }[]; counts?: Record<string, number>; roots?: string[] };
    if (job.threadId !== ref.threadId || job.scope !== 'job' || job.hidden !== 0 || !Array.isArray(job.nodes) || !job.counts || Object.values(job.counts).some(n => !Number.isSafeInteger(n) || n < 0) || Object.values(job.counts).reduce((a, b) => a + b, 0) !== job.nodes.length || new Set(job.nodes.map(n => n.id)).size !== job.nodes.length) throw Error('Incomplete assignment source');
    const node = job.nodes.find(n => n.id === ref.id && n.rootId === ref.rootId);
    if (!node || !job.nodes.some(n => n.id === ref.rootId)) throw Error('Assignment identity unavailable');
    let current = node, hasStop = stopped.has(node.status); const seen = new Set([node.id]);
    while (current.parentId) { const parent = job.nodes.find(n => n.id === current.parentId); if (!parent || seen.has(parent.id)) throw Error('Incomplete assignment ancestry'); seen.add(parent.id); hasStop ||= stopped.has(parent.status); current = parent; }
    const state = hasStop ? 'assignment_stopped' : active.has(node.status) ? 'assignment_active' : node.status === 'completed' ? 'assignment_returned' : 'assignment_other';
    return { ref, observedAt: now(), sha256: receiptHash(stable(after)), state, details: { assignmentId: node.id, rootId: node.rootId, status: node.status, stoppedAncestor: hasStop, returnedTextSha256: node.result === undefined ? null : receiptHash(node.result), interpretation: 'Native execution state only; returned text is not accepted work.' } };
  };
}

function syncDirectory(directory: string) { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function atomicWrite(file: string, value: unknown) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  syncDirectory(path.dirname(file));
}
function readJson(file: string) { if (fs.statSync(file).size > 1024 * 1024) throw Error('Receipt exceeds limit'); return JSON.parse(fs.readFileSync(file, 'utf8')); }

export function createExecutionRecorder({ directory, observe, signingKey, now = () => new Date().toISOString() }: { directory: string; signingKey: Uint8Array; observe: (ref: Reference) => Promise<Observation>; now?: () => string }) {
  if (signingKey.byteLength < 32) throw Error('Receipt signing key must contain at least 32 bytes');
  const key = Buffer.from(signingKey);
  const sign = (value: unknown) => crypto.createHmac('sha256', key).update(canonical(value)).digest('hex');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const operationPath = (operationId: string) => path.join(directory, id.parse(operationId) + '.json');
  function read(operationId: string): ExecutionReceipt {
    const receipt = readJson(operationPath(operationId)) as ExecutionReceipt;
    const { signature, ...signed } = receipt;
    if (!/^[a-f0-9]{64}$/.test(signature ?? '') || !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(signed), 'hex'))) throw Error('Receipt authentication mismatch');
    const { receiptSha256, ...body } = signed;
    if (receipt.schemaVersion !== 1 || receipt.producer !== 'execution-receipts' || receipt.operationId !== operationId || receiptHash(body) !== receiptSha256 || receiptHash(receiptInput.parse(receipt.input)) !== receipt.inputSha256) throw Error('Receipt integrity mismatch');
    return receipt;
  }
  async function record(raw: unknown) {
    const input = receiptInput.parse(raw), inputSha256 = receiptHash(input), file = operationPath(input.operationId);
    const taskKey = receiptHash({ botId: input.botId, taskId: input.taskId, objectiveId: input.objectiveId });
    const lock = path.join(directory, `checkpoint-${taskKey}.lock`), checkpointFile = path.join(directory, `checkpoint-${taskKey}.json`), pendingFile = path.join(directory, `pending-${taskKey}.json`);
    const checkpointRead = (): Record<string, Observation> => {
      if (!fs.existsSync(checkpointFile)) return {};
      const checkpoint = readJson(checkpointFile);
      const body = { checkpoint: taskKey, observations: checkpoint.observations };
      if (checkpoint.signature !== sign(body)) throw Error('Checkpoint authentication mismatch');
      return checkpoint.observations;
    };
    const checkpointApply = (receipt: ExecutionReceipt) => {
      if (receiptHash({ botId: receipt.input.botId, taskId: receipt.input.taskId, objectiveId: receipt.input.objectiveId }) !== taskKey) throw Error('Checkpoint task mismatch');
      if (!receipt.sourceComplete) return;
      const checkpoint = { checkpoint: taskKey, observations: { ...checkpointRead(), ...Object.fromEntries(receipt.observations.map(o => [refKey(o.ref), o])) } };
      atomicWrite(checkpointFile, { ...checkpoint, signature: sign(checkpoint) });
    };
    let lockFd: number;
    try { lockFd = fs.openSync(lock, 'wx', 0o600); } catch { throw Error('Task observation already active; reconcile a stale lock before retrying'); }
    try {
      fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, operationId: input.operationId, createdAt: now() }));
      if (fs.existsSync(pendingFile)) {
        const pending = readJson(pendingFile);
        if (pending.signature !== sign({ taskKey, operationId: pending.operationId })) throw Error('Pending observation authentication mismatch');
        if (fs.existsSync(operationPath(pending.operationId))) checkpointApply(read(pending.operationId));
        fs.unlinkSync(pendingFile); syncDirectory(directory);
      }
      if (fs.existsSync(file)) { const prior = read(input.operationId); if (prior.inputSha256 !== inputSha256) throw Error('Operation identity belongs to different input'); return { ...prior, replayed: true, receiptFile: file }; }
      const prior = checkpointRead();
      const observations: Observation[] = [], gaps: string[] = [];
      if (new Set(input.evidence.map(refKey)).size !== input.evidence.length) throw Error('Duplicate evidence selector');
      for (const ref of input.evidence) {
        try { const observation = await observe(ref); if (canonical(observation.ref) !== canonical(ref) || !/^[a-f0-9]{64}$/.test(observation.sha256) || !Number.isFinite(Date.parse(observation.observedAt))) throw Error('Invalid host observation'); observations.push(observation); }
        catch { gaps.push(`${ref.kind}:${ref.id}: source unavailable, incomplete or changed`); }
      }
      const changedEvidence = observations.filter(o => o.state === 'artifact_present' && prior[refKey(o.ref)] && prior[refKey(o.ref)].sha256 !== o.sha256).map(o => o.ref.id);
      const sourceComplete = gaps.length === 0;
      const outcome = !sourceComplete ? 'source_failed' : changedEvidence.length ? 'progressed' : observations.some(o => o.state === 'assignment_active') ? 'delegated_active' : 'unverified';
      const body = { schemaVersion: 1 as const, producer: 'execution-receipts' as const, operationId: input.operationId, inputSha256, checkedAt: now(), input, sourceComplete, outcome, observations, gaps, changedEvidence, supportedStatuses: outcome === 'progressed' || outcome === 'delegated_active' ? ['in_progress'] : [], businessOutcome: 'unverified' as const, acceptance: 'unverified' as const, association: 'caller_supplied' as const };
      const signed = { ...body, receiptSha256: receiptHash(body) };
      const receipt = { ...signed, signature: sign(signed) } as ExecutionReceipt;
      const pending = { taskKey, operationId: input.operationId };
      atomicWrite(pendingFile, { ...pending, signature: sign(pending) });
      const fd = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(receipt)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      syncDirectory(directory);
      checkpointApply(receipt);
      fs.unlinkSync(pendingFile); syncDirectory(directory);
      return { ...receipt, replayed: false, receiptFile: file };
    } finally { fs.closeSync(lockFd); fs.unlinkSync(lock); }
  }
  async function verifyEvidence(ids: string[], target: { taskId: string; projectId: string; status: string }) {
    if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length) throw Error('Supply distinct bounded receipt identities');
    const evidence = [];
    for (const operationId of ids) {
      const receipt = read(operationId);
      if (receipt.input.taskId !== target.taskId || receipt.input.projectId !== target.projectId || !receipt.sourceComplete || !receipt.supportedStatuses.includes(target.status)) throw Error('Receipt does not establish the requested task status');
      for (const previous of receipt.observations) { const current = await observe(previous.ref); if (current.sha256 !== previous.sha256 || current.state !== previous.state) throw Error('Receipt evidence changed; capture current state'); }
      evidence.push({ receiptId: operationId, taskId: target.taskId, sha256: receipt.receiptSha256, reference: operationPath(operationId), supportedStatuses: receipt.supportedStatuses });
    }
    return evidence;
  }
  return { record, read, verifyEvidence };
}

export const executionReceiptToolDefinition = { name: 'record_execution_receipt', description: 'Observe configured artifact bytes or native assignment state and save an immutable evidence receipt. No caller-supplied success flags. Baselines, stopped work and returned text do not prove completion. Source failures preserve the prior successful checkpoint. No model or task mutation.', inputSchema: z.toJSONSchema(receiptInput) };
