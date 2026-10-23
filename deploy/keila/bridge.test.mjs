import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createBridge, digest, toolDefinitions } from './bridge.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keila-fixture-'));
  const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts);
  const key = path.join(root, 'key'); fs.writeFileSync(key, 'fixture-key', { mode: 0o600 });
  const template = { id: 'tpl_fixture', name: 'Fixture', type: 'html', html_body: '<html><keila-content name="main">Default</keila-content>{{ unsubscribe_link }}</html>', html_content_slots: [{ name: 'main', default_content: 'Default' }] };
  const state = { templates: { tpl_fixture: template }, campaigns: {}, senders: { sender_fixture: { id: 'sender_fixture' } }, segments: {}, writes: [], requests: [], loseWriteResponse: false, corruptReadback: false, redirect: false };
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    state.requests.push(req.url);
    if (state.redirect) { res.writeHead(302, { location: 'http://127.0.0.1:1/credential-leak' }); return res.end(); }
    const url = new URL(req.url, 'http://fixture');
    const [, , , resource, id] = url.pathname.split('/');
    res.setHeader('content-type', 'application/json');
    if (!state[resource]) { res.writeHead(404); return res.end('{}'); }
    if (req.method === 'GET') {
      const data = id ? state[resource][id] : Object.values(state[resource]);
      if (!data) { res.writeHead(404); return res.end('{}'); }
      return res.end(JSON.stringify({ data, ...(!id ? { meta: { page: 0, page_count: 1, page_size: 50 } } : {}) }));
    }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw).data;
    state.writes.push({ method: req.method, resource, id, payload });
    const target = id ?? `${resource}_new`;
    state[resource][target] = { ...state[resource][target], ...(resource === 'campaigns' ? { sent_at: null, scheduled_for: null } : {}), ...payload, id: target };
    if (state.loseWriteResponse) { req.socket.destroy(); return; }
    res.end(JSON.stringify({ data: state[resource][target] }));
    if (state.corruptReadback) state[resource][target].subject = 'Unexpected provider mutation';
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, projectId: 'project_fixture', allowedRoots: [artifacts], protectedIds: ['campaign_held'], apiKeyFile: key, receiptDir: path.join(root, 'receipts'), allowWrites: true };
  const call = createBridge(config);
  const write = (name, value) => { const file = path.join(artifacts, name); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };
  const campaignPayload = { subject: 'Approved fixture é 😀', sender_id: 'sender_fixture', template_id: 'tpl_fixture', settings: { type: 'html' }, html_content: { main: '<p>Fixture issue</p>' } };
  const manifest = (patch = {}, payload = campaignPayload) => {
    const payloadFile = write(`${patch.operation_id ?? 'op'}.payload.json`, payload);
    return write(`${patch.operation_id ?? 'op'}.manifest.json`, { operation_id: 'op', resource: 'campaigns', action: 'create', payload_file: payloadFile, payload_sha256: digest(fs.readFileSync(payloadFile, 'utf8')), authorization_ref: 'fixture-only', template_sha256: digest(template), ...patch });
  };
  return { state, call, config, write, manifest, template, campaignPayload, root };
}

test('draft create verifies exact data; replay is compact and makes no second write', async t => {
  const f = await fixture(t); const file = f.manifest();
  const first = await f.call('keila_prepare', { manifest_file: file });
  assert.equal(first.state, 'verified'); assert.equal(first.id, 'campaigns_new');
  assert.deepEqual(f.state.writes[0].payload, f.campaignPayload);
  const second = await f.call('keila_prepare', { manifest_file: file });
  assert.equal(second.replayed, true); assert.equal(f.state.writes.length, 1); assert.equal(second.before, undefined);
  assert.equal(fs.statSync(first.receipt_file).mode & 0o777, 0o600);
  assert.equal(f.state.requests.some(url => /actions|messages/.test(url)), false);
});

