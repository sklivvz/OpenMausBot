import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { createTodoistProgress, taskSha256 } from './progress.ts';
import { createProgressRpc } from './transport.mjs';

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-progress-'));
  let task: Record<string, unknown> = { id: 't1', project_id: 'p1', content: 'User title', description: 'Original instructions\nKeep them exactly.', priority: 4, due: { date: '2026-10-23' }, deadline: { date: '2026-10-25' }, labels: ['a'], parent_id: 'parent', assignee_id: 'person', updated_at: 'v1' };
  const calls: { slug: string; args: Record<string, unknown> }[] = [];
  let failAfterWrite = false, failBeforeWrite = false, changeOtherField = false, readFails = false;
  let evidenceValid = true;
  const rpc = async (slug: string, args: Record<string, unknown>) => {
    calls.push({ slug, args });
    if (slug === 'TODOIST_GET_ALL_TASKS') { assert.deepEqual(args, { ids: ['t1'], limit: 5 }); if (readFails) throw Error('offline'); return { tasks: [structuredClone(task)], next_cursor: null }; }
    assert.equal(slug, 'TODOIST_UPDATE_TASK');
    assert.deepEqual(Object.keys(args).sort(), ['description', 'task_id']);
    if (failBeforeWrite) throw Error('lost connection');
    task = { ...task, description: args.description, updated_at: 'v2', ...(changeOtherField ? { content: 'External edit' } : {}) };
    if (failAfterWrite) throw Error('lost response');
    return {};
  };
  const verifyEvidence = async (ids: string[], target: { taskId: string; status: string }) => evidenceValid ? ids.map(receiptId => ({ receiptId, taskId: target.taskId, sha256: 'a'.repeat(64), reference: 'fixture:verified-operation', supportedStatuses: [target.status] })) : [];
  const tool = createTodoistProgress({ rpc, receiptDir: directory, allowedProjects: ['p1'], verifyEvidence, now: () => '2026-10-23T20:00:00.000Z' });
  const input = () => ({ taskId: 't1', projectId: 'p1', operationId: 'op1', expectedTaskSha256: taskSha256(task), owner: 'Owner', status: 'in_progress', nextAction: 'Review the prepared artifact', evidenceIds: ['e1'] });
  return { directory, tool, input, calls, task: () => task, mutate: (patch: Record<string, unknown>) => { task = { ...task, ...patch }; }, flags: (flags: Record<string, boolean>) => { failAfterWrite = flags.failAfterWrite ?? failAfterWrite; failBeforeWrite = flags.failBeforeWrite ?? failBeforeWrite; changeOtherField = flags.changeOtherField ?? changeOtherField; readFails = flags.readFails ?? readFails; evidenceValid = flags.evidenceValid ?? evidenceValid; }, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test('progress preserves all user fields and exact outside-block text with verified readback', async () => {
  const f = fixture(); try {
    const before = structuredClone(f.task());
    const inspected = await f.tool.inspect({ taskId: 't1', projectId: 'p1' }); assert.equal(inspected.taskSha256, f.input().expectedTaskSha256);
    const result = await f.tool.update(f.input()); assert.equal(result.state, 'verified'); assert.equal(result.changed, true);
    assert(String(f.task().description).startsWith(String(before.description) + '\n\n'));
    for (const key of Object.keys(before).filter(k => !['description', 'updated_at'].includes(k))) assert.deepEqual(f.task()[key], before[key]);
    assert.equal(JSON.parse(fs.readFileSync(result.receiptFile, 'utf8')).state, 'verified');
  } finally { f.cleanup(); }
});
test('same operation and unchanged progress under a new operation never repeat writes', async () => {
  const f = fixture(); try {
    const input = f.input(); await f.tool.update(input);
    assert.equal((await f.tool.update(input)).replayed, true);
    assert.equal((await f.tool.update({ ...f.input(), operationId: 'op2' })).changed, false);
    assert.equal(f.calls.filter(c => c.slug === 'TODOIST_UPDATE_TASK').length, 1);
  } finally { f.cleanup(); }
});
test('changed progress keeps suffix and unrelated edits intact', async () => {
  const f = fixture(); try {
    await f.tool.update(f.input()); f.mutate({ description: f.task().description + '\nUser addition after block.' });
    await f.tool.update({ ...f.input(), operationId: 'op2', nextAction: 'Inspect revised artifact' });
    assert(String(f.task().description).endsWith('\nUser addition after block.'));
  } finally { f.cleanup(); }
});
test('stale task and changed operation identity are rejected before mutation', async () => {
  const f = fixture(); try {
    const old = f.input(); f.mutate({ content: 'New user title' }); await assert.rejects(f.tool.update(old), /Task changed/);
    const current = f.input(); await f.tool.update(current); await assert.rejects(f.tool.update({ ...current, nextAction: 'Different' }), /identity/);
    assert.equal(f.calls.filter(c => c.slug === 'TODOIST_UPDATE_TASK').length, 1);
  } finally { f.cleanup(); }
});
test('lost write response reconciles exact readback without another mutation', async () => {
  const f = fixture(); try { f.flags({ failAfterWrite: true }); const input = f.input(); const result = await f.tool.update(input); assert.equal(result.reconciledTransportFailure, true); assert.equal((await f.tool.update(input)).replayed, true); assert.equal(f.calls.filter(c => c.slug === 'TODOIST_UPDATE_TASK').length, 1); } finally { f.cleanup(); }
});
test('unknown failed write blocks all blind replay', async () => {
  const f = fixture(); try {
    f.flags({ failBeforeWrite: true }); const input = f.input(); await assert.rejects(f.tool.update(input), /unverified/);
    f.flags({ failBeforeWrite: false }); await assert.rejects(f.tool.update(input), /reconciliation/);
    await assert.rejects(f.tool.update({ ...f.input(), operationId: 'op2' }), /cannot bypass/);
    assert.equal(f.calls.filter(c => c.slug === 'TODOIST_UPDATE_TASK').length, 1);
  } finally { f.cleanup(); }
});
test('readback changes to preserved fields are not verified or rolled back', async () => {
  const f = fixture(); try { f.flags({ changeOtherField: true }); await assert.rejects(f.tool.update(f.input()), /unverified/); assert.equal(f.task().content, 'External edit'); assert.equal(f.calls.filter(c => c.slug === 'TODOIST_UPDATE_TASK').length, 1); } finally { f.cleanup(); }
});
test('invalid evidence, scope, completion and waiting dependencies cannot write', async () => {
  const f = fixture(); try {
    f.flags({ evidenceValid: false }); await assert.rejects(f.tool.update(f.input()), /Host-verified/); f.flags({ evidenceValid: true });
    await assert.rejects(f.tool.update({ ...f.input(), status: 'done' })); await assert.rejects(f.tool.update({ ...f.input(), status: 'waiting_user' }), /blocker/);
    await assert.rejects(f.tool.update({ ...f.input(), projectId: 'other' }), /scope/);
    await assert.rejects(f.tool.update({ ...f.input(), evidenceIds: ['e1', 'e1'] }), /Duplicate/);
    assert.equal(f.calls.filter(c => c.slug === 'TODOIST_UPDATE_TASK').length, 0);
  } finally { f.cleanup(); }
});
test('ambiguous or injected managed delimiters cannot damage user text', async () => {
  const f = fixture(); try {
    f.mutate({ description: 'before <!-- openmaus-progress:start --> broken' }); await assert.rejects(f.tool.update(f.input()), /Ambiguous/);
    f.mutate({ description: 'Original' }); await assert.rejects(f.tool.update({ ...f.input(), nextAction: '<!-- openmaus-progress:end -->' }), /reserved/);
    assert.equal(f.calls.filter(c => c.slug === 'TODOIST_UPDATE_TASK').length, 0);
  } finally { f.cleanup(); }
});
test('task lock survives uncertainty and excludes another writer without lease expiry', async () => {
  const f = fixture(); try { fs.writeFileSync(path.join(f.directory, 'task-t1.lock'), '{}'); await assert.rejects(f.tool.update(f.input()), /owns this task lock/); assert.equal(f.calls.length, 0); } finally { f.cleanup(); }
});
test('targeted reads reject incomplete, duplicate, wrong-project and ignored-filter responses without pagination', async () => {
  for (const result of [{ tasks: [{ id: 'unrelated', content: 'a', project_id: 'p1' }] }, { tasks: [{ id: 't1', content: 'a', project_id: 'other-project' }] }, { tasks: [], has_more: true }, { tasks: [], next_cursor: 'same' }, { tasks: [{ id: 't1', content: 'a', project_id: 'p1' }, { id: 't1', content: 'a', project_id: 'p1' }] }]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-progress-pages-'));
    try { let reads = 0; const tool = createTodoistProgress({ receiptDir: directory, allowedProjects: ['p1'], rpc: async (_slug, args) => { reads++; assert.deepEqual(args, { ids: ['t1'], limit: 5 }); return result; }, verifyEvidence: async () => [] }); await assert.rejects(tool.inspect({ taskId: 't1', projectId: 'p1' })); assert.equal(reads, 1); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});
test('actual connector transport uses existing account and fixed read/update operations only', async () => {
  let mutations = 0;
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    const call = JSON.parse(data), operation = call.params.arguments.tools[0];
    assert.equal(operation.account, 'work'); if (operation.tool_slug === 'TODOIST_UPDATE_TASK') mutations++;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: call.id, result: { structuredContent: { successful: true, data: { results: [{ response: { successful: true, data: { tasks: [], next_cursor: null } } }] } } } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const rpc = createProgressRpc({ origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: 'fixture-only' });
    await rpc('TODOIST_GET_ALL_TASKS', {}); await rpc('TODOIST_UPDATE_TASK', { task_id: 't1', description: 'fixture' });
    assert.throws(() => rpc('TODOIST_CLOSE_TASK_V1', {}), /Unsupported/); assert.equal(mutations, 1);
  } finally { server.close(); }
});
test('complete progress workflow runs through isolated HTTP provider and verifies persisted task bytes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-progress-http-'));
  let task = { id: 'http-task', project_id: 'p1', content: 'Preserved title', description: 'Original text', labels: ['keep'], due: { date: '2026-10-30' }, updated_at: 'v1' };
  let mutations = 0;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body), op = request.params.arguments.tools[0];
    if (op.tool_slug === 'TODOIST_GET_ALL_TASKS') assert.deepEqual(op.arguments, { ids: ['http-task'], limit: 5 });
    if (op.tool_slug === 'TODOIST_UPDATE_TASK') { task = { ...task, description: op.arguments.description, updated_at: 'v2' }; mutations++; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: request.id, result: { structuredContent: { data: { results: [{ response: { successful: true, data: op.tool_slug === 'TODOIST_GET_ALL_TASKS' ? { tasks: [task], next_cursor: null } : task } }] } } } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const tool = createTodoistProgress({ receiptDir: directory, allowedProjects: ['p1'], rpc: createProgressRpc({ origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: 'fixture' }), verifyEvidence: async ids => ids.map(receiptId => ({ receiptId, taskId: task.id, sha256: 'b'.repeat(64), reference: 'fixture:artifact-change', supportedStatuses: ['in_progress'] })) });
    const before = await tool.inspect({ taskId: task.id, projectId: 'p1' });
    const input = { taskId: task.id, projectId: 'p1', operationId: 'fixture-op', expectedTaskSha256: before.taskSha256, owner: 'Fixture owner', status: 'in_progress', nextAction: 'Review artifact', evidenceIds: ['fixture-receipt'] };
    const result = await tool.update(input); assert.equal(result.state, 'verified');
    await tool.update(input); assert.equal(mutations, 1); assert.equal(task.content, 'Preserved title'); assert.deepEqual(task.labels, ['keep']); assert.equal(task.due.date, '2026-10-30');
    assert.equal((await tool.inspect({ taskId: task.id, projectId: 'p1' })).taskSha256, result.taskSha256);
  } finally { server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('redirected connector calls never forward authorization to another endpoint', async () => {
  let forwarded = false;
  const target = http.createServer((req, res) => { forwarded = Boolean(req.headers.authorization); res.end('{}'); });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  const source = http.createServer((req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${(target.address() as { port: number }).port}` }); res.end(); });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  try { const rpc = createProgressRpc({ origin: `http://127.0.0.1:${(source.address() as { port: number }).port}`, token: 'fixture' }); await assert.rejects(rpc('TODOIST_GET_ALL_TASKS', {})); assert.equal(forwarded, false); } finally { source.close(); target.close(); }
});
