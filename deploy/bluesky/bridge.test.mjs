import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createBridge, hash } from './bridge.mjs';

async function fixture(t, overrides = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bluesky-test-')));
  const calls = []; const records = new Map(); let mode = 'normal'; let onUpload = () => {};
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const part of req) chunks.push(part);
    const bytes = Buffer.concat(chunks); const method = req.url.split('?')[0].split('/').at(-1);
    const body = req.headers['content-type'] === 'application/json' ? JSON.parse(bytes || '{}') : bytes;
    calls.push({ method, body, auth: req.headers.authorization });
    if (mode === 'redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/secret' }); res.end(); return; }
    if (mode === 'oversized') { res.end(JSON.stringify({ data: 'x'.repeat(1024 * 1024 + 1) })); return; }
    if (mode === 'expired' && method === 'com.atproto.server.getSession') { res.statusCode = 401; res.end(JSON.stringify({ error: 'ExpiredToken' })); return; }
    let result;
    if (method === 'com.atproto.server.createSession' || method === 'com.atproto.server.refreshSession') result = { accessJwt: 'fixture-access', refreshJwt: 'fixture-refresh', did: mode === 'wrong-account' ? 'did:plc:wrong' : 'did:plc:fixture', handle: 'fixture.test' };
    else if (method === 'com.atproto.server.getSession') result = { did: 'did:plc:fixture', handle: 'fixture.test' };
    else if (method === 'com.atproto.repo.getRecord') {
      const key = new URL(req.url, 'http://fixture').searchParams.get('rkey');
      const record = records.get(key);
      if (record) result = { uri: `at://did:plc:fixture/app.bsky.feed.post/${key}`, cid: 'bafyfixture', value: record };
      else { res.statusCode = 400; result = { error: 'RecordNotFound' }; }
    } else if (method === 'com.atproto.repo.uploadBlob') {
      onUpload();
      if (mode === 'drop-upload') { req.socket.destroy(); return; }
      result = { blob: { $type: 'blob', ref: { $link: 'bafyimage' }, mimeType: req.headers['content-type'], size: bytes.length } };
    } else if (method === 'com.atproto.repo.putRecord') {
      assert.equal(body.swapRecord, null); assert.equal(body.validate, true); assert.equal(body.repo, 'did:plc:fixture');
      if (mode !== 'drop-without-write') records.set(body.rkey, body.record);
      if (['drop-after-write', 'drop-without-write'].includes(mode)) { req.socket.destroy(); return; }
      result = { uri: `at://did:plc:fixture/app.bsky.feed.post/${body.rkey}`, cid: 'bafyfixture' };
    } else { res.statusCode = 400; result = { error: 'Unsupported' }; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const artifacts = path.join(root, 'artifacts'); fs.mkdirSync(artifacts);
  const config = { pdsUrl: `http://127.0.0.1:${server.address().port}`, accountDid: 'did:plc:fixture', artifactRoots: [artifacts], stateDir: path.join(root, 'state'), grantDir: path.join(root, 'grants'), credentialsFile: path.join(root, 'credentials.json'), allowPublish: true, timeoutMs: 300, ...overrides };
  fs.writeFileSync(config.credentialsFile, JSON.stringify({ appPassword: 'fixture-secret' }), { mode: 0o600 });
  const invoke = createBridge(config);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const approve = prepared => fs.writeFileSync(path.join(config.grantDir, `${prepared.operationId}.json`), JSON.stringify({ operationId: prepared.operationId, contentSha256: prepared.contentSha256, accountDid: config.accountDid, pdsUrl: config.pdsUrl, authoritySource: 'isolated-fixture-only', notBefore: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() }), { mode: 0o600 });
  const prepare = (extra = {}) => invoke('bluesky_prepare_post', { operationId: 'test', text: 'Hello', ...extra });
  const publish = prepared => invoke('bluesky_publish_post', { operationId: prepared.operationId, contentSha256: prepared.contentSha256 });
  return { root, artifacts, config, invoke, calls, records, prepare, publish, approve, onUpload: fn => { onUpload = fn; }, mode: value => { mode = value; } };
}