test('lost create response blocks replay without duplicating draft', async t => {
  const f = await fixture(t); f.state.loseWriteResponse = true; const file = f.manifest();
  await assert.rejects(f.call('keila_prepare', { manifest_file: file }), /request failed/);
  await assert.rejects(f.call('keila_prepare', { manifest_file: file }), /outcome is uncertain/);
  assert.equal(f.state.writes.length, 1);
});

test('sent, scheduled, unknown status and held campaigns cannot be updated', async t => {
  const f = await fixture(t);
  for (const [id, status] of [['campaign_sent', { sent_at: 'today', scheduled_for: null }], ['campaign_scheduled', { sent_at: null, scheduled_for: 'tomorrow' }], ['campaign_unknown', {}], ['campaign_held', { sent_at: null, scheduled_for: null }]]) {
    f.state.campaigns[id] = { id, ...f.campaignPayload, ...status };
    const file = f.manifest({ operation_id: id, action: 'update', id, expected_sha256: digest(f.state.campaigns[id]) });
    await assert.rejects(f.call('keila_prepare', { manifest_file: file }), /not a verified|protected/);
  }
  assert.equal(f.state.writes.length, 0);
});

test('stale drafts, changed payload and wrong template hashes stop before write', async t => {
  const f = await fixture(t); const id = 'campaign_fixture';
  f.state.campaigns[id] = { id, ...f.campaignPayload, sent_at: null, scheduled_for: null };
  await assert.rejects(f.call('keila_prepare', { manifest_file: f.manifest({ action: 'update', id, expected_sha256: '0'.repeat(64) }) }), /changed since/);
  await assert.rejects(f.call('keila_prepare', { manifest_file: f.manifest({ template_sha256: '0'.repeat(64) }) }), /Template changed/);
  const file = f.manifest(); const m = JSON.parse(fs.readFileSync(file)); fs.appendFileSync(m.payload_file, ' ');
  await assert.rejects(f.call('keila_prepare', { manifest_file: file }), /Payload changed/);
  assert.equal(f.state.writes.length, 0);
});

test('campaign rejects send/schedule fields and unknown template slots', async t => {
  const f = await fixture(t);
  await assert.rejects(f.call('keila_prepare', { manifest_file: f.manifest({}, { ...f.campaignPayload, scheduled_for: 'tomorrow' }) }), /complete HTML draft/);
  await assert.rejects(f.call('keila_prepare', { manifest_file: f.manifest({}, { ...f.campaignPayload, html_content: { unknown: 'x' } }) }), /unknown template slot/);
  assert.equal(f.state.writes.length, 0);
  assert.deepEqual(toolDefinitions.map(tool => tool.name), ['keila_inventory', 'keila_snapshot', 'keila_prepare']);
});

test('readback mismatch is not success and replay never silently overwrites it', async t => {
  const f = await fixture(t); f.state.corruptReadback = true; const file = f.manifest();
  await assert.rejects(f.call('keila_prepare', { manifest_file: file }), /Saved content differs/);
  await assert.rejects(f.call('keila_prepare', { manifest_file: file }), /Prior operation readback differs/);
  assert.equal(f.state.writes.length, 1);
});

test('inventory and snapshots return compact metadata; path escapes and overwrites fail', async t => {
  const f = await fixture(t);
  const result = await f.call('keila_inventory', { resource: 'templates' });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].html_body, undefined);
  const output = path.join(f.config.allowedRoots[0], 'snapshot.json');
  const snapshot = await f.call('keila_snapshot', { resource: 'templates', id: 'tpl_fixture', output_file: output });
  assert.equal(snapshot.sha256, digest(JSON.parse(fs.readFileSync(output))));
  await assert.rejects(f.call('keila_snapshot', { resource: 'templates', id: 'tpl_fixture', output_file: output }), /EEXIST/);
  await assert.rejects(f.call('keila_snapshot', { resource: 'templates', id: 'tpl_fixture', output_file: path.join(f.root, 'escape.json') }), /outside/);
  await assert.rejects(f.call('keila_inventory', { resource: '../campaigns/x/actions/send' }), /Invalid/);
});

