import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const url = new URL(process.argv[2]);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw Error('Pass the exact disposable launch URL; never use a live app.');
async function call(endpoint, method = 'GET', body) {
  const response = await fetch(new URL(endpoint, url), { method, headers: { 'content-type': 'application/json', origin: url.origin }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
}
const bots = await call('/api/bots');
assert.equal(bots.bots.length, 1); assert.equal(bots.bots[0].name, 'Fixture Starter');
await call('/api/mcp/servers', 'POST', { name: 'bluesky-fixture', command: process.execPath, args: [fileURLToPath(new URL('../local/bluesky-mcp.cjs', import.meta.url))], enabled: true });
const probe = await call('/api/mcp/servers/bluesky-fixture/test', 'POST', {});
assert.equal(probe.ok, true); assert.equal(probe.tools.length, 4);
const toolScope = { allow: ['mcp:bluesky-fixture:bluesky_prepare_post', 'mcp:bluesky-fixture:bluesky_reconcile_post'] };
await call(`/api/bots/${bots.bots[0].id}`, 'PATCH', { toolScope });
const after = await call('/api/bots'); assert.deepEqual(after.bots[0].toolScope, toolScope);
console.log(JSON.stringify({ status: 'passed', tools: probe.tools, botId: after.bots[0].id, toolScope }));
