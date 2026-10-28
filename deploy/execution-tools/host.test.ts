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
  const signingKeyFile = path.join(privateRoot, 'signing-key'), tasksConfigFile = path.join(privateRoot, 'omb-config.json');
  fs.writeFileSync(signingKeyFile, Buffer.alloc(32, 7), { mode: 0o600 });
  const artifact = path.join(artifacts, 'proposal.txt'); fs.writeFileSync(artifact, 'baseline');
  const task = { id: 't1', title: 'Keep user wording', status: 'unestimated', department: { id: 'p1', name: 'Fixture' }, due_on: '2026-10-30', archived_at: null, parent: null, objective: 'Keep user wording', description: 'Original brief', criteria: ['Reviewed'], progress: null, version: 1, updated_at: '2026-10-25T10:00:00Z' };
  const authorizations: (string | undefined)[] = [];
  let stopped = false;
  const job = () => ({ threadId: 'thread1', version: stopped ? 'v2' : 'v1', scope: 'job', since: 0, now: Date.now(), hidden: 0, roots: ['root1'], nodes: [{ id: 'root1', rootId: 'root1', botId: 'bot1', threadId: 'thread1', status: stopped ? 'completed' : 'running', ...(stopped ? { outcome: 'stopped' } : {}), executions: 1 }], counts: { queued: 0, running: stopped ? 0 : 1, waiting: 0, needsInput: 0, completed: stopped ? 1 : 0, failed: 0, cancelled: 0 } });
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/api/v1/')) {
      authorizations.push(req.headers.authorization);
      if (req.method !== 'GET') { res.writeHead(405); return res.end('{}'); }
      if (req.url.startsWith('/api/v1/tasks?')) return res.end(JSON.stringify({ items: [task], total: 1, limit: 200, offset: 0 }));
      if (req.url === '/api/v1/tasks/t1') return res.end(JSON.stringify(task));
    }
    if (req.url?.includes('/job?')) return res.end(JSON.stringify(job()));
    if (req.url === '/api/bots?messages=0') return res.end(JSON.stringify({ bots: [{ id: 'bot1', name: 'Fixture', tasks: [{ threadId: 'thread1' }] }] }));
    if (req.url?.includes('/messages?')) return res.end(JSON.stringify({ messages: [{ id: 'm1', role: 'user', kind: 'text', text: 'Prepare the artifact' }], activeLeafId: 'm1', hasMore: false }));
    res.writeHead(404); return res.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  fs.writeFileSync(tasksConfigFile, JSON.stringify({ mcpServers: { 'positron-tasks-fixture': { type: 'http', url: origin + '/mcp', headers: { Authorization: 'Bearer fixture-token-0123456789' }, enabled: true } } }), { mode: 0o600 });
  const config = { appUrl: origin, tasksOrigin: origin, tasksConfigFile, tasksServer: 'positron-tasks-fixture', evidenceDir: path.join(privateRoot, 'queue'), receiptDir: path.join(privateRoot, 'receipts'), signingKeyFile, artifactRoots: [artifacts], allowedProjects: ['p1'] };
  const host = createExecutionTools(config);
  const receipt = (operationId: string) => ({ operationId, botId: 'bot1', taskId: 't1', objectiveId: 'objective1', projectId: 'p1', sourceVersion: 'v1', nextStep: 'Review proposal', evidence: [{ kind: 'artifact', id: 'proposal', path: artifact }] });
  return { host, config, receipt, artifact, directory, privateRoot, authorizations, stop: () => { stopped = true; }, close: async () => { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true }); } };
}
const call = async (host: ReturnType<typeof createExecutionTools>, name: string, input?: unknown): Promise<any> => host.call(name, input);

