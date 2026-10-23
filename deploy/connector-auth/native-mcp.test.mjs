import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { McpOAuthManager } from '../../server/mcp-oauth.ts';
import { createPerkCredentialProvider } from './native-mcp.mjs';

function fixture(t, expiresAt = 200000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perk-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'oauth.json');
  const record = { url: 'https://mcp.perk.com/api/mcp/mcp', state: 'signed-in', tokens: { access: 'fixture-only', expiresAt } };
  const save = () => fs.writeFileSync(file, JSON.stringify({ servers: { 'perk-upstream': record } }), { mode: 0o600 });
  save();
  return { file, record, save };
}

test('uses a current token without probing or copying credentials', async t => {
  const f = fixture(t); let calls = 0;
  const get = createPerkCredentialProvider({ storeFile: f.file, now: () => 0, fetcher: async () => { calls++; throw new Error(); } });
  assert.deepEqual(await get(), { access: 'fixture-only', expiresAt: 200000 }); assert.equal(calls, 0);
});

test('single-flight renewal uses fixed local route and rereads manager-owned store', async t => {
  const f = fixture(t, 50000); let calls = 0;
  const get = createPerkCredentialProvider({ storeFile: f.file, now: () => 0, fetcher: async (url, init) => {
    calls++; assert.equal(url.href, 'http://127.0.0.1:8799/api/mcp/servers/perk-upstream/test'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.authorization, undefined);
    await Promise.resolve(); f.record.tokens = { access: 'renewed-fixture', expiresAt: 300000 }; f.save(); return new Response('{}');
  } });
  const values = await Promise.all([get(), get()]); assert.equal(calls, 1); assert(values.every(v => v.access === 'renewed-fixture'));
});

test('rejects changed server binding, missing credentials and readable credential files', async t => {
  const f = fixture(t); const get = createPerkCredentialProvider({ storeFile: f.file, now: () => 0 });
  f.record.url = 'https://example.invalid/mcp'; f.save(); await assert.rejects(get(), /authorization is unavailable/);
  f.record.url = 'https://mcp.perk.com/api/mcp/mcp'; f.save(); fs.chmodSync(f.file, 0o644); await assert.rejects(get(), /authorization is unavailable/);
  fs.unlinkSync(f.file); await assert.rejects(get(), /authorization is unavailable/);
});

test('renewal failure never releases expired token or provider error text', async t => {
  const f = fixture(t, 100); const get = createPerkCredentialProvider({ storeFile: f.file, now: () => 0, fetcher: async () => { throw new Error('secret-fixture-provider-message'); } });
  await assert.rejects(get(), e => !e.message.includes('secret-fixture') && /renewal is unavailable/.test(e.message));
  const unchanged = createPerkCredentialProvider({ storeFile: f.file, now: () => 0, fetcher: async () => new Response('{}') });
  await assert.rejects(unchanged(), /authorization expired/);
});

test('revocation during probe fails and unsupported administration addresses are rejected', async t => {
  const f = fixture(t, 100); const get = createPerkCredentialProvider({ storeFile: f.file, now: () => 0, fetcher: async () => { f.record.state = 'needs-sign-in'; f.save(); return new Response('{}'); } });
  await assert.rejects(get(), /authorization is unavailable/);
  for (const appUrl of ['https://example.com', 'http://user@127.0.0.1:8799', 'http://127.0.0.1:8799/path', 'http://127.0.0.1:8799?x=1']) assert.throws(() => createPerkCredentialProvider({ storeFile: f.file, appUrl }), /Invalid/);
  assert.throws(() => createPerkCredentialProvider({ storeFile: f.file, serverName: '../anything' }), /Invalid/);
  assert.throws(() => createPerkCredentialProvider({ storeFile: 'relative.json' }), /Invalid/);
  const link = path.join(path.dirname(f.file), 'link.json'); fs.symlinkSync(f.file, link);
  await assert.rejects(createPerkCredentialProvider({ storeFile: link }), /authorization is unavailable/);
});

test('native manager owns refresh and persisted rotation through a synthetic token endpoint', async t => {
  const f = fixture(t, Date.now() + 50000);
  let refreshes = 0;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    assert.equal(req.url, '/token'); assert.equal(form.get('grant_type'), 'refresh_token'); assert.equal(form.get('refresh_token'), 'synthetic-refresh');
    refreshes++;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'synthetic-renewed', refresh_token: 'synthetic-rotated', expires_in: 3600, token_type: 'Bearer' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  f.record.clientId = 'synthetic-client'; f.record.tokenEndpoint = `http://127.0.0.1:${server.address().port}/token`; f.record.tokens.refresh = 'synthetic-refresh'; f.save();
  const manager = new McpOAuthManager({ file: f.file });
  const get = createPerkCredentialProvider({ storeFile: f.file, fetcher: async () => {
    await manager.accessToken('perk-upstream', f.record.url);
    return new Response('{}');
  } });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(a.access, 'synthetic-renewed'); assert.deepEqual(a, b); assert.equal(refreshes, 1);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).servers['perk-upstream'].tokens.refresh, 'synthetic-rotated');
});
