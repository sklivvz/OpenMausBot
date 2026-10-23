import assert from 'node:assert/strict';
import test from 'node:test';
import { createOwnershipClassifier, ownershipToolDefinition } from './ownership.ts';

const clock = () => '2026-10-23T20:00:00Z';
const request = (text = 'Design a newsletter template. Do not review or rewrite its copy.') => ({ request: text, briefRevision: 'v2' });
function fixture(options: { category?: string; probabilities?: Record<string, number>; evidence?: string; evidenceProbabilities?: Record<string, number>; status?: number; malformed?: boolean; disabled?: boolean } = {}) {
  const calls: any[] = [];
  const classify = createOwnershipClassifier({ now: clock, config: () => ({ decider: { enabled: !options.disabled, key: 'fixture-secret' } }), fetchImpl: async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    if (options.status) return Response.json({ detail: 'fixture-secret' }, { status: options.status });
    if (options.malformed) return Response.json({ answers: { contribution: { choice: 'publish_now' } } });
    const category = options.category ?? 'design', evidence = options.evidence ?? 's0';
    return Response.json({ answers: {
      contribution: { choice: category, probabilities: options.probabilities ?? { [category]: 1 } },
      evidence: { choice: evidence, probabilities: options.evidenceProbabilities ?? { [evidence]: 1 } },
    }, usage: { input_tokens: 123 }, model: 'fixture-jev' });
  } });
  return { classify, calls };
}
test('exact known operations use code and split ownership without requesting Jev', async () => {
  const f = fixture();
  const result = await f.classify({ operations: ['write_copy', 'design', 'assemble', 'publish', 'write_copy'], briefRevision: 'v1' });
  assert.equal(result.method, 'deterministic'); assert.equal(result.status, 'split_required'); assert.equal(f.calls.length, 0);
  assert.deepEqual(result.contributions.map(c => c.owner), ['Chandler', 'Edna', 'Liz']);
  assert.equal(result.authority, 'unchanged'); assert.equal(result.dispatch, 'none'); assert.equal(result.acceptance, 'unverified');
});
test('template installation belongs to Liz, design belongs to Edna and coordination to Darcy', async () => {
  const f = fixture();
  for (const [operation, owner] of [['install_template', 'Liz'], ['design', 'Edna'], ['coordinate', 'Darcy'], ['review_copy', 'Chandler'], ['review_design', 'Edna'], ['review_strategy', 'Darcy']]) {
    const result = await f.classify({ operations: [operation], briefRevision: 'v1' });
    assert.equal(result.status, 'recommended'); assert.equal(result.contributions[0].owner, owner);
  }
  assert.equal(f.calls.length, 0);
});
test('natural language makes one bounded call and retains exact source evidence', async () => {
  const f = fixture(); const input = request(); const result = await f.classify(input);
  assert.equal(result.status, 'recommended'); assert.equal(result.contributions[0].owner, 'Edna'); assert.equal(f.calls.length, 1);
  assert.equal(result.method === 'jev' && 'evidence' in result && result.evidence?.text, input.request);
  assert.equal(result.method === 'jev' && 'inputTokens' in result && result.inputTokens, 123);
  const body = f.calls[0]; assert.equal(Object.keys(body.questions).length, 2);
  assert.equal(body.state.sourceLines[0].text, input.request);
  assert.equal(body.questions.evidence.criteria.s0, 'Source line s0');
});
test('mixed natural-language work returns decomposition, not a catch-all specialist', async () => {
  const f = fixture({ category: 'mixed' }); const result = await f.classify(request('Write the issue and design its template.'));
  assert.equal(result.status, 'split_required'); assert.deepEqual(result.contributions, []); assert.equal(result.dispatch, 'none');
});
test('unclear reviews, low probabilities, weak evidence and missing evidence do not route', async () => {
  for (const options of [
    { category: 'unclear' },
    { probabilities: { design: .6, copy: .4 } },
    { evidence: 'none' },
    { evidenceProbabilities: { s0: .7, none: .3 } },
  ]) {
    const f = fixture(options); const result = await f.classify(request('Review this.'));
    assert.equal(result.status, 'uncertain'); assert.deepEqual(result.contributions, []);
  }
});
test('outside work does not get assigned to a marketing specialist', async () => {
  const result = await fixture({ category: 'outside' }).classify(request('Determine whether our data processing contract is lawful.'));
  assert.equal(result.status, 'outside_scope'); assert.deepEqual(result.contributions, []);
});
test('malformed, disabled, HTTP and missing config remain explicit and never expose secrets', async () => {
  for (const options of [{ malformed: true }, { disabled: true }, { status: 429 }]) {
    const f = fixture(options); const result = await f.classify(request());
    assert.equal(result.status, 'unavailable'); assert.deepEqual(result.contributions, []);
    assert.ok(!JSON.stringify(result).includes('fixture-secret'));
    if (options.disabled) assert.equal(f.calls.length, 0);
  }
  const result = await createOwnershipClassifier({ config: () => { throw Error('private path'); } })(request());
  assert.equal(result.status, 'unavailable'); assert.ok(!JSON.stringify(result).includes('private path'));
});
test('rejects excess length, unknown operations, mixed modes and arbitrary authority fields before calling Jev', async () => {
  const f = fixture();
  for (const input of [
    request('x'.repeat(4001)), request('line\n'.repeat(33)),
    { operations: ['review'], briefRevision: 'v1' },
    { operations: ['publish'], request: 'Hold publication', briefRevision: 'v1' },
    { ...request(), approved: true }, { ...request(), briefRevision: '' },
  ]) await assert.rejects(f.classify(input), /Invalid/);
  assert.equal(f.calls.length, 0);
});
test('revision and request changes change receipt identity without transferring permission', async () => {
  const f = fixture(); const first = await f.classify(request());
  const changed = await f.classify({ ...request(), briefRevision: 'v3' });
  assert.notEqual(first.inputSha256, changed.inputSha256);
  const textChanged = await f.classify(request('Design the landing page.'));
  assert.notEqual(first.inputSha256, textChanged.inputSha256);
  assert.equal(changed.authority, 'unchanged'); assert.equal(changed.dispatch, 'none');
});
test('tool contract exposes classification only, not dispatch, links or publishing credentials', () => {
  assert.equal(ownershipToolDefinition.name, 'classify_marketing_ownership');
  assert.equal(ownershipToolDefinition.annotations.readOnlyHint, true);
  assert.ok(!JSON.stringify(ownershipToolDefinition.inputSchema).includes('apiKey'));
});
test('identical input reuses advice, changed revision is reclassified and unavailable results retry', async () => {
  const f = fixture();
  const first = await f.classify(request()); const replay = await f.classify(request());
  assert.equal(f.calls.length, 1); assert.equal(replay.inputSha256, first.inputSha256);
  assert.equal('reused' in replay && replay.reused, true); assert.equal('inputTokens' in replay && replay.inputTokens, 0);
  await f.classify({ ...request(), briefRevision: 'v3' }); assert.equal(f.calls.length, 2);
  const failed = fixture({ status: 429 }); await failed.classify(request()); await failed.classify(request()); assert.equal(failed.calls.length, 2);
});
