import assert from 'node:assert/strict';
import test from 'node:test';
import { callTool } from '../../server/drivers/agents-call.ts';
import { handoffToolDefinition, validateHandoff, validHandoffReference } from './handoff-validation.ts';

function packet() {
  return {
    task: { id: 'task-1', objectiveId: 'objective-1', reference: 'record:positron-tasks/task-1', revision: 'v3' },
    assignment: { botId: 'specialist-1', objectiveId: 'objective-1', briefRevision: 'v3', contribution: 'Review the supplied contract for the listed issues.', operations: ['review'] },
    artifactMode: 'existing',
    artifacts: [{ id: 'contract-1', reference: '/workspace/Contract draft.docx', version: 'sha256-a', currentVersion: 'sha256-a' }],
    facts: [{ statement: 'The supplied draft is the current requested version.', reference: 'record:message/source-1' }],
    decisions: [{ statement: 'Review only; do not edit the original.', reference: 'openmausbot://thread/request-1?bot=lead-1' }],
    acceptanceCriteria: [{ criterion: 'Return findings against the requested clauses.', evidenceRequired: 'Clause references and proposed changes in a separate response.' }],
    scope: { permittedOperations: ['review'], heldOperations: ['edit', 'sign'], decisionReferences: ['record:message/source-1'] },
  };
}

test('valid handoff renders current native fields without dispatch or permission claims', () => {
  const input = packet(), result = validateHandoff(input);
  assert.equal(result.status, 'structurally_ready'); assert(result.nativeCall);
  assert.deepEqual(result.nativeCall.botIds, ['specialist-1']);
  assert(result.nativeCall.message.includes('objective-1'));
  assert(result.nativeCall.message.includes('/workspace/Contract draft.docx'));
  assert(result.nativeCall.doneWhen?.includes('Clause references'));
  assert.equal(result.dispatch, 'not_performed'); assert.equal(result.authorizationVerified, false);
  assert.deepEqual(input, packet());
});

test('missing fields and empty acceptance criteria are actionable field defects', () => {
  const missing = validateHandoff({});
  assert.equal(missing.status, 'needs_information'); assert.equal(missing.nativeCall, null);
  assert(missing.issues.some(issue => issue.field === 'task'));
  assert.equal(validateHandoff({ ...packet(), acceptanceCriteria: [] }).status, 'needs_information');
  assert.equal(validateHandoff({ ...packet(), acceptanceCriteria: [{ criterion: 'Review it', evidenceRequired: ' ' }] }).status, 'needs_information');
});

test('mismatched objective and brief revision cannot produce a dispatch payload', () => {
  for (const assignment of [{ ...packet().assignment, objectiveId: 'other-objective' }, { ...packet().assignment, briefRevision: 'old' }]) {
    const result = validateHandoff({ ...packet(), assignment });
    assert.equal(result.status, 'needs_correction'); assert.equal(result.nativeCall, null);
  }
});

test('canonical source requirements distinguish new work from existing-artifact edits', () => {
  assert.equal(validateHandoff({ ...packet(), artifacts: [] }).status, 'needs_correction');
  const result = validateHandoff({ ...packet(), artifactMode: 'new', artifacts: [] });
  assert.equal(result.status, 'structurally_ready');
  assert('checks' in result); assert.equal(result.checks.sourceCurrency, 'no_existing_artifact');
});

test('supplied stale source versions and duplicate artifact identities fail', () => {
  const input = packet();
  input.artifacts[0].currentVersion = 'sha256-b';
  assert.equal(validateHandoff(input).status, 'needs_correction');
  assert.equal(validateHandoff({ ...packet(), artifacts: [...packet().artifacts, ...packet().artifacts] }).status, 'needs_correction');
});

test('missing observed source version remains unknown rather than current', () => {
  const artifact = packet().artifacts[0];
  const result = validateHandoff({ ...packet(), artifacts: [{ id: artifact.id, reference: artifact.reference, version: artifact.version }] });
  assert.equal(result.status, 'structurally_ready'); assert('checks' in result);
  assert.equal(result.checks.sourceCurrency, 'unknown'); assert.equal(result.checks.sourceAccess, 'not_checked');
});

test('holds apply to exact operations without suspending independent preparation', () => {
  const valid = packet(); valid.scope.heldOperations = ['publish'];
  assert.equal(validateHandoff(valid).status, 'structurally_ready');
  valid.scope.heldOperations = ['review'];
  assert.equal(validateHandoff(valid).status, 'needs_correction');
  valid.scope.heldOperations = []; valid.assignment.operations = ['edit'];
  assert.equal(validateHandoff(valid).status, 'needs_correction');
});

test('reference forms follow real thread links and reject ambiguous or active schemes', () => {
  for (const ref of ['https://example.com/a?version=2', '/workspace/Contract draft.docx', 'record:positron-tasks/task-1', 'openmausbot://thread/request-1?bot=lead-1']) assert(validHandoffReference(ref), ref);
  for (const ref of ['artifact.docx', '../artifact.docx', '/workspace/../secret', 'javascript:alert(1)', 'https://user:secret@example.com', 'openmausbot://thread/a/b', 'openmausbot://thread/a?bot=b&extra=c', 'record:positron-tasks/', 'https://example.com/\nsecret']) assert.equal(validHandoffReference(ref), false, ref);
});

test('oversized rendered message and acceptance criteria fail without truncation', () => {
  const many = { ...packet(), facts: Array.from({ length: 3 }, () => ({ statement: 'Fact'.repeat(400), reference: 'record:message/fact' })) };
  const result = validateHandoff(many); assert.equal(result.status, 'needs_correction'); assert.equal(result.nativeCall, null);
  const criteria = [{ criterion: 'Criterion'.repeat(130), evidenceRequired: 'An artifact.' }];
  const longCriteria = validateHandoff({ ...packet(), acceptanceCriteria: criteria });
  assert.equal(longCriteria.status, 'needs_correction'); assert(longCriteria.issues.some(issue => issue.field === 'acceptanceCriteria'));
});

test('source revisions and decisions bind the prepared packet identity', () => {
  const first = validateHandoff(packet());
  const changed = packet(); changed.decisions[0].statement = 'Review the supplied reference.';
  const second = validateHandoff(changed);
  assert('packetSha256' in first && 'packetSha256' in second); assert.notEqual(first.packetSha256, second.packetSha256);
  assert.equal(validateHandoff({ ...packet(), approved: true }).status, 'needs_information');
  assert.equal(handoffToolDefinition.annotations.openWorldHint, false);
});

test('prepared payload is accepted by the existing coordinate_bots adapter', async () => {
  const result = validateHandoff(packet()); assert(result.nativeCall);
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  const response = await callTool('coordinate_bots', result.nativeCall, { botId: 'lead-1', threadId: 'thread-1', depth: 0, externalRuntime: false, sharedComputers: false,
    client: { api: async (path, init) => { sent.push({ path, body: JSON.parse(String(init?.body)) }); return { assignments: [{ id: 'fixture-assignment' }] }; }, apiResponse: async () => { throw Error('Unexpected read'); } } });
  assert.equal(response.isError, undefined); assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/api/internal/coordinate-bots');
  assert.deepEqual(sent[0].body.botIds, result.nativeCall.botIds);
  assert.equal(sent[0].body.done_when, result.nativeCall.doneWhen);
  assert.equal(sent[0].body.message, result.nativeCall.message);
});
