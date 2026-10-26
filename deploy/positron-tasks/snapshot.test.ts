import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { configuredAuthorization, createTaskSnapshotReader, taskUrl } from './snapshot.ts';

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Task ${id}`, status: 'unestimated', department: { id: 'dept_legal', name: 'Legal' }, due_on: null, archived_at: null, ...extra });
function source(items: any[], pageSize = 2, overrides: (url: URL) => any = () => undefined) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL, init: RequestInit) => {
    const url = new URL(String(input)); requests.push({ url, init });
    const override = overrides(url); if (override) return override;
    if (url.pathname === '/api/v1/tasks') {
      const offset = Number(url.searchParams.get('offset'));
      return Response.json({ items: items.slice(offset, offset + pageSize), total: items.length, limit: 200, offset });
    }
    const id = decodeURIComponent(url.pathname.split('/').pop()!);
    const row = items.find(t => t.id === id);
    return row ? Response.json({ ...row, objective: row.title, description: `Owner: Luis Litt\nDetail for ${id}`, criteria: ['Signed copy filed'], progress: id === 'b' ? 'Draft sent' : null, version: 3, updated_at: '2026-10-25T10:00:00Z' }) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

test('collects every page, drops closed work and keeps full descriptions with department scope', async () => {
  const s = source([item('a', { due_on: '2026-10-25' }), item('b', { parent: { id: 'a' }, due_on: '2026-10-26' }), item('c', { status: 'accepted' }), item('d', { department: null }), item('e', { status: 'cancelled' })]);
  const read = createTaskSnapshotReader({ origin: 'http://tasks.test', authorization: () => 'Bearer fixture-token-0123456789', fetchImpl: s.fetchImpl, now: () => Date.parse('2026-10-26T08:00:00Z') });
  const snapshot = await read();
  assert.deepEqual(snapshot.tasks.map(t => t.id), ['a', 'b', 'd']);
  assert.equal(snapshot.totalOpen, 3);
  assert.deepEqual(snapshot.projects.dept_legal, { open: 2, overdue: 1, dueToday: 1, undated: 0 });
  assert.equal(snapshot.projects.unassigned.open, 1);
  const b = snapshot.tasks[1];
  assert.equal(b.parentId, 'a'); assert.equal(b.project, 'Legal');
  assert.match(b.description, /^Owner: Luis Litt/m); assert.match(b.description, /- Signed copy filed/); assert.match(b.description, /Progress: Draft sent/);
  assert.ok(s.requests.every(r => (r.init.headers as Record<string, string>).authorization === 'Bearer fixture-token-0123456789' && r.init.redirect === 'error' && r.init.method === 'GET'));
  assert.equal(taskUrl('t_1', 'http://localhost:8080'), 'http://localhost:8080/tasks/t_1');
});

test('changed totals, overlapping pages, failed details and runaway paging never look complete', async () => {
  const items = [item('a'), item('b'), item('c')];
  let calls = 0;
  const cases = [
    source(items, 2, url => url.pathname === '/api/v1/tasks' && Number(url.searchParams.get('offset')) > 0 ? Response.json({ items: [item('c')], total: 4, limit: 200, offset: 2 }) : undefined),
    source(items, 2, url => url.pathname === '/api/v1/tasks' && Number(url.searchParams.get('offset')) > 0 ? Response.json({ items: [item('a')], total: 3, limit: 200, offset: 2 }) : undefined),
    source(items, 2, url => url.pathname.endsWith('/b') ? new Response('{}', { status: 503 }) : undefined),
    source(items, 2, url => url.pathname === '/api/v1/tasks' ? Response.json({ items: [item(`x${calls++}`)], total: 1000, limit: 200, offset: Number(url.searchParams.get('offset')) }) : undefined),
  ];
  for (const s of cases) {
    await assert.rejects(createTaskSnapshotReader({ origin: 'http://tasks.test', authorization: () => 'Bearer fixture-token-0123456789', fetchImpl: s.fetchImpl, maxPages: 5 })());
  }
});

test('credential comes only from an enabled registration for the same origin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-tasks-'));
  const configFile = path.join(dir, 'config.json');
  const write = (entry: unknown) => fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { tasks: entry } }));
  try {
    write({ type: 'http', url: 'http://tasks.test/mcp', headers: { Authorization: 'Bearer fixture-token-0123456789' }, enabled: true });
    assert.equal(configuredAuthorization({ configFile, server: 'tasks', origin: 'http://tasks.test' }), 'Bearer fixture-token-0123456789');
    assert.throws(() => configuredAuthorization({ configFile, server: 'missing', origin: 'http://tasks.test' }), /not configured/);
    assert.throws(() => configuredAuthorization({ configFile, server: 'tasks', origin: 'http://elsewhere.test' }), /another origin/);
    write({ type: 'http', url: 'http://tasks.test/mcp', headers: { Authorization: 'Basic abc' }, enabled: true });
    assert.throws(() => configuredAuthorization({ configFile, server: 'tasks', origin: 'http://tasks.test' }), /invalid/);
    write({ type: 'http', url: 'http://tasks.test/mcp', headers: { Authorization: 'Bearer fixture-token-0123456789' }, enabled: false });
    assert.throws(() => configuredAuthorization({ configFile, server: 'tasks', origin: 'http://tasks.test' }), /not configured/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
