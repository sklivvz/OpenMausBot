import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchVerificationServer } from '../../scripts/control-omb.ts';

const python = process.env.FLI_VERIFY_PYTHON;
assert.ok(python?.startsWith('/'), 'Set FLI_VERIFY_PYTHON to the isolated interpreter with pinned dependencies');
const fixture = await launchVerificationServer();
try {
  const call = async (route, method = 'GET', body) => {
    const response = await fetch(fixture.info.url + route, {
      method, headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value));
    return value;
  };
  await call('/api/mcp/servers', 'POST', {
    name: 'fli-research', command: python,
    args: [fileURLToPath(new URL('./research.py', import.meta.url))], enabled: true,
  });
  const probe = await call('/api/mcp/servers/fli-research/test', 'POST');
  assert.equal(probe.ok, true, JSON.stringify(probe));
  assert.deepEqual(probe.tools.map(t => t.name).sort(), ['find_airports', 'search_dates', 'search_flights']);
  const bot = (await call('/api/bots')).bots[0];
  await call(`/api/bots/${bot.id}`, 'PATCH', { mcpServers: ['fli-research'] });
  const text = fs.readFileSync(new URL('./skill/fli-flight-research/SKILL.md', import.meta.url), 'utf8');
  await call(`/api/bots/${bot.id}/skill-template`, 'POST', {
    name: 'fli-flight-research', description: 'Flight research', source: 'local:reviewed-fli', enabled: true, warnings: [], text,
  });
  assert.equal((await call(`/api/bots/${bot.id}/skills/fli-flight-research`)).text, text);
  assert.equal((await call(`/api/bots/${bot.id}/skills`)).skills.find(s => s.name === 'fli-flight-research').enabled, true);
  assert.deepEqual((await call('/api/bots')).bots[0].mcpServers, ['fli-research']);
  console.log(JSON.stringify({ ok: true, tools: probe.tools.map(t => t.name), logPath: fixture.info.logPath }));
} finally {
  await fixture.close();
}
