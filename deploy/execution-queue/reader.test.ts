import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createQueueReader, queueToolDefinitions } from './reader.ts';

const projectId = 'dept_ae3fffd71e795bbb';
function fixture(options: { count?: number; tweak?: (url: URL, value: any) => any; maxMessagePages?: number; maxSourceBytes?: number } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-fixture-'));
  let now = 1792780000000;
  const calls: string[] = [];
  const tasks = Array.from({ length: options.count ?? 18 }, (_, i) => ({ id: `task-${i}`, projectId, project: 'Marketing', title: 'Work ' + i, status: 'unestimated', description: 'Exact source '.repeat(300), updatedAt: '2026-10-23T18:00:00Z' }));
  const tweak = options.tweak ?? ((_: URL, value: any) => value);
  const read = createQueueReader({ directory, now: () => now, maxMessagePages: options.maxMessagePages, maxSourceBytes: options.maxSourceBytes,
    readTasks: async () => { calls.push('tasks'); return tweak(new URL('positron-tasks:/snapshot'), { complete: true, checkedAt: '2026-10-23T18:00:00Z', totalOpen: tasks.length, tasks }); },
    fetchImpl: (async (address: string, init: RequestInit) => {
      const url = new URL(address); calls.push((init.method ?? 'GET') + ' ' + url.pathname + url.search);
      let value: any;
      if (url.pathname === '/api/bots') value = { bots: [{ id: 'bot-1', name: 'Darcy', section: 'Marketing', tasks: [{ threadId: 'thread-1' }] }] };
      else if (url.pathname.endsWith('/messages')) value = url.searchParams.has('before')
        ? { messages: [{ id: 'm1', role: 'user', kind: 'text', text: 'Exact original task.', at: 1 }], hasMore: false, activeLeafId: 'm3' }
        : { messages: [{ id: 'm2', role: 'bot', kind: 'text', text: 'x'.repeat(500), at: 2 }, { id: 'm3', role: 'user', kind: 'text', text: 'Keep the send on hold.', at: 3 }], hasMore: true, activeLeafId: 'm3' };
      else if (url.pathname.endsWith('/job')) value = { threadId: 'thread-1', version: 'job-v1', hidden: 0, counts: { running: 1 }, nodes: [{ id: 'assignment-1', rootId: 'assignment-1', botId: 'liz', threadId: 'child-thread', status: 'running', result: 'Full result' }] };
      else throw Error('Unexpected request');
      value = tweak(url, value);
      return new Response(JSON.stringify(value), { status: 200 });
    }) as typeof fetch,
  });
  return { read, tasks, calls, directory, advance: () => { now += 600001; }, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('complete queue is retained once and compact paging makes no model/source calls', async () => {
  const f = fixture(); try {
    const a: any = await f.read('read_execution_queue'); assert.equal(a.sourceComplete, true); assert.equal(a.allPagesRead, false); assert.equal(a.rows.length, 15);
    assert(!JSON.stringify(a).includes('Exact source')); assert.equal(JSON.parse(fs.readFileSync(a.evidenceFile, 'utf8')).tasks[0].description, f.tasks[0].description);
    const b: any = await f.read('read_execution_queue', { cursor: a.nextCursor }); assert.equal(b.rows.length, 3); assert.equal(b.allPagesRead, true); assert.equal(b.sourceSha256, a.sourceSha256); assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});
test('empty project has complete coverage and a whole unfiltered source retained', async () => {
  const f = fixture(); try {
    const a: any = await f.read('read_execution_queue', { projectId: 'other-project' }); assert.equal(a.totalRows, 0); assert.equal(a.allPagesRead, true); assert.equal(JSON.parse(fs.readFileSync(a.evidenceFile, 'utf8')).source.tasks.length, 18);
  } finally { f.close(); }
});
test('partial, overlapping or inconsistent source never becomes an empty successful queue', async () => {
  for (const tweak of [(v: any) => ({ ...v, complete: false }), (v: any) => ({ ...v, totalOpen: 100 }), (v: any) => ({ ...v, tasks: [v.tasks[0], v.tasks[0]], totalOpen: 2 })]) {
    const f = fixture({ tweak: (_, v) => tweak(v) }); try { const a: any = await f.read('read_execution_queue'); assert.equal(a.status, 'source_failed'); assert.equal(a.sourceComplete, false); } finally { f.close(); }
  }
});
test('context retrieves every source page and actual assignments, retaining full text outside output', async () => {
  const f = fixture(); try {
    const q: any = await f.read('read_execution_queue');
    const a: any = await f.read('read_execution_context', { snapshotId: q.snapshotId, taskId: 'task-0', threadId: 'thread-1', expectedTaskSha256: q.rows[0].taskSha256 });
    assert.equal(a.sourceComplete, true); assert.equal(a.associationVerified, false); assert.equal(a.rows.length, 4); assert.equal(a.rows[0].id, 'm1'); assert.equal(a.rows[1].textTruncated, true); assert.equal(a.assignmentVersion, 'job-v1');
    const stored = JSON.parse(fs.readFileSync(a.evidenceFile, 'utf8')); assert.equal(stored.messages[1].text.length, 500); assert.equal(stored.job.nodes[0].result, 'Full result'); assert(f.calls.some(p => p.includes('before=m2')));
  } finally { f.close(); }
});
test('stale task references, expired cursors and cross-tool cursors are rejected', async () => {
  const f = fixture(); try {
    const q: any = await f.read('read_execution_queue');
    await assert.rejects(f.read('read_execution_context', { snapshotId: q.snapshotId, taskId: 'task-0', threadId: 'thread-1', expectedTaskSha256: '0'.repeat(64) }), /stale/);
    await assert.rejects(f.read('read_execution_context', { cursor: q.nextCursor }), /cursor/);
    f.advance(); await assert.rejects(f.read('read_execution_queue', { cursor: q.nextCursor }), /expired/);
  } finally { f.close(); }
});
test('missing or wrong-team conversation is a source failure, never guessed from title', async () => {
  const f = fixture({ tweak: (u, v) => u.pathname === '/api/bots' ? { bots: [] } : v }); try {
    const q: any = await f.read('read_execution_queue'); const a: any = await f.read('read_execution_context', { snapshotId: q.snapshotId, taskId: 'task-0', threadId: 'thread-1' }); assert.equal(a.status, 'source_failed');
  } finally { f.close(); }
});
test('conversation page limit, overlap and live changes preserve partial evidence and gaps', async () => {
  for (const options of [
    { maxMessagePages: 1 },
    { tweak: (u: URL, v: any) => u.searchParams.has('before') ? { ...v, messages: [{ id: 'm2' }], hasMore: false } : v },
    { tweak: (u: URL, v: any) => u.searchParams.has('before') ? { ...v, activeLeafId: 'new-leaf' } : v },
  ]) {
    const f = fixture(options); try { const q: any = await f.read('read_execution_queue'); const a: any = await f.read('read_execution_context', { snapshotId: q.snapshotId, taskId: 'task-0', threadId: 'thread-1' }); assert.equal(a.status, 'source_failed'); assert(a.gaps.length); assert(fs.existsSync(a.evidenceFile)); } finally { f.close(); }
  }
});
test('hidden, truncated or changed assignments cannot claim complete source coverage', async () => {
  let jobReads = 0;
  for (const tweak of [(v: any) => ({ ...v, hidden: 1 }), (v: any) => ({ ...v, counts: { running: 501 } }), (v: any) => ++jobReads === 1 ? v : { ...v, nodes: [{ ...v.nodes[0], result: 'Changed without version change' }] }]) {
    const f = fixture({ tweak: (u, v) => u.pathname.endsWith('/job') ? tweak(v) : v }); try { const q: any = await f.read('read_execution_queue'); const a: any = await f.read('read_execution_context', { snapshotId: q.snapshotId, taskId: 'task-0', threadId: 'thread-1' }); assert.equal(a.status, 'source_failed'); assert(a.gaps.some((s: string) => s.startsWith('assignments:'))); } finally { f.close(); }
  }
});
test('network failures retain earlier snapshots and explicit failure', async () => {
  let fail = false; const f = fixture({ tweak: (_, v) => { if (fail) throw Error('private token must not be exposed'); return v; } }); try {
    const q: any = await f.read('read_execution_queue'); fail = true; const failure: any = await f.read('read_execution_queue'); assert.equal(failure.status, 'source_failed'); assert(!JSON.stringify(failure).includes('private token')); assert(fs.existsSync(q.evidenceFile));
  } finally { f.close(); }
});
test('response limits and arbitrary commands/URLs are refused', async () => {
  const f = fixture({ maxSourceBytes: 50 }); try {
    const q: any = await f.read('read_execution_queue');
    assert.equal((await f.read('read_execution_context', { snapshotId: q.snapshotId, taskId: 'task-0', threadId: 'thread-1' }) as any).status, 'source_failed');
    await assert.rejects(f.read('read_execution_queue', { url: 'https://example.com' }), /Invalid/);
    await assert.rejects(f.read('publish', {}), /Invalid/);
    assert(queueToolDefinitions.every(d => d.inputSchema.type === 'object' && d.annotations.readOnlyHint));
  } finally { f.close(); }
});
