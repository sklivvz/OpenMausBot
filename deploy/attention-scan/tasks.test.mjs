import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from './server.mjs';
import { readTasks, taskReport, OPERATIONS_PROJECT } from './tasks.mjs';
const row = (id, extra = {}) => ({ id, project_id: OPERATIONS_PROJECT, content: id, priority: 1, ...extra });

test('fetches every page, counts by immutable project and preserves Operations detail', async () => {
  const calls = [];
  const snapshot = await readTasks({ account: 'fixture', now: () => Date.parse('2026-10-21T22:01:00Z'), read: async (tool, account, args) => {
    calls.push({ tool, account, args });
    return args.cursor ? { tasks: [row('b', { project_id: 'other', due: { date: '2026-10-22' } })] } : { tasks: [row('a', { due: { date: '2026-10-21' }, description: 'Keep this hold', labels: ['held'] }), row('c')], next_cursor: 'second' };
  } });
  assert.deepEqual(calls.map(c => c.args), [{ limit: 5 }, { limit: 5, cursor: 'second' }]);
  assert.ok(calls.every(c => c.tool === 'TODOIST_GET_ALL_TASKS' && c.account === 'fixture'));
  const all = taskReport(snapshot);
  assert.equal(all.totalOpen, 3); assert.equal(all.today, '2026-10-22');
  assert.equal(all.projects[OPERATIONS_PROJECT].overdue, 1); assert.equal(all.projects.other.dueToday, 1);
  assert.equal(all.tasks[0].description, undefined);
  const review = taskReport(snapshot, undefined, true);
  assert.equal(review.totalOpen, 3); assert.equal(review.tasks[0].description, 'Keep this hold');
  const ops = taskReport(snapshot, OPERATIONS_PROJECT);
  assert.equal(ops.totalOpen, 2); assert.equal(ops.tasks[0].description, 'Keep this hold'); assert.deepEqual(ops.tasks[0].labels, ['held']);
});

test('rejects partial pages, duplicate IDs, repeating cursors and time exhaustion', async () => {
  for (const data of [{}, { tasks: [], has_more: true }, { tasks: [row('a'), row('a')] }, { tasks: [], next_cursor: 'loop' }]) {
    await assert.rejects(readTasks({ read: async () => data, account: 'fixture' }));
  }
  let time = 0;
  await assert.rejects(readTasks({ read: async () => ({ tasks: [], next_cursor: 'next' }), account: 'fixture', now: () => (time += 120001) }), /timed out/);
});

test('HTTP commands expose only fixed reads, coalesce overlapping reads and reject arguments/origins', async () => {
  let calls = 0;
  const server = createServer(async () => { throw Error('unused'); }, async () => { calls++; await new Promise(r => setTimeout(r, 20)); return { checkedAt: '2026-10-21T09:00:00Z', complete: true, tasks: [row('a'), row('b', { project_id: 'other' })] }; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const [all, ops] = await Promise.all(['/tasks', '/operations'].map(async path => (await fetch(base + path, { method: 'POST' })).json()));
    assert.equal(calls, 1); assert.equal(all.totalOpen, 2); assert.equal(ops.totalOpen, 1);
    const review = await (await fetch(base + '/review', { method: 'POST' })).json();
    assert.equal(review.totalOpen, 2); assert.ok(review.tasks.every(t => typeof t.description === 'string'));
    assert.equal((await fetch(base + '/tasks', { method: 'POST', body: '{"command":"write"}' })).status, 400);
    assert.equal((await fetch(base + '/tasks', { method: 'POST', headers: { origin: 'https://example.test' } })).status, 403);
    assert.equal((await fetch(base + '/delete', { method: 'POST' })).status, 404);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
