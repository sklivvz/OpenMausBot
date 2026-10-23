import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createEvidenceObserver, createExecutionRecorder } from './receipts.ts';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-receipts-'));
  const artifacts = path.join(root, 'artifacts'), directory = path.join(root, 'receipts'); fs.mkdirSync(artifacts);
  const file = path.join(artifacts, 'proposal.txt'); fs.writeFileSync(file, 'First version');
  const job = { threadId: 'thread-1', scope: 'job', since: 0, now: 1, version: 1, hidden: 0, counts: { running: 1 }, roots: ['assignment-1'], nodes: [{ id: 'assignment-1', rootId: 'assignment-1', status: 'running' }] };
  let source: unknown = job;
  const observe = createEvidenceObserver({ artifactRoots: [artifacts], readJob: async () => source });
  const signingKey = crypto.randomBytes(32);
  const recorder = createExecutionRecorder({ directory, observe, signingKey });
  const input = { operationId: 'op-1', botId: 'bot-1', taskId: 'task-1', objectiveId: 'objective-1', projectId: 'project-1', sourceVersion: 'brief-1', nextStep: 'Prepare proposal', evidence: [{ kind: 'artifact', id: 'proposal', path: file }] };
  return { root, artifacts, directory, file, job, observe, recorder, signingKey, input, source: (value: unknown) => { source = value; }, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('initial artifact is a baseline; changed exact bytes establish activity, not acceptance', async () => {
  const f = fixture(); try {
    const baseline = await f.recorder.record(f.input); assert.equal(baseline.outcome, 'unverified'); assert.deepEqual(baseline.supportedStatuses, []);
    fs.writeFileSync(f.file, 'Revised proposal');
    const changed = await f.recorder.record({ ...f.input, operationId: 'op-2' }); assert.equal(changed.outcome, 'progressed'); assert.equal(changed.businessOutcome, 'unverified'); assert.equal(changed.acceptance, 'unverified');
    const repeat = await f.recorder.record({ ...f.input, operationId: 'op-3' }); assert.equal(repeat.outcome, 'unverified');
  } finally { f.cleanup(); }
});
test('a prior observed missing artifact becoming present is mechanical progress', async () => {
  const f = fixture(); try { fs.unlinkSync(f.file); await f.recorder.record(f.input); fs.writeFileSync(f.file, 'Created proposal'); assert.equal((await f.recorder.record({ ...f.input, operationId: 'op-2' })).outcome, 'progressed'); } finally { f.cleanup(); }
});
test('operation replay is immutable and different input cannot reuse identity', async () => {
  const f = fixture(); try { const first = await f.recorder.record(f.input); fs.writeFileSync(f.file, 'Changed later'); const replay = await f.recorder.record(f.input); assert.equal(replay.receiptSha256, first.receiptSha256); assert.equal(replay.replayed, true); await assert.rejects(f.recorder.record({ ...f.input, sourceVersion: 'changed' }), /different input/); } finally { f.cleanup(); }
});
test('source failure retains last successful checkpoint and does not turn missing source into no work', async () => {
  const f = fixture(); try {
    await f.recorder.record(f.input); const checkpoint = fs.readdirSync(f.directory).find(n => n.startsWith('checkpoint-') && n.endsWith('.json'))!; const prior = fs.readFileSync(path.join(f.directory, checkpoint), 'utf8');
    fs.writeFileSync(f.file, 'Changed proposal'); f.source({}); const failed = await f.recorder.record({ ...f.input, operationId: 'failed', evidence: [...f.input.evidence, { kind: 'assignment', id: 'assignment-1', threadId: 'thread-1', rootId: 'assignment-1' }] });
    assert.equal(failed.outcome, 'source_failed'); assert.equal(fs.readFileSync(path.join(f.directory, checkpoint), 'utf8'), prior);
    assert.equal((await f.recorder.record({ ...f.input, operationId: 'recovered' })).outcome, 'progressed');
  } finally { f.cleanup(); }
});
test('actual queued or active assignment establishes delegation but completed text does not establish delivery', async () => {
  const f = fixture(); try {
    const request = { ...f.input, evidence: [{ kind: 'assignment', id: 'assignment-1', threadId: 'thread-1', rootId: 'assignment-1' }] };
    assert.equal((await f.recorder.record(request)).outcome, 'delegated_active');
    f.source({ ...f.job, counts: { completed: 1 }, nodes: [{ ...f.job.nodes[0], status: 'completed', result: 'All done! Approved!' }] });
    const returned = await f.recorder.record({ ...request, operationId: 'returned' }); assert.equal(returned.outcome, 'unverified'); assert.deepEqual(returned.supportedStatuses, []);
  } finally { f.cleanup(); }
});
test('stopped ancestry blocks active-delegation interpretation', async () => {
  const f = fixture(); try {
    f.source({ ...f.job, counts: { cancelled: 1, running: 1 }, nodes: [{ id: 'root', rootId: 'root', status: 'cancelled' }, { id: 'child', rootId: 'root', parentId: 'root', status: 'running' }] });
    const receipt = await f.recorder.record({ ...f.input, evidence: [{ kind: 'assignment', id: 'child', threadId: 'thread-1', rootId: 'root' }] }); assert.equal(receipt.outcome, 'unverified'); assert.equal(receipt.observations[0].state, 'assignment_stopped');
  } finally { f.cleanup(); }
});
test('incomplete, duplicate, wrong-root or unstable native sources fail explicitly', async () => {
  const f = fixture(); try {
    const ref = { kind: 'assignment' as const, id: 'assignment-1', threadId: 'thread-1', rootId: 'assignment-1' };
    for (const source of [{ ...f.job, hidden: 1 }, { ...f.job, counts: { running: 2 } }, { ...f.job, nodes: [f.job.nodes[0], f.job.nodes[0]], counts: { running: 2 } }, { ...f.job, nodes: [{ ...f.job.nodes[0], rootId: 'other' }] }]) { f.source(source); await assert.rejects(f.observe(ref)); }
    let calls = 0; const observe = createEvidenceObserver({ artifactRoots: [f.artifacts], readJob: async () => ({ ...f.job, version: calls++ }) }); await assert.rejects(observe(ref), /changed/);
  } finally { f.cleanup(); }
});
test('fresh verification binds task/project/status and rejects stale bytes', async () => {
  const f = fixture(); try {
    await f.recorder.record(f.input); fs.writeFileSync(f.file, 'Revised'); await f.recorder.record({ ...f.input, operationId: 'op-2' });
    const target = { taskId: 'task-1', projectId: 'project-1', status: 'in_progress' }; assert.equal((await f.recorder.verifyEvidence(['op-2'], target))[0].receiptId, 'op-2');
    for (const changed of [{ ...target, taskId: 'other' }, { ...target, projectId: 'other' }, { ...target, status: 'waiting_user' }, { ...target, status: 'held' }]) await assert.rejects(f.recorder.verifyEvidence(['op-2'], changed));
    fs.writeFileSync(f.file, 'Further edit'); await assert.rejects(f.recorder.verifyEvidence(['op-2'], target), /changed/);
  } finally { f.cleanup(); }
});
test('caller success flags and forged evidence or modified stored receipt cannot establish progress', async () => {
  const f = fixture(); try {
    await assert.rejects(f.recorder.record({ ...f.input, verified: true })); await assert.rejects(f.recorder.record({ ...f.input, outcome: 'progressed' }));
    await f.recorder.record(f.input); const file = path.join(f.directory, 'op-1.json'); const stored = JSON.parse(fs.readFileSync(file, 'utf8')); stored.outcome = 'progressed'; fs.writeFileSync(file, JSON.stringify(stored)); assert.throws(() => f.recorder.read('op-1'), /authentication/);
  } finally { f.cleanup(); }
});
test('configured roots prevent symlink escape and artifact payload bounds are enforced', async () => {
  const f = fixture(); try {
    const outside = path.join(f.root, 'outside'); fs.writeFileSync(outside, 'private'); const link = path.join(f.artifacts, 'link'); fs.symlinkSync(outside, link); await assert.rejects(f.observe({ kind: 'artifact', id: 'outside', path: link }), /outside/);
    fs.writeFileSync(f.file, Buffer.alloc(3 * 1024 * 1024 + 1)); await assert.rejects(f.observe({ kind: 'artifact', id: 'large', path: f.file }), /limit/);
  } finally { f.cleanup(); }
});
test('existing locks and duplicate selectors fail before advancing checkpoint', async () => {
  const f = fixture(); try { await assert.rejects(f.recorder.record({ ...f.input, evidence: [f.input.evidence[0], f.input.evidence[0]] }), /Duplicate/); let release!: () => void; const recorder = createExecutionRecorder({ directory: f.directory, signingKey: f.signingKey, observe: async ref => { await new Promise<void>(resolve => { release = resolve; }); return f.observe(ref); } }); const first = recorder.record(f.input); await new Promise(resolve => setTimeout(resolve, 0)); await assert.rejects(f.recorder.record({ ...f.input, operationId: 'other' }), /already active/); release(); await first; } finally { f.cleanup(); }
});

test('tampering with baseline checkpoint or recomputing receipt SHA does not bypass authentication', async () => {
  const f = fixture(); try {
    await f.recorder.record(f.input);
    const checkpoint = path.join(f.directory, fs.readdirSync(f.directory).find(n => n.startsWith('checkpoint-') && n.endsWith('.json'))!);
    const changed = JSON.parse(fs.readFileSync(checkpoint, 'utf8')); changed.observations = {}; fs.writeFileSync(checkpoint, JSON.stringify(changed));
    await assert.rejects(f.recorder.record({ ...f.input, operationId: 'op-2' }), /authentication/);
    const file = path.join(f.directory, 'op-1.json'); const receipt = JSON.parse(fs.readFileSync(file, 'utf8')); receipt.supportedStatuses = ['waiting_user']; delete receipt.receiptSha256; delete receipt.signature; receipt.receiptSha256 = crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex'); receipt.signature = '0'.repeat(64); fs.writeFileSync(file, JSON.stringify(receipt)); assert.throws(() => f.recorder.read('op-1'), /authentication/);
  } finally { f.cleanup(); }
});

test('authenticated pending journal restores a saved observation before another operation', async () => {
  const f = fixture(); try {
    await f.recorder.record(f.input);
    const name = fs.readdirSync(f.directory).find(n => n.startsWith('checkpoint-') && n.endsWith('.json'))!;
    const checkpoint = path.join(f.directory, name), old = fs.readFileSync(checkpoint);
    fs.writeFileSync(f.file, 'Revised proposal'); await f.recorder.record({ ...f.input, operationId: 'op-2' });
    fs.writeFileSync(checkpoint, old);
    const taskKey = name.slice('checkpoint-'.length, -'.json'.length), pending = { taskKey, operationId: 'op-2' };
    const signed = JSON.stringify(pending, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
    const pendingFile = path.join(f.directory, `pending-${taskKey}.json`);
    fs.writeFileSync(pendingFile, JSON.stringify({ ...pending, signature: crypto.createHmac('sha256', f.signingKey).update(signed).digest('hex') }));
    const current = await f.recorder.record({ ...f.input, operationId: 'op-3' }); assert.equal(current.outcome, 'unverified'); assert.equal(fs.existsSync(pendingFile), false);
  } finally { f.cleanup(); }
});