test('preparation is local, immutable, exact and bounded', async t => {
  const f = await fixture(t);
  const p = await f.prepare(); assert.equal(p.status, 'prepared'); assert.match(p.rkey, /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/); assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.prepare(), p);
  assert.equal((await f.prepare({ text: 'changed' })).code, 'operation_conflict');
  assert.equal((await f.prepare({ operationId: 'long', text: 'a'.repeat(301) })).code, 'invalid_arguments');
  assert.equal((await f.prepare({ operationId: 'emoji', text: '👨‍👩‍👧‍👦'.repeat(300) })).code, 'invalid_arguments');
  assert.equal((await f.invoke('bluesky_publish_post', { operationId: 'test', contentSha256: p.contentSha256, approved: true })).code, 'invalid_arguments');
});
test('approval is host controlled, disabled by default, exact and expiring', async t => {
  const f = await fixture(t); const p = await f.prepare();
  assert.equal((await f.publish(p)).code, 'approval_missing'); assert.equal(f.calls.length, 0);
  f.approve(p);
  const file = path.join(f.config.grantDir, 'test.json'); const grant = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...grant, contentSha256: 'a'.repeat(64) })); assert.equal((await f.publish(p)).code, 'approval_invalid_or_expired');
  fs.writeFileSync(file, JSON.stringify({ ...grant, expiresAt: '2000-01-01' })); assert.equal((await f.publish(p)).code, 'approval_invalid_or_expired');
  const disabled = createBridge({ ...f.config, allowPublish: undefined }); assert.equal((await disabled('bluesky_publish_post', { operationId: 'test', contentSha256: p.contentSha256 })).code, 'publishing_disabled');
});
test('publishes exact text, correct UTF-8 links, images and verifies record identity', async t => {
  const f = await fixture(t);
  const image = Buffer.from([137,80,78,71,13,10,26,10,0]); const file = path.join(f.artifacts, 'image.png'); fs.writeFileSync(file, image);
  const p = await f.prepare({ text: '😀 Read this', links: [{ start: 3, end: 12, url: 'https://example.com/' }], images: [{ path: file, sha256: hash(image), alt: 'Exact image description' }] });
  assert.equal(p.status, 'prepared'); f.approve(p);
  const result = await f.publish(p); assert.equal(result.status, 'verified'); assert.equal(result.cid, 'bafyfixture'); assert.match(result.permalink, /^https:\/\/bsky.app\/profile\/did:plc:fixture\/post\//);
  const record = f.records.get(p.rkey); assert.equal(record.text, '😀 Read this'); assert.deepEqual(record.facets[0].index, { byteStart: 5, byteEnd: 14 }); assert.equal(record.embed.images[0].alt, 'Exact image description');
  assert.equal((await f.publish(p)).status, 'verified'); assert.equal(f.calls.filter(c => c.method.endsWith('putRecord')).length, 1);
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});
test('ambiguous write reconciles without duplicate; absence remains unresolved', async t => {
  for (const mode of ['drop-after-write', 'drop-without-write']) {
    const f = await fixture(t); f.mode(mode); const p = await f.prepare(); f.approve(p);
    assert.equal((await f.publish(p)).status, mode === 'drop-after-write' ? 'verified' : 'unresolved');
    await f.publish(p); assert.equal(f.calls.filter(c => c.method.endsWith('putRecord')).length, 1);
  }
});
test('conflicting record is never overwritten; deleted verified record is not recreated', async t => {
  const f = await fixture(t); const p = await f.prepare(); f.approve(p); f.records.set(p.rkey, { text: 'existing' });
  assert.equal((await f.publish(p)).code, 'record_conflict'); assert.equal(f.calls.filter(c => c.method.endsWith('putRecord')).length, 0);
  f.records.delete(p.rkey); await f.publish(p); f.records.delete(p.rkey);
  assert.equal((await f.publish(p)).status, 'unresolved'); assert.equal(f.calls.filter(c => c.method.endsWith('putRecord')).length, 1);
});
test('rejects altered media, symlink escapes, invalid facets and unsupported mentions', async t => {
  const f = await fixture(t); const outside = path.join(f.root, 'outside.png'); fs.writeFileSync(outside, Buffer.from([137,80,78,71,13,10,26,10]));
  const link = path.join(f.artifacts, 'escape.png'); fs.symlinkSync(outside, link);
  assert.equal((await f.prepare({ images: [{ path: link, sha256: hash(fs.readFileSync(outside)), alt: 'a' }] })).code, 'image_outside_artifacts');
  assert.equal((await f.prepare({ text: 'https://example.com' })).code, 'unfaceted_url');
  assert.equal((await f.prepare({ text: '😀foo', links: [{ start: 1, end: 3, url: 'https://example.com' }] })).code, 'invalid_link');
  assert.equal((await f.prepare({ text: '@someone.bsky.social' })).code, 'unsupported_mention');
  const image = path.join(f.artifacts, 'ok.png'); fs.copyFileSync(outside, image);
  const p = await f.prepare({ images: [{ path: image, sha256: hash(fs.readFileSync(image)), alt: 'a' }] }); f.approve(p); fs.appendFileSync(image, 'changed');
  assert.equal((await f.publish(p)).code, 'image_hash_mismatch'); assert.equal(f.calls.filter(c => c.method.endsWith('putRecord')).length, 0);
});
test('auth/account mismatch, redirect and locks fail closed', async t => {
  const f = await fixture(t); f.mode('wrong-account'); assert.equal((await f.invoke('bluesky_account_status')).code, 'account_mismatch_or_inactive');
  f.mode('redirect'); assert.equal((await f.invoke('bluesky_account_status')).code, 'provider_unavailable');
  fs.mkdirSync(path.join(f.config.stateDir, '.lock')); assert.equal((await f.prepare()).code, 'busy'); fs.rmdirSync(path.join(f.config.stateDir, '.lock'));
  fs.unlinkSync(f.config.credentialsFile); assert.equal((await f.invoke('bluesky_account_status')).code, 'auth_missing');
});
test('operation names cannot collide with private session or clock state', async t => {
  const f = await fixture(t); await f.invoke('bluesky_account_status');
  assert.equal((await f.prepare({ operationId: 'session' })).status, 'prepared');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.config.stateDir, 'session.json'))).accessJwt, 'fixture-access');
});
test('stdio discovers tools and fails config safely without secret output', async () => {
  const child = spawn(process.execPath, ['deploy/bluesky/main.mjs'], { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', part => { output += part; });
  child.stdin.end([ { id: 1, method: 'initialize' }, { id: 2, method: 'tools/list' }, { id: 3, method: 'tools/call', params: { name: 'bluesky_account_status', arguments: {} } } ].map(v => JSON.stringify({ jsonrpc: '2.0', ...v })).join('\n') + '\n');
  const code = await new Promise(resolve => child.once('exit', resolve)); assert.equal(code, 0);
  const messages = output.trim().split('\n').map(JSON.parse); assert.equal(messages.length, 3); assert.equal(messages[1].result.tools.length, 4); assert.equal(JSON.parse(messages[2].result.content[0].text).code, 'configuration_unavailable');
});

test('session refresh and oversized responses remain bounded and secret-free', async t => {
  const f = await fixture(t); assert.equal((await f.invoke('bluesky_account_status')).status, 'authenticated');
  f.mode('expired'); assert.equal((await f.invoke('bluesky_account_status')).status, 'authenticated');
  assert.equal(f.calls.filter(c => c.method.endsWith('refreshSession')).length, 1);
  assert.equal(f.calls.find(c => c.method.endsWith('refreshSession')).auth, 'Bearer fixture-refresh');
  f.mode('oversized'); assert.equal((await f.invoke('bluesky_account_status')).code, 'provider_response_too_large');
});
test('grant revocation after upload prevents publication; uncertain upload is not repeated', async t => {
  for (const mode of ['normal', 'drop-upload']) {
    const f = await fixture(t); const image = Buffer.from([137,80,78,71,13,10,26,10]); const file = path.join(f.artifacts, 'test.png'); fs.writeFileSync(file, image);
    const p = await f.prepare({ images: [{ path: file, sha256: hash(image), alt: 'Exact' }] }); f.approve(p); f.mode(mode);
    if (mode === 'normal') f.onUpload(() => fs.unlinkSync(path.join(f.config.grantDir, 'test.json')));
    const result = await f.publish(p); assert.equal(result.status, 'blocked');
    assert.equal(result.code, mode === 'normal' ? 'approval_missing' : 'provider_unavailable');
    assert.equal((await f.publish(p)).status, 'unresolved');
    assert.equal(f.calls.filter(c => c.method.endsWith('uploadBlob')).length, 1);
    assert.equal(f.calls.filter(c => c.method.endsWith('putRecord')).length, 0);
  }
});
test('corrupted operation state cannot reuse an approved hash', async t => {
  const f = await fixture(t); const p = await f.prepare(); f.approve(p);
  const file = path.join(f.config.stateDir, 'operation-test.json'); const saved = JSON.parse(fs.readFileSync(file)); saved.input.text = 'Unapproved'; fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal((await f.publish(p)).code, 'operation_corrupt'); assert.equal(f.calls.length, 0);
});
