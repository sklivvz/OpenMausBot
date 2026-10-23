import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createDetector, passages } from './detector.ts';
const config = () => ({ decider: { enabled: true, key: 'fixture-only', provider: 'jev', baseUrl: 'http://127.0.0.1:1234' } });
const sample = { draft: '  A practical launch.\n\nFor people who build.\nFree online, 60 minutes.\n', brief: 'Event invitation with connected prose.', channel: 'Mastodon', sourceFacts: 'The launch is free, online and lasts 60 minutes.' };
function fake(flags: Record<string, number> = {}, quote = 'p2') {
  return (async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const answers: Record<string, unknown> = {};
    for (const [key, q] of Object.entries(body.questions) as [string, any][]) {
      const category = key.replace(/_passage$/, '');
      const choice = flags[category] ? quote : 'none';
      answers[key] = q.type === 'noul' ? { noul: flags[category] ?? .02 } : { choice, probabilities: { [choice]: 1 } };
    }
    return new Response(JSON.stringify({ model: 'fixture', answers }));
  }) as typeof fetch;
}
describe('Jev editorial review', () => {
  it('quotes original text and hashes the complete exact draft', async () => {
    const r: any = await createDetector({ config, fetchImpl: fake({ choppy_rhythm: .96 }) })(sample);
    expect(r.status).toBe('needs_revision');
    expect(r.findings[0].passage.text).toBe('Free online, 60 minutes.');
    const p = r.findings[0].passage;
    expect(sample.draft.slice(p.start, p.end)).toBe(p.text);
    expect(r.draftSha256).toBe(crypto.createHash('sha256').update(sample.draft).digest('hex'));
    expect(r.editorialSignoff).toBe('writer_required');
  });
  it('keeps low-confidence or unlocalized findings for review rather than claiming a defect', async () => {
    const r: any = await createDetector({ config, fetchImpl: fake({ generic_copy: .6, choppy_rhythm: .98 }, 'none') })(sample);
    expect(r.status).toBe('needs_review');
    expect(r.findings.every((f: any) => !f.passage && f.severity === 'review')).toBe(true);
  });
  it('does not turn an outage, missing key or malformed result into a pass', async () => {
    for (const fetchImpl of [async () => new Response('', { status: 429 }), async () => new Response('{}'), async () => { throw Error('network'); }]) {
      expect((await createDetector({ config, fetchImpl: fetchImpl as typeof fetch })(sample)).status).toBe('unavailable');
    }
    expect((await createDetector({ config: () => ({}) })(sample)).status).toBe('unavailable');
  });
  it('rejects excessive or unknown input before contacting Jev, without silent truncation', async () => {
    const detect = createDetector({ config, fetchImpl: (() => { throw Error('must not call'); }) as any });
    await expect(detect({ ...sample, draft: 'x'.repeat(12001) })).rejects.toThrow('Invalid');
    await expect(detect({ ...sample, bypass: true })).rejects.toThrow('Invalid');
    await expect(detect({ ...sample, draft: Array(49).fill('A').join('\n') })).rejects.toThrow('Nothing was truncated');
  });
  it('distinguishes absent evidence from factual verification', async () => {
    const r: any = await createDetector({ config, fetchImpl: fake({ unsupported_claim: .99 }) })({ ...sample, sourceFacts: '' });
    expect(r.assessments.find((a: any) => a.category === 'unsupported_claim').severity).toBe('not_assessed');
    expect(r.editorialSignoff).toBe('writer_required');
  });
  it('retains every nonempty character in long passages including Unicode', () => {
    const draft = '😀 ' + 'a'.repeat(1700) + '\r\nSecond line';
    for (const p of passages(draft)) expect(draft.slice(p.start, p.end)).toBe(p.text);
    expect(passages(draft).map(p => p.text).join('')).toBe(draft.replace(/\r\n/g, ''));
  });
});
