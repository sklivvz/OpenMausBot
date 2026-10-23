import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssignmentTracker, reconcileAssignments, assignmentSnapshotHash, assignmentTrackingToolDefinition } from './tracker.ts';

const node = (id: string, status = 'running', patch: Record<string, unknown> = {}) => ({ id, rootId: 'root', parentId: id === 'root' ? undefined : 'root', botId: id + '-bot', threadId: id + '-thread', status, executions: 1, ...patch });
function job(nodes = [node('root'), node('child')], patch: Record<string, unknown> = {}) {
  const counts: Record<string, number> = { queued: 0, running: 0, waiting: 0, needsInput: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const n of nodes) counts[n.status === 'needs_input' ? 'needsInput' : n.status === 'resume' ? 'queued' : n.status]++;
  return { threadId: 'lead-thread', scope: 'job', since: 0, now: 1000, version: 'version-a', roots: ['root'], nodes, hidden: 0, counts, ...patch };
}
const input = { threadId: 'lead-thread', rootId: 'root', assignmentIds: ['child'] };

test('queued, running, waiting and resume reuse exact assignment without dispatch', () => {
  for (const status of ['queued', 'running', 'waiting', 'resume']) {
    const result = reconcileAssignments(job([node('root'), node('child', status)]), input);
    assert.equal(result.status, 'tracked');
    assert.equal(result.assignments[0].action, 'reuse_and_wait');
    assert.equal(result.redispatchAuthorized, false);
    assert.equal(result.businessOutcome, 'unverified');
  }
});

test('completed output is a bounded claim for review, not accepted work', () => {
  const result = reconcileAssignments(job([node('root'), node('child', 'completed', { outcome: 'done', result: 'a'.repeat(1000), finishedAt: 999 })]), input);
  const item = result.assignments[0];
  assert.equal(item.action, 'review_result');
  assert('result' in item && item.result);
  assert.equal(item.result.preview.length, 240);
  assert.equal(item.result.kind, 'assignee_claim');
  assert.deepEqual(item.result.readVia, { tool: 'assignment_status', id: 'child' });
  assert.equal(result.deliverableAcceptance, 'unverified');
});

test('input blockers and failed execution require resolution, never retries', () => {
  const blocked = reconcileAssignments(job([node('root'), node('child', 'needs_input', { question: 'Which source?' })]), input);
  assert.equal(blocked.assignments[0].action, 'resolve_dependency');
  const failed = reconcileAssignments(job([node('root'), node('child', 'failed', { outcome: 'provider_error' })]), input);
  assert.equal(failed.assignments[0].action, 'resolve_failure');
  assert.equal(failed.redispatchAuthorized, false);
});

test('stops persist and active effects under a stopped root stay visible', () => {
  const result = reconcileAssignments(job([node('root', 'cancelled', { outcome: 'stopped' }), node('child')]), input);
  assert.equal(result.assignments[0].action, 'preserve_stop');
  assert('activeUnderStoppedLineage' in result.assignments[0]);
  assert.equal(result.assignments[0].activeUnderStoppedLineage, true);
  assert.equal(result.holds, 'not_assessed');
});

test('stopped intermediate parents and broken ancestry cannot be bypassed', () => {
  const result = reconcileAssignments(job([node('root'), node('parent', 'cancelled'), node('child', 'running', { parentId: 'parent' })]), input);
  assert.equal(result.assignments[0].action, 'preserve_stop');
  const missing = reconcileAssignments(job([node('root'), node('child', 'running', { parentId: 'missing' })]), input);
  assert.equal(missing.assignments[0].action, 'resolve_identity');
  const cycle = reconcileAssignments(job([node('root'), node('parent', 'running', { parentId: 'child' }), node('child', 'running', { parentId: 'parent' })]), input);
  assert.equal(cycle.assignments[0].action, 'resolve_identity');
});

test('missing and wrong-root IDs do not establish that new work is safe', () => {
  const result = reconcileAssignments(job([node('root'), node('child', 'running', { rootId: 'other' })]), { ...input, assignmentIds: ['child', 'missing'] });
  assert.equal(result.status, 'needs_reconciliation');
  assert(result.assignments.every(x => x.action === 'resolve_identity' && !x.redispatchAuthorized));
});

test('partial, duplicate and wrong-conversation snapshots refuse recommendations', () => {
  for (const raw of [job(undefined, { hidden: 1 }), job(undefined, { counts: { queued: 0, running: 3, waiting: 0, needsInput: 0, completed: 0, failed: 0, cancelled: 0 } }), job([node('root'), node('child'), node('child')]), job(undefined, { threadId: 'other-thread' })]) {
    const result = reconcileAssignments(raw, input);
    assert.equal(result.sourceComplete, false);
    assert.deepEqual(result.assignments, []);
  }
});

test('expected version mismatch and absent root prevent stale tracking advice', () => {
  for (const request of [{ ...input, expectedVersion: 'old-version' }, { ...input, rootId: 'missing' }]) {
    assert.equal(reconcileAssignments(job(), request).sourceComplete, false);
  }
});

test('unchanged evidence ignores sampling time, changed results invalidate source identity', () => {
  const first = job([node('root'), node('child', 'completed', { result: 'First' })]);
  const second = job([node('root'), node('child', 'completed', { result: 'Second' })]);
  assert.equal(assignmentSnapshotHash(first), assignmentSnapshotHash({ ...first, now: 2000 }));
  assert.notEqual(assignmentSnapshotHash(first), assignmentSnapshotHash(second));
});

test('concurrent state changes are surfaced even with an unchanged native version', async () => {
  const sequence = [job(), job([node('root'), node('child', 'completed', { result: 'Returned' })])];
  const result = await createAssignmentTracker({ readJob: async () => sequence.shift() })(input);
  assert.equal(result.status, 'source_changed');
  assert.equal(result.sourceComplete, false);
  assert.deepEqual(result.assignments, []);
});

test('stable reads support multiple exact candidates without choosing a new assignee', async () => {
  const snapshot = job([node('root'), node('child'), node('second', 'needs_input', { question: 'Source needed' })]);
  const result = await createAssignmentTracker({ readJob: async () => snapshot })({ ...input, assignmentIds: ['child', 'second'] });
  assert.equal(result.status, 'tracked');
  assert.deepEqual(result.assignments.map(x => x.action), ['reuse_and_wait', 'resolve_dependency']);
});

test('source failures, malformed records and oversized selections never imply completion', async () => {
  assert.equal((await createAssignmentTracker({ readJob: async () => { throw Error('private credentials'); } })(input)).status, 'source_failed');
  assert.equal(reconcileAssignments({}, input).status, 'source_failed');
  for (const request of [{ ...input, assignmentIds: ['child', 'child'] }, { ...input, assignmentIds: [] }, { ...input, allowRetry: true }]) assert.throws(() => reconcileAssignments(job(), request));
  assert.equal(assignmentTrackingToolDefinition.inputSchema.type, 'object');
});
