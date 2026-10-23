import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createAttentionReader } from './attention.ts';
import { createBridge, toolDefinitions } from './bridge.ts';

test('isolated HTTP scan collects all pages before the agent receives a stable report', async () => {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.url!); assert.equal(req.method, 'POST');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ page: req.url === '/scan' ? 1 : 2, scannedAt: '2026-10-23T10:00:00Z', complete: false, sources: [{ source: 'work_email', complete: false }], items: [{ id: req.url }], more: req.url === '/scan', nextCommand: 'do not use shell' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const read = createAttentionReader(fetch, `http://127.0.0.1:${port}`, Date.now);
    const first = await read({});
    assert.deepEqual(calls, ['/scan', '/next']);
    assert.equal(first.complete, false); assert.equal(first.pagesTotal, 2); assert.equal(first.allPagesRead, false); assert.equal(first.nextCommand, undefined);
    const next = await read({ cursor: first.nextCursor! });
    assert.equal(next.allPagesRead, true); assert.equal(next.complete, false);
    assert.deepEqual(await read({ cursor: first.nextCursor! }), next);
    assert.deepEqual(calls, ['/scan', '/next']);
    await assert.rejects(read({ cursor: 'invented' }), /Invalid attention cursor/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test('rejects a changed or missing page instead of claiming complete coverage', async () => {
  for (const changed of [{ page: 3, scannedAt: 'first' }, { page: 2, scannedAt: 'second' }]) {
    let calls = 0;
    const read = createAttentionReader(async () => Response.json({ items: [], sources: [], complete: true, more: calls++ === 0, ...(calls === 1 ? { page: 1, scannedAt: 'first' } : changed) }), 'http://127.0.0.1', Date.now);
    await assert.rejects(read({}), /changed or returned incomplete/);
  }
});
test('MCP scan exposes no arbitrary query or mutation inputs', async () => {
  assert.equal(toolDefinitions.find(t => t.name === 'read_attention_scan')?.annotations.readOnlyHint, true);
  const call = createBridge({ fetchImpl: async () => { throw Error('Must not fetch invalid arguments'); } });
  await assert.rejects(call('read_attention_scan', { command: 'send mail' }), /Invalid tool arguments/);
});
