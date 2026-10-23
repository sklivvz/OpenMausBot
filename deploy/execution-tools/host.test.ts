import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createExecutionTools, executionToolDefinitions } from './host.ts';

async function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-host-'));
  const artifacts = path.join(directory, 'artifacts'), privateRoot = path.join(directory, 'private'); fs.mkdirSync(artifacts); fs.mkdirSync(privateRoot, { mode: 0o700 });
  const signingKeyFile = path.join(privateRoot, 'signing-key'), brokerTokenFile = path.join(privateRoot, 'broker-token');
  fs.writeFileSync(signingKeyFile, Buffer.alloc(32, 7), { mode: 0o600 }); fs.writeFileSync(brokerTokenFile, 'fixture-token', { mode: 0o600 });
  const artifact = path.join(artifacts, 'proposal.txt'); fs.writeFileSync(artifact, 'baseline');
  let task = { id: 't1', project_id: 'p1', content: 'Keep user wording', description: 'Original brief', labels: ['unchanged'], priority: 4, due: { date: '2026-10-30' }, updated_at: 'v1' };
  let writes = 0, stopped = false;
  const job = () => ({ threadId: 'thread1', version: stopped ? 'v2' : 'v1', scope: 'job', since: 0, now: Date.now(), hidden: 0, roots: ['root1'], nodes: [{ id: 'root1', rootId: 'root1', botId: 'bot1', threadId: 'thread1', status: stopped ? 'completed' : 'running', ...(stopped ? { outcome: 'stopped' } : {}), executions: 1 }], counts: { queued: 0, running: stopped ? 0 : 1, waiting: 0, needsInput: 0, completed: stopped ? 1 : 0, failed: 0, cancelled: 0 } });
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/review') return res.end(JSON.stringify({ checkedAt: new Date().toISOString(), complete: true, totalOpen: 1, tasks: [{ id: task.id, projectId: task.project_id, title: task.content, description: task.description }] }));
    if (req.url?.includes('/job?')) return res.end(JSON.stringify(job()));
    if (req.url === '/api/bots?messages=0') return res.end(JSON.stringify({ bots: [{ id: 'bot1', name: 'Fixture', tasks: [{ threadId: 'thread1' }] }] }));
    if (req.url?.includes('/messages?')) return res.end(JSON.stringify({ messages: [{ id: 'm1', role: 'user', kind: 'text', text: 'Prepare the artifact' }], activeLeafId: 'm1', hasMore: false }));
    if (req.url !== '/v1/mcp') { res.writeHead(404); return res.end('{}'); }
    assert.equal(req.headers.authorization, 'Bearer fixture-token');
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body), op = request.params.arguments.tools[0];
    assert.equal(op.account, 'work');
    if (op.tool_slug === 'TODOIST_UPDATE_TASK') { assert.deepEqual(Object.keys(op.arguments).sort(), ['description', 'task_id']); task = { ...task, description: op.arguments.description, updated_at: 'v2' }; writes++; }
    else assert.equal(op.tool_slug, 'TODOIST_GET_ALL_TASKS');
    const data = op.tool_slug === 'TODOIST_GET_ALL_TASKS' ? { tasks: [task], next_cursor: null } : task;
    res.end(JSON.stringify({ id: request.id, result: { structuredContent: { data: { results: [{ response: { successful: true, data } }] } } } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = { appUrl: origin, queueUrl: origin + '/review', evidenceDir: path.join(privateRoot, 'queue'), receiptDir: path.join(privateRoot, 'receipts'), progressReceiptDir: path.join(privateRoot, 'progress'), signingKeyFile, artifactRoots: [artifacts], allowedProjects: ['p1'], brokerOrigin: origin, brokerTokenFile };
  const host = createExecutionTools(config);
  const receipt = (operationId: string) => ({ operationId, botId: 'bot1', taskId: 't1', objectiveId: 'objective1', projectId: 'p1', sourceVersion: 'v1', nextStep: 'Review proposal', evidence: [{ kind: 'artifact', id: 'proposal', path: artifact }] });
  const progress = (evidenceId: string, sha: string) => ({ taskId: 't1', projectId: 'p1', operationId: 'update1', expectedTaskSha256: sha, owner: 'Fixture owner', status: 'in_progress', nextAction: 'Review proposal', evidenceIds: [evidenceId] });
  return { host, config, receipt, progress, artifact, directory, privateRoot, writes: () => writes, task: () => task, stop: () => { stopped = true; }, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); } };
}
const call = async (host: ReturnType<typeof createExecutionTools>, name: string, input?: unknown): Promise<any> => host.call(name, input);