test('redirects are never followed with the API credential', async t => {
  const f = await fixture(t); f.state.redirect = true;
  await assert.rejects(f.call('keila_inventory', { resource: 'templates' }), /request failed/);
  assert.equal(f.state.requests.length, 1);
});

test('template creates preserve exact designer HTML and require structural preflight', async t => {
  const f = await fixture(t);
  const reference = f.write('designer.html', f.template.html_body);
  const issue = f.write('issue.txt', 'The approved issue contains enough substantive text to verify separation from the reusable HTML master design.');
  const payload = { type: 'html', name: 'New reusable version', html_body: f.template.html_body };
  const file = f.manifest({ resource: 'templates', issue_copy_file: issue, reference_html_file: reference }, payload);
  const result = await f.call('keila_prepare', { manifest_file: file });
  assert.equal(result.state, 'verified'); assert.equal(f.state.writes[0].payload.html_body, f.template.html_body);
});

test('updates preserve a before image and verify changed fields exactly', async t => {
  const f = await fixture(t), id = 'campaign_fixture';
  f.state.campaigns[id] = { id, ...f.campaignPayload, subject: 'Old approved draft', sent_at: null, scheduled_for: null };
  const before = structuredClone(f.state.campaigns[id]);
  const file = f.manifest({ action: 'update', id, expected_sha256: digest(before) });
  const result = await f.call('keila_prepare', { manifest_file: file });
  assert.deepEqual(JSON.parse(fs.readFileSync(result.receipt_file)).before, before);
  assert.equal(f.state.writes[0].method, 'PATCH');
  await f.call('keila_prepare', { manifest_file: file }); assert.equal(f.state.writes.length, 1);
});

test('an existing preparation lock blocks writes until a maintainer reconciles it', async t => {
  const f = await fixture(t); fs.mkdirSync(f.config.receiptDir);
  fs.writeFileSync(path.join(f.config.receiptDir, 'preparation.lock'), JSON.stringify({ pid: 123 }));
  await assert.rejects(f.call('keila_prepare', { manifest_file: f.manifest() }), /lock is held/);
  assert.equal(f.state.writes.length, 0);
});

test('pagination collects pages once and rejects repeated pages', async t => {
  const f = await fixture(t); const pages = [];
  const call = createBridge(f.config, { fetchImpl: async url => {
    const page = Number(url.searchParams.get('page')); pages.push(page);
    return Response.json({ data: [{ id: `tpl_${page}`, html_body: 'Not in context' }], meta: { page, page_count: 2 } });
  } });
  const result = await call('keila_inventory', { resource: 'templates' });
  assert.equal(result.items.length, 2); assert.deepEqual(pages, [0, 1]);
  const repeating = createBridge(f.config, { fetchImpl: async url => Response.json({ data: [{ id: 'tpl_same' }], meta: { page: Number(url.searchParams.get('page')), page_count: 2 } }) });
  await assert.rejects(repeating('keila_inventory', { resource: 'templates' }), /repeated a resource/);
});

test('template failures and disabled writes never call mutation endpoints', async t => {
  const f = await fixture(t);
  const issue = f.write('issue.txt', 'This is a sufficiently long issue paragraph that must never be hard coded inside a reusable newsletter master.');
  const reference = f.write('reference.html', f.template.html_body);
  const bad = { type: 'html', name: 'Bad fixture', html_body: '<p>No slots or unsubscribe link</p>' };
  await assert.rejects(f.call('keila_prepare', { manifest_file: f.manifest({ resource: 'templates', issue_copy_file: issue, reference_html_file: reference }, bad) }), /preflight failed/);
  const readOnly = createBridge({ ...f.config, allowWrites: false });
  await assert.rejects(readOnly('keila_prepare', { manifest_file: f.manifest() }), /disabled/);
  assert.equal(f.state.writes.length, 0);
});
