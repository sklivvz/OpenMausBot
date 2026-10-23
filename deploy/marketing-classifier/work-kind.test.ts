import { describe, expect, it } from 'vitest';
import { createWorkKindClassifier, workKindInputSchema, workKindPassages } from './work-kind.ts';

const config = () => ({ decider: { enabled: true, key: 'fixture-only', provider: 'jev', baseUrl: 'http://127.0.0.1:1234' } });
const sample = { request: 'Review the reusable product deck before the launch. Do not edit it.' };
function fixture(choice = 'collateral', probabilities = { [choice]: 1 }, evidence = 'p0') {
  return (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    expect(body.state.passages[0].text).toBeTruthy();
    expect(Object.keys(body.questions)).toEqual(['kind', 'evidence']);
    return new Response(JSON.stringify({ model: 'fixture', usage: { input_tokens: 123 }, answers: {
      kind: { choice, probabilities }, evidence: { choice: evidence, probabilities: { [evidence]: 1 } },
    } }));
  }) as typeof fetch;
}

describe('marketing work-kind classifier contract', () => {
  it.each(['collateral', 'editorial', 'campaign'])('returns a supported %s label without granting authority', async kind => {
    const result = await createWorkKindClassifier({ config, fetchImpl: fixture(kind) })(sample);
    expect(result.status).toBe('classified');
    expect(result.kind).toBe(kind);
    expect(result.authorizationVerified).toBe(false);
    expect(result.changesAuthority).toBe(false);
    expect(result.changesHolds).toBe(false);
    expect(result.assignsOwner).toBe(false);
    expect(result.inputTokensThisCall).toBe(123);
    if ('evidence' in result && result.evidence) {
      expect(sample.request.slice(result.evidence.start, result.evidence.end)).toBe(result.evidence.text);
    } else throw Error('Missing evidence');
  });

  it.each([
    ['mixed', 'needs_decomposition'], ['uncertain', 'needs_clarification'],
  ])('routes %s to a lead without choosing a default kind', async (kind, status) => {
    const result = await createWorkKindClassifier({ config, fetchImpl: fixture(kind) })(sample);
    expect(result.status).toBe(status);
    expect(result.kind).toBeNull();
  });

  it('does not accept an ambiguous distribution or an ungrounded confident prediction', async () => {
    for (const fetchImpl of [fixture('collateral', { collateral: 0.6, campaign: 0.4 }), fixture('campaign', { campaign: 1 }, 'none')]) {
      const result = await createWorkKindClassifier({ config, fetchImpl })(sample);
      expect(result.status).toBe('needs_clarification');
      expect(result.kind).toBeNull();
    }
  });

  it('returns unavailable for provider failure, malformed output and invented evidence IDs', async () => {
    for (const fetchImpl of [fixture('collateral', { collateral: 1 }, 'invented'), async () => new Response('{}'), async () => new Response('', { status: 429 }), async () => { throw Error('offline'); }]) {
      const result = await createWorkKindClassifier({ config, fetchImpl: fetchImpl as typeof fetch })(sample);
      expect(result.status).toBe('unavailable');
      expect(result.kind).toBeNull();
      expect(result.inputTokensThisCall).toBeNull();
    }
  });

  it('does not make a provider call without configuration', async () => {
    const fetchImpl = (() => { throw Error('must not call'); }) as typeof fetch;
    for (const cfg of [() => ({}), () => { throw Error('missing'); }]) {
      const result = await createWorkKindClassifier({ config: cfg, fetchImpl })(sample);
      expect(result.status).toBe('unavailable');
      expect(result.inputTokensThisCall).toBe(0);
    }
  });

  it('rejects excessive, blank and unknown input before a provider call', async () => {
    const classify = createWorkKindClassifier({ config, fetchImpl: (() => { throw Error('must not call'); }) as typeof fetch });
    for (const input of [{ request: ' ' }, { request: 'x'.repeat(6001) }, { ...sample, approve: true }]) await expect(classify(input)).rejects.toThrow('Invalid');
  });

  it('changes input identity when facts, request scope or source reference changes', async () => {
    const classify = createWorkKindClassifier({ config, fetchImpl: fixture() });
    const hashes = await Promise.all([
      sample,
      { request: sample.request + ' Editing is now requested.' },
      { ...sample, context: 'The event has been cancelled.' },
      { ...sample, sourceReferences: ['user-message-v2'] },
    ].map(async input => (await classify(input)).inputSha256));
    expect(new Set(hashes).size).toBe(4);
  });

  it('preserves approved wording, Unicode and every source character without normalizing', () => {
    const input = workKindInputSchema.parse({ request: '  Approved: “Not X, but Y.”\n😀' + 'z'.repeat(1100), context: 'Keep exactly.\r\nReview only.' });
    const passages = workKindPassages(input);
    for (const field of ['request', 'context'] as const) expect(passages.filter(p => p.field === field).map(p => p.text).join('')).toBe(input[field]);
    for (const p of passages) expect(input[p.field].slice(p.start, p.end)).toBe(p.text);
  });
});
