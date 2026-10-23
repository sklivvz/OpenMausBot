import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { PerkConnector, loadConfig, makeProvider } from './connector.mjs';
import { ENDPOINT, TOOLS } from './catalog.mjs';

const readName = 'trips_get_trip';
const prepareName = 'hotels_start_hotel_search';
const schema = { type: 'object', properties: { fixtureInput: { type: 'string' } }, required: ['fixtureInput'], additionalProperties: false };
const response = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omb-perk-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'evidence');
  await fs.mkdir(stateDir, { mode: 0o700 });
  const calls = [];
  let factoryCalls = 0;
  const config = { tokenFile: path.join(root, 'token.json'), stateDir, allowDrafts: true };
  await fs.writeFile(config.tokenFile, JSON.stringify({ access: 'fixture-secret', expiresAt: Date.now() + 3600000 }), { mode: 0o600 });
  const provider = {
    initialize: async () => ({}),
    list: async () => ({ tools: [readName, prepareName, 'expenses_approve_expense'].map((name) => ({ name, inputSchema: schema })) }),
    call: async (name, args) => { calls.push({ name, args }); return response({ fixture: true, checkout: 'https://app.perk.com/fixture-only' }); },
    close: async () => {},
    ...overrides,
  };
  const connector = new PerkConnector(config, { providerFactory: () => { factoryCalls++; return provider; } });
  const contract = async (operation = prepareName) => connector.invoke('perk_contract', { operation });
  const prepare = async (extra = {}) => connector.invoke('perk_prepare', { operation: prepareName, schemaHash: (await contract()).schemaHash, arguments: { fixtureInput: 'synthetic' }, operationId: 'fixture-operation-1', sourceRef: 'fixture://authorized-travel-request', ...extra });
  return { root, config, provider, connector, calls, contract, prepare, factoryCalls: () => factoryCalls };
}

test('only exact documented travel operations are exposed; schema is discovered, not invented', async (t) => {
  const f = await fixture(t);
  const status = await f.connector.invoke('perk_status');
  assert.deepEqual(status.operations.map((item) => item.operation), [readName, prepareName]);
  assert.equal(status.bookingBoundary, 'human_checkout_only');
  const contract = await f.contract();
  assert.deepEqual(contract.inputSchema, schema);
  assert.equal(contract.effect, 'prepare');
  assert.equal((await f.connector.invoke('perk_contract', { operation: 'expenses_approve_expense' })).reason, 'invalid_tool_arguments');
  assert.equal(f.calls.length, 0);
});

test('missing/expired/unsafe credentials block before any provider connection', async (t) => {
  const f = await fixture(t);
  await fs.unlink(f.config.tokenFile);
  assert.equal((await f.connector.invoke('perk_status')).reason, 'auth_missing');
  await fs.writeFile(f.config.tokenFile, JSON.stringify({ access: 'secret', expiresAt: 1 }), { mode: 0o600 });
  assert.equal((await f.connector.invoke('perk_status')).reason, 'auth_expired');
  await fs.chmod(f.config.tokenFile, 0o644);
  assert.equal((await f.connector.invoke('perk_status')).reason, 'private_file_permissions_required');
  assert.equal(f.factoryCalls(), 0);
});

test('injected credentials are reread for each request', async (t) => {
  const f = await fixture(t);
  const seen = [];
  let token = 'first';
  const connector = new PerkConnector(f.config, { credentialProvider: async () => ({ access: token, expiresAt: Date.now() + 3600000 }), providerFactory: (access) => { seen.push(access); return f.provider; } });
  await connector.invoke('perk_status');
  token = 'second';
  await connector.invoke('perk_status');
  assert.deepEqual(seen, ['first', 'second']);
});

test('disabled drafts, stale contracts and invalid vendor inputs never dispatch', async (t) => {
  const f = await fixture(t);
  f.config.allowDrafts = false;
  assert.equal((await f.prepare()).reason, 'draft_preparation_disabled');
  f.config.allowDrafts = true;
  assert.equal((await f.prepare({ schemaHash: 'a'.repeat(64) })).reason, 'schema_changed');
  assert.equal((await f.prepare({ arguments: { guessedVendorField: 'bad' } })).reason, 'provider_arguments_invalid');
  const c = await f.contract();
  assert.equal((await f.connector.invoke('perk_read', { operation: prepareName, schemaHash: c.schemaHash, arguments: { fixtureInput: 'bad' } })).reason, 'invalid_tool_arguments');
  assert.equal(f.calls.length, 0);
});

test('effectful operation persists before dispatch, replays across restart and conflicts on changed intent', async (t) => {
  const f = await fixture(t);
  f.provider.call = async () => {
    f.calls.push(true);
    const receipt = JSON.parse(await fs.readFile(path.join(f.config.stateDir, 'fixture-operation-1.json'), 'utf8'));
    assert.equal(receipt.status, 'pending');
    return response({ result: 'prepared' });
  };
  const first = await f.prepare();
  assert.equal(first.status, 'provider_returned');
  assert.equal(first.bookingStatus, 'not_confirmed_by_connector');
  const again = await f.prepare();
  assert.equal(again.replayed, true);
  assert.equal((await f.prepare({ arguments: { fixtureInput: 'changed' } })).reason, 'operation_id_conflict');
  const restarted = new PerkConnector(f.config, { providerFactory: () => { throw new Error('must not connect'); } });
  const replay = await restarted.invoke('perk_prepare', { operation: prepareName, schemaHash: (await f.contract()).schemaHash, arguments: { fixtureInput: 'synthetic' }, operationId: 'fixture-operation-1', sourceRef: 'fixture://authorized-travel-request' });
  assert.equal(replay.replayed, true);
  assert.equal(f.calls.length, 1);
  const stat = await fs.stat(path.join(f.config.stateDir, 'fixture-operation-1.json'));
  assert.equal(stat.mode & 0o777, 0o600);
});

