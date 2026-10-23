import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReceiptStore } from './receipts.ts';
import { toolDetailPreview } from '../../server/tool-summary.ts';
import { createDetector as detector, passages } from './detector.ts';
const directories: string[] = [];
function createDetector(options: Parameters<typeof detector>[0] = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-preflight-test-'));
  directories.push(directory);
  return detector({ store: new ReceiptStore(directory), ...options });
}
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
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

describe('deterministic preflight and reuse', () => {
  it('resolves explicit constraints before any model call without rewriting', async () => {
    let calls = 0;
    const detect = createDetector({ config, fetchImpl: (async (...args: Parameters<typeof fetch>) => { calls++; return fake()(...args); }) as typeof fetch });
    const result: any = await detect({ ...sample, constraints: { forbiddenPhrases: ['practical launch'], preserveExactly: ['Approved wording'], requiredUrls: ['https://example.org/invite'], maxCharacters: 5 } });
    expect(calls).toBe(0);
    expect(result.status).toBe('needs_revision');
    expect(result.findings.map((f: any) => f.category)).toEqual(['explicit_phrase_constraint', 'character_limit', 'protected_text_changed', 'required_url_missing']);
    expect(result.semanticCheck).toBe('not_run');
  });
  it('reuses complete-input receipts across instances and invalidates changed sources, references and constraints', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-shared-')); directories.push(directory);
    let calls = 0;
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => { calls++; return fake()(...args); }) as typeof fetch;
    const first = detector({ config, fetchImpl, store: new ReceiptStore(directory) });
    const second = detector({ config, fetchImpl, store: new ReceiptStore(directory) });
    const results: any[] = await Promise.all([first(sample), second(sample)]);
    expect(calls).toBe(1);
    expect(results.filter(r => r.cacheHit)).toHaveLength(1);
    expect(results.find(r => r.cacheHit).inputTokensThisCall).toBe(0);
    for (const update of [{ sourceFacts: 'Changed evidence' }, { approvedReference: 'Changed approved reference' }, { brief: 'Changed brief' }, { constraints: { maxCharacters: 1000 } }]) await second({ ...sample, ...update });
    expect(calls).toBe(5);
  });
  it('limits a scoped repair to two semantic checks and still reuses prior receipts', async () => {
    let calls = 0;
    const detect = createDetector({ config, fetchImpl: (async (...args: Parameters<typeof fetch>) => { calls++; return fake()(...args); }) as typeof fetch });
    const scoped = { ...sample, reviewScope: { assetId: 'fixture-asset', briefRevision: 'brief-1' } };
    await detect(scoped);
    await detect({ ...scoped, draft: sample.draft + 'Revision two.' });
    const blocked: any = await detect({ ...scoped, draft: sample.draft + 'Revision three.' });
    expect(blocked.status).toBe('needs_editor');
    expect(calls).toBe(2);
    expect((await detect(scoped) as any).cacheHit).toBe(true);
    await detect({ ...scoped, reviewScope: { ...scoped.reviewScope, briefRevision: 'user-correction-2' } });
    expect(calls).toBe(3);
  });
  it('preserves compact findings in bounded transcripts and full evaluated inputs on disk', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-evidence-')); directories.push(directory);
    const detect = detector({ config, fetchImpl: fake(), store: new ReceiptStore(directory) });
    const result = await detect({ ...sample, constraints: { forbiddenPhrases: ['practical launch'] } });
    const preview = toolDetailPreview({ content: [{ type: 'text', text: JSON.stringify(result) }] });
    expect(preview).toContain('revise: explicit_phrase_constraint');
    const saved = JSON.parse(fs.readFileSync(path.join(directory, result.reviewSha256 + '.json'), 'utf8'));
    expect(saved.input.draft).toBe(sample.draft);
    expect(saved.receipt.findings[0].passage.text).toBe('practical launch');
    expect(fs.statSync(path.join(directory, result.reviewSha256 + '.json')).mode & 0o777).toBe(0o600);
  });
  it('expires cached reviews and their scoped budgets together', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-expiry-')); directories.push(directory);
    let at = Date.now(), calls = 0;
    const detect = detector({ config, store: new ReceiptStore(directory, () => at), fetchImpl: (async (...args: Parameters<typeof fetch>) => { calls++; return fake()(...args); }) as typeof fetch });
    const scoped = { ...sample, reviewScope: { assetId: 'expiry', briefRevision: '1' } };
    await detect(scoped);
    at += 8 * 86400_000;
    expect((await detect(scoped) as any).cacheHit).toBe(false);
    expect(calls).toBe(2);
  });
  it('does not cache unavailable responses or spend the revision budget on them', async () => {
    let calls = 0;
    const detect = createDetector({ config, fetchImpl: (async (...args: Parameters<typeof fetch>) => { calls++; return calls < 3 ? new Response('', { status: 503 }) : fake()(...args); }) as typeof fetch });
    const scoped = { ...sample, reviewScope: { assetId: 'fixture', briefRevision: '1' } };
    expect((await detect(scoped)).status).toBe('unavailable');
    expect((await detect(scoped)).status).toBe('unavailable');
    expect((await detect(scoped)).status).toBe('no_flags');
    expect(calls).toBe(3);
  });
});
