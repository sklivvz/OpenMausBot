import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchVerificationServer, runControlOmb } from '../../scripts/control-omb.ts';

const fixture = await launchVerificationServer();
try {
  await runControlOmb(['doctor', '--url', fixture.info.url]);
  const call = async (route, method = 'GET', body) => {
    const response = await fetch(new URL(route, fixture.info.url), { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  const definitions = { perk: 5, threads: 5, bluesky: 4 };
  const verified = {};
  for (const [name, count] of Object.entries(definitions)) {
    const entry = `${name}-fixture`;
    await call('/api/mcp/servers', 'POST', { name: entry, command: process.execPath, args: [fileURLToPath(new URL(`../local/${name}-mcp.cjs`, import.meta.url))], enabled: true });
    const probe = await call(`/api/mcp/servers/${entry}/test`, 'POST');
    assert.equal(probe.ok, true, JSON.stringify(probe));
    assert.equal(probe.tools.length, count);
    verified[name] = probe.tools.map(tool => tool.name);
  }
  const bots = await call('/api/bots');
  assert.equal(bots.bots.length, 1);
  const botId = bots.bots[0].id;
  const mcpServers = Object.keys(definitions).map(name => `${name}-fixture`);
  const toolScope = { allow: ['mcp:perk-fixture:perk_result', 'mcp:threads-fixture:threads_prepare', 'mcp:bluesky-fixture:bluesky_prepare_post'] };
  await call(`/api/bots/${botId}`, 'PATCH', { mcpServers, toolScope });
  const after = (await call('/api/bots')).bots.find(bot => bot.id === botId);
  assert.deepEqual(after.mcpServers, mcpServers);
  assert.deepEqual(after.toolScope, toolScope);
  const skills = [];
  for (const [service, name] of [['websummit', 'websummit-directory-reconciliation'], ['slush', 'slush-evidence-reconciliation'], ['selver', 'selver-cart-preview'], ['bluesky', 'bluesky-post-preparation']]) {
    const text = fs.readFileSync(new URL(`../${service}/skill/${name}/SKILL.md`, import.meta.url), 'utf8');
    await call(`/api/bots/${botId}/skill-template`, 'POST', { name, description: text.match(/^description: (.+)$/m)[1], source: 'local:reviewed-service-automation', enabled: true, warnings: [], text });
    const loaded = await call(`/api/bots/${botId}/skills/${name}`);
    assert.equal(loaded.text, text);
    const meta = (await call(`/api/bots/${botId}/skills`)).skills.find(skill => skill.name === name);
    assert.equal(meta.enabled, true); assert.deepEqual(meta.warnings, []);
    skills.push(name);
  }
  console.log(JSON.stringify({ ok: true, tools: verified, skills, logPath: fixture.info.logPath, scope: 'isolated app registration, discovery, persisted selection and skill lifecycle only; no provider credentials or business operations' }));
} finally { await fixture.close(); }