test('concurrent identical preparations dispatch once', async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.prepare(), f.prepare()]);
  assert.equal(f.calls.length, 1);
  assert.ok(results.some((result) => result.status === 'provider_returned'));
});

test('timeouts and provider tool errors preserve unknown effect and never retry', async (t) => {
  for (const outcome of ['timeout', 'tool_error']) {
    const f = await fixture(t);
    f.provider.call = async () => { f.calls.push(true); if (outcome === 'timeout') throw new DOMException('fixture-secret', 'TimeoutError'); return { ...response({ error: 'fixture provider rejection' }), isError: true }; };
    const result = await f.prepare();
    assert.equal(result.status, 'unknown');
    assert.match(result.nextAction, /Reconcile/);
    assert.equal((await f.prepare()).replayed, true);
    assert.equal(f.calls.length, 1);
    assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  }
});

test('full evidence is paged without repeat upstream reads', async (t) => {
  const payload = response({ large: 'x'.repeat(17000), ending: 'the-end' });
  const f = await fixture(t, { call: async () => { f.calls.push(true); return payload; } });
  const c = await f.contract(readName);
  let page = await f.connector.invoke('perk_read', { operation: readName, schemaHash: c.schemaHash, arguments: { fixtureInput: 'read' } });
  const chunks = [];
  while (true) {
    chunks.push(page.evidence.content);
    assert.ok(page.evidence.content.length <= 6000);
    if (page.evidence.nextOffset === null) break;
    page = await f.connector.invoke('perk_result', { receiptId: page.receiptId, offset: page.evidence.nextOffset });
  }
  assert.deepEqual(JSON.parse(chunks.join('')), payload);
  assert.equal(f.calls.length, 1);
});

test('provider pagination is bounded and permission errors are structured without raw error data', async (t) => {
  const f = await fixture(t, { list: async () => ({ tools: [], nextCursor: 'same' }) });
  assert.equal((await f.connector.invoke('perk_status')).reason, 'invalid_provider_pagination');
  f.provider.initialize = async () => { throw Object.assign(new Error('fixture-secret'), { status: 403 }); };
  assert.deepEqual(await f.connector.invoke('perk_status'), { status: 'blocked', reason: 'account_scope_role_or_plan_denied' });
});

test('host config enforces private paths and permissions', async (t) => {
  const f = await fixture(t);
  const configFile = path.join(f.root, 'config.json');
  await fs.writeFile(configFile, JSON.stringify(f.config), { mode: 0o600 });
  assert.deepEqual(await loadConfig(configFile), f.config);
  await fs.writeFile(configFile, JSON.stringify({ ...f.config, tokenFile: path.join(f.config.stateDir, 'unsafe.json') }));
  await assert.rejects(loadConfig(configFile), /credentials_inside_evidence_directory/);
});

test('real RemoteMcpClient transport uses the official endpoint, bearer header and rejects redirects', async () => {
  const calls = [];
  const provider = makeProvider('fixture-token', async (url, init) => {
    calls.push({ url, init });
    const request = JSON.parse(init.body);
    if (!request.id) return new Response(null, { status: 202 });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } } : { tools: [] } }), { headers: { 'content-type': 'application/json' } });
  });
  await provider.initialize(AbortSignal.timeout(2000));
  await provider.list(undefined, AbortSignal.timeout(2000));
  await provider.close();
  assert.ok(calls.length >= 3);
  for (const { url, init } of calls) {
    assert.equal(url, ENDPOINT);
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture-token');
  }
});

test('built stdio bundle initializes, discovers exact tools and returns actionable auth blocker', async (t) => {
  const f = await fixture(t);
  const bundle = path.join(f.root, 'perk.cjs');
  await build({ entryPoints: [new URL('./main.mjs', import.meta.url).pathname], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'error' });
  const configFile = path.join(f.root, 'config.json');
  await fs.writeFile(configFile, JSON.stringify(f.config), { mode: 0o600 });
  await fs.unlink(f.config.tokenFile);
  const child = spawn(process.execPath, [bundle], { env: { PATH: process.env.PATH, PERK_CONNECTOR_CONFIG: configFile }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = once(child, 'close');
  child.stdin.end([
    null,
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'perk_status', arguments: {} } },
  ].map((message) => JSON.stringify(message)).join('\n') + '\n');
  assert.equal((await closed)[0], 0);
  assert.equal(stderr, '');
  const messages = stdout.trim().split('\n').map(JSON.parse);
  assert.equal(messages[0].error.code, -32600);
  assert.equal(messages[1].result.serverInfo.name, 'openmausbot-perk');
  assert.deepEqual(messages[2].result.tools.map((tool) => tool.name), TOOLS.map((tool) => tool.name));
  assert.equal(JSON.parse(messages[3].result.content[0].text).reason, 'auth_missing');
  assert.equal(messages[3].result.isError, true);
});
