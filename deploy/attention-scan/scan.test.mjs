import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createReader, runScan, unwrap } from './scan.mjs';
import { createServer } from './server.mjs';

const accounts = { gmailWork: 'work-mail', gmailPersonal: 'personal-mail', slack: 'slack', slackUser: 'U123' };
const frame = data => ({ result: { content: [{ type: 'text', text: JSON.stringify({ successful: true,
  data: { results: [{ response: { successful: true, data } }] } }) }] } });

test('fixed read-only operations paginate all sources and return compact evidence', async () => {
  const calls = [];
  const read = createReader({ url: 'http://127.0.0.1/fake', token: 'fixture-only', fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    const call = request.params.arguments.tools[0];
    calls.push(call);
    let data;
    if (call.tool_slug === 'GMAIL_FETCH_EMAILS') data = call.arguments.page_token
      ? { messages: [{ id: 'm2', subject: 'Second page' }] }
      : { messages: [{ id: 'm1', subject: 'First page', payload: { secret: 'unneeded full body' } }], nextPageToken: 'next' };
    else data = call.arguments.page === 1
      ? { messages: { matches: [{ ts: '1', channel: { id: 'D1' }, text: 'Please review' }], paging: { page: 1, pages: 2 } } }
      : { messages: { matches: [{ ts: '2', channel: { id: 'D1' }, text: 'Second page' }], paging: { page: 2, pages: 2 } } };
    return new Response('data: ' + JSON.stringify({ id: request.id, ...frame(data) }) + '\n\n');
  } });
  const report = await runScan({ read, accounts, now: Date.UTC(2026, 9, 20) });
  assert.equal(report.complete, true);
  assert.deepEqual(report.sources.map(s => s.source), ['work_email', 'personal_email', 'slack_mentions', 'slack_direct']);
  assert.equal(report.sources[0].items.length, 2);
  assert.equal(report.sources[3].items.length, 2);
  assert.ok(!JSON.stringify(report).includes('unneeded full body'));
  assert.equal(calls.length, 8);
  assert.ok(calls.every(c => ['GMAIL_FETCH_EMAILS', 'SLACK_SEARCH_MESSAGES'].includes(c.tool_slug)));
  assert.ok(calls.every(c => c.account));
  assert.ok(calls.filter(c => c.tool_slug === 'GMAIL_FETCH_EMAILS').every(c => c.arguments.include_payload === false));
  for (const tool of ['GMAIL_SEND_EMAIL', 'TODOIST_GET_ALL_TASKS']) await assert.rejects(read(tool, 'work-mail', {}), /Only the fixed/);
});

test('one failed source does not hide other results or claim the scan is complete', async () => {
  const report = await runScan({ accounts, read: async (tool, account) => {
    if (account === 'work-mail') throw new Error('Connector HTTP 503');
    if (tool === 'GMAIL_FETCH_EMAILS') return { messages: [] };
    return { messages: { matches: [], total: 0 } };
  } });
  assert.equal(report.complete, false);
  assert.equal(report.sources.filter(s => s.complete).length, 3);
  assert.match(report.sources[0].error, /503/);
});

test('offloaded results, repeated cursors and page limits cannot look like an empty inbox', async () => {
  assert.throws(() => unwrap({ result: { structuredContent: { data: { remote_file_info: {} } } } }), /offloaded/);
  const report = await runScan({ accounts, maxPages: 2, read: async tool => tool === 'GMAIL_FETCH_EMAILS'
    ? { messages: [{ id: 'm1' }], nextPageToken: 'again' }
    : { messages: { matches: [], paging: { page: 1, pages: 9 } } } });
  assert.equal(report.complete, false);
  assert.ok(report.sources.every(s => !s.complete));
});

test('HTTP tool has no arbitrary tool, account, query, shell or write inputs and shares concurrent scans', async () => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const server = createServer(async () => { calls++; await gate; return { complete: true, sources: [] }; });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(url + '/scan', { method: 'POST', body: '{"tool":"send"}' })).status, 400);
    for (const route of ['/write', '/tasks', '/operations', '/review']) assert.equal((await fetch(url + route, { method: 'POST' })).status, 404);
    assert.equal(calls, 0);
    const first = fetch(url + '/scan', { method: 'POST' });
    const second = fetch(url + '/scan', { method: 'POST' });
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    assert.equal((await (await first).json()).complete, true);
    assert.equal((await (await second).json()).complete, true);
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('tool pages retain every source item within the output budget', async () => {
  const items = Array.from({ length: 55 }, (_, i) => ({ id: String(i), text: 'x'.repeat(700) }));
  const server = createServer(async () => ({ complete: true, sources: [{ source: 'slack', complete: true, items }] }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    const all = [];
    let route = '/scan';
    for (;;) {
      const text = await (await fetch(url + route, { method: 'POST' })).text();
      assert.ok(Buffer.byteLength(text) < 9500);
      const page = JSON.parse(text);
      all.push(...page.items.map(item => item.id));
      if (!page.more) break;
      route = '/next';
    }
    assert.deepEqual(all, items.map(item => item.id));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