test('joined artifact baseline and change produce an authenticated receipt without task writes', async () => {
  const f = await fixture(); try {
    const baseline = await call(f.host, 'record_execution_receipt', f.receipt('baseline')); assert.equal(baseline.outcome, 'unverified');
    fs.writeFileSync(f.artifact, 'Actual revised artifact');
    const changed = await call(f.host, 'record_execution_receipt', f.receipt('changed')); assert.equal(changed.outcome, 'progressed'); assert.equal(changed.acceptance, 'unverified'); assert(!('signature' in changed));
    await assert.rejects(call(f.host, 'record_execution_receipt', { ...f.receipt('other'), projectId: 'other-project' }), /outside this execution host scope/);
  } finally { await f.close(); }
});
test('missing unrelated artifact roots are tolerated and the public schema exposes project scope', async () => {
  const f = await fixture(); try {
    const artifacts = path.dirname(f.artifact), missing = path.join(f.directory, 'missing-workspace');
    const host = createExecutionTools({ ...f.config, artifactRoots: [missing, artifacts] });
    const definition = host.tools.find(tool => tool.name === 'record_execution_receipt') as any;
    assert.ok(definition.inputSchema.required.includes('projectId'));
    assert.deepEqual(definition.inputSchema.properties.projectId.enum, ['p1']);
    assert.equal((await call(host, 'record_execution_receipt', f.receipt('missing-root-ok'))).outcome, 'unverified');
    await assert.rejects(call(host, 'record_execution_receipt', { ...f.receipt('no-project'), projectId: undefined }), (error: any) => {
      assert.equal(error.code, 'invalid_request');
      assert.match(JSON.stringify(error.details), /projectId/);
      return true;
    });
    await assert.rejects(call(host, 'record_execution_receipt', { ...f.receipt('bad-project'), projectId: 'other-project' }), (error: any) => {
      assert.equal(error.code, 'project_out_of_scope');
      assert.deepEqual(error.details.allowedProjects, ['p1']);
      return true;
    });
    const onlyMissing = createExecutionTools({ ...f.config, artifactRoots: [missing] });
    const failed = await call(onlyMissing, 'record_execution_receipt', f.receipt('missing-root-only'));
    assert.equal(failed.sourceComplete, false);
    assert.match(failed.gaps[0], /artifact_root_unavailable/);
  } finally { await f.close(); }
});
test('stopped assignment and caller success fields cannot support a receipt', async () => {
  const f = await fixture(); try {
    f.stop(); const input = { ...f.receipt('stopped'), evidence: [{ kind: 'assignment', id: 'root1', threadId: 'thread1', rootId: 'root1' }] };
    const receipt = await call(f.host, 'record_execution_receipt', input); assert.equal(receipt.outcome, 'unverified'); assert.deepEqual(receipt.supportedStatuses, []);
    await assert.rejects(call(f.host, 'record_execution_receipt', { ...input, operationId: 'cheat', verified: true }));
  } finally { await f.close(); }
});
test('signing key length, private stores and removed Todoist settings are validated', async () => {
  const f = await fixture(); try {
    const wrong = path.join(f.privateRoot, 'wrong-key'); fs.writeFileSync(wrong, Buffer.alloc(5), { mode: 0o600 }); assert.throws(() => createExecutionTools({ ...f.config, signingKeyFile: wrong }), /key length/);
    assert.throws(() => createExecutionTools({ ...f.config, artifactRoots: [f.directory] }), /outside artifact roots/);
    for (const legacy of [{ queueUrl: 'http://127.0.0.1:8798/review' }, { brokerOrigin: 'https://broker.example.test' }, { brokerTokenFile: wrong }, { progressReceiptDir: path.join(f.privateRoot, 'progress') }]) assert.throws(() => createExecutionTools({ ...f.config, ...legacy }));
  } finally { await f.close(); }
});
test('queue reads Positron Tasks with the configured credential; context, handoff and tracking remain available', async () => {
  const f = await fixture(); try {
    const queue = await call(f.host, 'read_execution_queue'); assert.equal(queue.sourceComplete, true); assert.equal(queue.rows[0].taskId, 't1'); assert.equal(queue.rows[0].projectId, 'p1');
    assert.ok(f.authorizations.length >= 2 && f.authorizations.every(value => value === 'Bearer fixture-token-0123456789'));
    assert.match(JSON.parse(fs.readFileSync(queue.evidenceFile, 'utf8')).tasks[0].description, /Original brief/);
    const context = await call(f.host, 'read_execution_context', { snapshotId: queue.snapshotId, taskId: 't1', threadId: 'thread1' }); assert.equal(context.sourceComplete, true);
    const tracked = await call(f.host, 'track_existing_assignments', { threadId: 'thread1', rootId: 'root1', assignmentIds: ['root1'] }); assert.equal(tracked.status, 'tracked'); assert.equal(tracked.assignments[0].action, 'reuse_and_wait');
    const handoff = await call(f.host, 'validate_handoff', {}); assert.notEqual(handoff.status, 'ready');
    await assert.rejects(call(f.host, 'record_execution_receipt', { ...f.receipt('url-injection'), appUrl: 'https://example.test' }));
    const missing = createExecutionTools({ ...f.config, tasksServer: 'positron-tasks-missing' });
    assert.equal((await call(missing, 'read_execution_queue')).status, 'source_failed');
  } finally { await f.close(); }
});
test('real bundled stdio MCP exposes five tools and executes the same read path', async () => {
  const f = await fixture(); const bundle = path.join(f.directory, 'host.cjs'), configFile = path.join(f.privateRoot, 'config.json');
  await build({ entryPoints: [path.resolve('deploy/execution-tools/main.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'silent' }); fs.writeFileSync(configFile, JSON.stringify(f.config), { mode: 0o600 });
  const child = spawn(process.execPath, [bundle], { env: { ...process.env, EXECUTION_TOOLS_CONFIG_FILE: configFile }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); let next = 0;
  const pending = new Map<number, (value: any) => void>(); const lines = readline.createInterface({ input: child.stdout }); lines.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id); });
  const rpc = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => { const id = ++next; const timer = setTimeout(() => reject(Error('Fixture MCP timeout: ' + stderr)), 10000); pending.set(id, value => { clearTimeout(timer); resolve(value); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    const init = await rpc('initialize'); assert.equal(init.result.serverInfo.name, 'execution-tools');
    const listed = await rpc('tools/list'); assert.deepEqual(listed.result.tools.map((t: any) => t.name), ['read_execution_queue', 'read_execution_context', 'validate_handoff', 'track_existing_assignments', 'record_execution_receipt']); assert.deepEqual(listed.result.tools.map((t: any) => t.name), executionToolDefinitions.map(t => t.name));
    const receiptDefinition = listed.result.tools.find((t: any) => t.name === 'record_execution_receipt');
    assert.ok(receiptDefinition.inputSchema.required.includes('projectId'));
    assert.deepEqual(receiptDefinition.inputSchema.properties.projectId.enum, ['p1']);
    const queue = await rpc('tools/call', { name: 'read_execution_queue', arguments: {} }); assert.equal(queue.result.isError, undefined); assert.equal(JSON.parse(queue.result.content[0].text).rows[0].title, 'Keep user wording');
    const noProject = await rpc('tools/call', { name: 'record_execution_receipt', arguments: { ...f.receipt('rpc-no-project'), projectId: undefined } });
    assert.equal(noProject.result.isError, true);
    const noProjectError = JSON.parse(noProject.result.content[0].text).error;
    assert.equal(noProjectError.code, 'invalid_request');
    assert.match(JSON.stringify(noProjectError.details), /projectId/);
    assert(!JSON.stringify(noProject).includes('fixture-token'));
    const wrongProject = await rpc('tools/call', { name: 'record_execution_receipt', arguments: { ...f.receipt('rpc-wrong-project'), projectId: 'other-project' } });
    assert.equal(wrongProject.result.isError, true);
    const wrongProjectError = JSON.parse(wrongProject.result.content[0].text).error;
    assert.equal(wrongProjectError.code, 'project_out_of_scope');
    assert.deepEqual(wrongProjectError.details.allowedProjects, ['p1']);
    for (const name of ['inspect_todoist_progress', 'update_todoist_progress']) { const removed = await rpc('tools/call', { name, arguments: { taskId: 't1', projectId: 'p1' } }); assert.equal(removed.result.isError, true); assert(!JSON.stringify(removed).includes('fixture-token')); }
  } finally { child.stdin.end(); await new Promise<void>(resolve => child.once('exit', () => resolve())); lines.close(); await f.close(); }
});
test('real bundled stdio MCP reports missing configuration as a typed tool error', async () => {
  const f = await fixture(); const bundle = path.join(f.directory, 'host.cjs');
  await build({ entryPoints: [path.resolve('deploy/execution-tools/main.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'silent' });
  const child = spawn(process.execPath, [bundle], { env: { ...process.env, EXECUTION_TOOLS_CONFIG_FILE: path.join(f.directory, 'absent-config.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); let next = 0;
  const pending = new Map<number, (value: any) => void>(); const lines = readline.createInterface({ input: child.stdout }); lines.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.(value); pending.delete(value.id); });
  const rpc = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => { const id = ++next; const timer = setTimeout(() => reject(Error('Fixture MCP timeout: ' + stderr)), 10000); pending.set(id, value => { clearTimeout(timer); resolve(value); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    const listed = await rpc('tools/list'); assert.equal(listed.result.tools.length, 5);
    const failed = await rpc('tools/call', { name: 'read_execution_queue', arguments: {} });
    assert.equal(failed.result.isError, true);
    const error = JSON.parse(failed.result.content[0].text).error;
    assert.equal(error.code, 'invalid_config');
    assert.match(error.message, /missing or unreadable/);
  } finally { child.stdin.end(); await new Promise<void>(resolve => child.once('exit', () => resolve())); lines.close(); await f.close(); }
});