test('joined artifact baseline/change, authenticated receipt, Todoist write and exact readback use real HTTP fixtures', async () => {
  const f = await fixture(); try {
    const baseline = await call(f.host, 'record_execution_receipt', f.receipt('baseline')); assert.equal(baseline.outcome, 'unverified');
    const initial = await call(f.host, 'inspect_todoist_progress', { taskId: 't1', projectId: 'p1' });
    await assert.rejects(call(f.host, 'update_todoist_progress', f.progress('baseline', initial.taskSha256)));
    fs.writeFileSync(f.artifact, 'Actual revised artifact');
    const changed = await call(f.host, 'record_execution_receipt', f.receipt('changed')); assert.equal(changed.outcome, 'progressed'); assert.equal(changed.acceptance, 'unverified'); assert(!('signature' in changed));
    const updated = await call(f.host, 'update_todoist_progress', f.progress('changed', initial.taskSha256)); assert.equal(updated.state, 'verified'); assert.equal(f.writes(), 1);
    assert.equal(f.task().content, 'Keep user wording'); assert.deepEqual(f.task().labels, ['unchanged']); assert.equal(f.task().due.date, '2026-10-30');
    assert.equal((await call(f.host, 'inspect_todoist_progress', { taskId: 't1', projectId: 'p1' })).taskSha256, updated.taskSha256);
    assert.equal((await call(f.host, 'update_todoist_progress', f.progress('changed', initial.taskSha256))).replayed, true); assert.equal(f.writes(), 1);
  } finally { await f.close(); }
});
test('stopped assignment and caller success fields cannot support Todoist progress', async () => {
  const f = await fixture(); try {
    f.stop(); const input = { ...f.receipt('stopped'), evidence: [{ kind: 'assignment', id: 'root1', threadId: 'thread1', rootId: 'root1' }] };
    const receipt = await call(f.host, 'record_execution_receipt', input); assert.equal(receipt.outcome, 'unverified'); assert.deepEqual(receipt.supportedStatuses, []);
    const inspected = await call(f.host, 'inspect_todoist_progress', { taskId: 't1', projectId: 'p1' }); await assert.rejects(call(f.host, 'update_todoist_progress', f.progress('stopped', inspected.taskSha256)));
    await assert.rejects(call(f.host, 'record_execution_receipt', { ...input, operationId: 'cheat', verified: true }));
    await assert.rejects(call(f.host, 'record_execution_receipt', { ...input, operationId: 'other', projectId: 'other-project' }));
    assert.equal(f.writes(), 0);
  } finally { await f.close(); }
});
test('wrong receipt signing key cannot authorize an update and private stores cannot sit under artifact roots', async () => {
  const f = await fixture(); try {
    await call(f.host, 'record_execution_receipt', f.receipt('baseline')); fs.writeFileSync(f.artifact, 'Changed'); await call(f.host, 'record_execution_receipt', f.receipt('changed'));
    const wrong = path.join(f.privateRoot, 'wrong-key'); fs.writeFileSync(wrong, Buffer.alloc(32, 9), { mode: 0o600 });
    const other = createExecutionTools({ ...f.config, signingKeyFile: wrong }); const inspected = await call(other, 'inspect_todoist_progress', { taskId: 't1', projectId: 'p1' }); await assert.rejects(call(other, 'update_todoist_progress', f.progress('changed', inspected.taskSha256)));
    fs.writeFileSync(wrong, Buffer.alloc(5), { mode: 0o600 }); assert.throws(() => createExecutionTools({ ...f.config, signingKeyFile: wrong }), /key length/);
    assert.throws(() => createExecutionTools({ ...f.config, artifactRoots: [f.directory] }), /outside artifact roots/); assert.equal(f.writes(), 0);
  } finally { await f.close(); }
});
test('read-only queue/context, handoff and tracking remain available without progress credentials', async () => {
  const f = await fixture(); try {
    const { brokerOrigin: _origin, brokerTokenFile: _file, ...config } = f.config;
    const host = createExecutionTools(config); const queue = await call(host, 'read_execution_queue'); assert.equal(queue.sourceComplete, true);
    const context = await call(host, 'read_execution_context', { snapshotId: queue.snapshotId, taskId: 't1', threadId: 'thread1' }); assert.equal(context.sourceComplete, true);
    const tracked = await call(host, 'track_existing_assignments', { threadId: 'thread1', rootId: 'root1', assignmentIds: ['root1'] }); assert.equal(tracked.status, 'tracked'); assert.equal(tracked.assignments[0].action, 'reuse_and_wait');
    const handoff = await call(host, 'validate_handoff', {}); assert.notEqual(handoff.status, 'ready');
    await assert.rejects(call(host, 'inspect_todoist_progress', { taskId: 't1', projectId: 'p1' }), /not configured/);
    await assert.rejects(call(host, 'record_execution_receipt', { ...f.receipt('url-injection'), appUrl: 'https://example.test' }));
  } finally { await f.close(); }
});
test('real bundled stdio MCP exposes seven tools and executes the same read path', async () => {
  const f = await fixture(); const bundle = path.join(f.directory, 'host.cjs'), configFile = path.join(f.privateRoot, 'config.json');
  await build({ entryPoints: [path.resolve('deploy/execution-tools/main.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'silent' }); fs.writeFileSync(configFile, JSON.stringify(f.config), { mode: 0o600 });
  const child = spawn(process.execPath, [bundle], { env: { ...process.env, EXECUTION_TOOLS_CONFIG_FILE: configFile }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); let next = 0;
  const pending = new Map<number, (value: any) => void>(); const lines = readline.createInterface({ input: child.stdout }); lines.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id); });
  const rpc = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => { const id = ++next; const timer = setTimeout(() => reject(Error('Fixture MCP timeout: ' + stderr)), 10000); pending.set(id, value => { clearTimeout(timer); resolve(value); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    const init = await rpc('initialize'); assert.equal(init.result.serverInfo.name, 'execution-tools');
    const listed = await rpc('tools/list'); assert.equal(listed.result.tools.length, 7); assert.deepEqual(listed.result.tools.map((t: any) => t.name), executionToolDefinitions.map(t => t.name));
    const inspected = await rpc('tools/call', { name: 'inspect_todoist_progress', arguments: { taskId: 't1', projectId: 'p1' } }); assert.equal(inspected.result.isError, undefined); assert.equal(JSON.parse(inspected.result.content[0].text).title, 'Keep user wording');
    const invalid = await rpc('tools/call', { name: 'TODOIST_CLOSE_TASK_V1', arguments: {} }); assert.equal(invalid.result.isError, true); assert(!JSON.stringify(invalid).includes('fixture-token')); assert.equal(f.writes(), 0);
  } finally { child.stdin.end(); await new Promise<void>(resolve => child.once('exit', () => resolve())); lines.close(); await f.close(); }
});
