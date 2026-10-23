import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { createReviewPacket, packetFreshness } from './packet.ts';

const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const document = 'Exact prepared proposal.';
const ref = { botId: 'darcy', threadId: 'main', messageId: 'delivery' };
const input = () => ({ taskId: 'task1', briefRevision: 'r1', decision: { question: 'Approve this exact proposal for review only?', source: ref }, requiredArtifactIds: ['proposal'], artifacts: [{ id: 'proposal', version: 'v1', label: 'Proposal', sha256: sha(document), source: ref, target: { kind: 'message_file', path: '/work/proposal.txt' } }] });
const body = () => `${input().decision.question}\n[Proposal](/work/proposal.txt)`;
function fixture(options: { text?: string; bytes?: string; status?: number; mainThread?: string; threadOwner?: string } = {}) {
  const calls: { url: URL; method: string; body?: string }[] = [];
  const run = createReviewPacket({ appUrl: 'http://127.0.0.1:17234', now: () => 1792780000000, reviewDestinations: [{ botId: 'darcy', threadId: options.mainThread || 'main' }],
    fetchImpl: async (url, init) => {
      const u = new URL(String(url)); calls.push({ url: u, method: init?.method || 'GET', body: init?.body as string | undefined });
      expect(init?.redirect).toBe('error');
      if (u.pathname === '/api/bots') return Response.json({ bots: [{ id: options.threadOwner || 'darcy', threadId: options.mainThread || 'main', tasks: [{ threadId: 'main' }] }] });
      if (u.pathname.endsWith('/messages')) return Response.json({ messages: [{ id: u.searchParams.get('around'), kind: 'text', role: 'bot', text: options.text ?? body() }] });
      if (u.pathname.endsWith('/file')) return new Response(options.bytes ?? document, { status: options.status ?? 200 });
      throw Error('Unexpected route');
    },
  });
  return { run, calls };
}
describe('actionable review packet', () => {
  it('verifies exact stored artifact and question, builds actual conversation link without sending', async () => {
    const f = fixture(), r = await f.run(input());
    expect(r.status).toBe('mechanically_ready');
    expect(r.decisionUrl).toBe('openmausbot://thread/main?bot=darcy');
    expect(r.markdown).not.toContain('/work/proposal.txt');
    expect(r.canMarkWaitingUser).toBe(false);
    expect(f.calls.filter(c => c.method === 'POST')).toHaveLength(1);
    expect(f.calls.at(-1)?.url.pathname).toBe('/api/threads/main/messages/delivery/file');
  });
  it('fails missing required artifacts and duplicate identities', async () => {
    const x = input(); x.requiredArtifactIds.push('template');
    expect((await fixture().run(x)).status).toBe('incomplete');
    const y = input(); y.artifacts.push(y.artifacts[0]);
    expect((await fixture().run(y)).checks.some(c => c.id === 'unique_artifacts' && c.status === 'fail')).toBe(true);
  });
  it('fails changed artifact bytes and missing question', async () => {
    expect((await fixture({ bytes: 'Changed proposal' }).run(input())).status).toBe('incomplete');
    expect((await fixture({ text: 'I will write a proposal later.' }).run(input())).checks.find(c => c.id === 'decision_question')?.status).toBe('fail');
  });
  it('does not treat file denial or absent source ownership as readiness', async () => {
    expect((await fixture({ status: 403 }).run(input())).status).toBe('needs_review');
    const f = fixture({ threadOwner: 'another' });
    expect((await f.run(input())).status).toBe('needs_review');
    expect(f.calls).toHaveLength(1);
  });
  it('does not equate a delegated work conversation with delivery to user', async () => {
    const r = await fixture({ mainThread: 'user-chat' }).run(input());
    expect(r.checks.find(c => c.id === 'decision_destination')?.status).toBe('unknown');
    expect(r.status).toBe('needs_review');
  });
  it('requires the decision message to link separately stored artifacts', async () => {
    const x = input(); x.artifacts[0].source = { ...ref, messageId: 'other' };
    const r = await fixture().run(x);
    expect(r.status).toBe('incomplete');
    expect(r.checks.find(c => c.id === 'delivery:proposal')?.status).toBe('fail');
  });
  it('keeps actual native links but marks version and access unknown without fetching them', async () => {
    const url = 'https://claude.ai/design/p/native';
    const x = { ...input(), artifacts: [{ ...input().artifacts[0], target: { kind: 'external', url } }] };
    const f = fixture({ text: body() + '\n' + url });
    const r = await f.run(x);
    expect(r.status).toBe('needs_review');
    expect(r.artifacts[0].url).toBe(url);
    expect(f.calls.every(c => c.url.origin === 'http://127.0.0.1:17234')).toBe(true);
  });
  it('rejects Todoist, credential-bearing, unsafe and unobserved external destinations', async () => {
    for (const url of ['https://app.todoist.com/app/task/task1', 'https://user:secret@example.test/doc', 'javascript:alert(1)', 'https://unobserved.example.test/doc']) {
      const x = { ...input(), artifacts: [{ ...input().artifacts[0], target: { kind: 'external', url } }] };
      const r = await fixture().run(x);
      expect(r.checks.find(c => c.id === 'artifact:proposal')?.status).toBe('fail');
    }
  });
  it('binds assembled verification to exact version and keeps unknown checks', async () => {
    const receipt = { schema_version: 1, verifier_version: '1.0.0', artifact: { id: 'proposal', version: 'v1', sha256: sha(document), expected_sha256: sha(document) }, contract_sha256: sha('contract'), status: 'needs_review', checks: [{ id: 'rendering', status: 'unknown', detail: 'Email-client rendering not established.' }], approval: 'not_assessed', publication_authorized: false };
    expect((await fixture().run({ ...input(), verificationReceipts: [receipt] })).status).toBe('needs_review');
    receipt.artifact.version = 'v0';
    expect((await fixture().run({ ...input(), verificationReceipts: [receipt] })).status).toBe('incomplete');
  });
  it('has bounded freshness and rejects expired, future and overlong receipts', () => {
    const now = Date.now(), valid = { checkedAt: new Date(now - 100).toISOString(), expiresAt: new Date(now + 100).toISOString() };
    expect(packetFreshness(valid, now)).toBe(true);
    expect(packetFreshness(valid, now + 101)).toBe(false);
    expect(packetFreshness(valid, now - 101)).toBe(false);
    expect(packetFreshness({ ...valid, expiresAt: new Date(now + 3600000).toISOString() }, now)).toBe(false);
  });
});
