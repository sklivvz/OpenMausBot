import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { launchVerificationServer, runControlOmb } from '../../scripts/control-omb.ts';
import { TOOLS } from './catalog.mjs';

const fixture = await launchVerificationServer();
try {
  await runControlOmb(['doctor', '--url', fixture.info.url]);
  const privateDir = path.join(fixture.info.dataDir, 'perk-private');
  await fs.mkdir(privateDir, { mode: 0o700 });
  const configFile = path.join(privateDir, 'config.json');
  await fs.writeFile(configFile, JSON.stringify({ tokenFile: path.join(privateDir, 'absent-token.json'), stateDir: path.join(privateDir, 'evidence'), allowDrafts: false }), { mode: 0o600 });
  const bundle = path.join(privateDir, 'perk-mcp.cjs');
  await build({ entryPoints: [new URL('./main.mjs', import.meta.url).pathname], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'error' });
  const registered = await fetch(`${fixture.info.url}/api/mcp/servers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'perk-fixture', command: process.execPath, args: [bundle], env: { PERK_CONNECTOR_CONFIG: configFile }, enabled: false }) });
  assert.equal(registered.status, 201);
  const probed = await fetch(`${fixture.info.url}/api/mcp/servers/perk-fixture/test`, { method: 'POST' });
  assert.equal(probed.status, 200);
  const result = await probed.json();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.tools.map((tool) => tool.name).sort(), TOOLS.map((tool) => tool.name).sort());
  console.log(JSON.stringify({ ok: true, fixture: fixture.info.url, logPath: fixture.info.logPath, tools: result.tools.map((tool) => tool.name), verified: 'isolated real app registers and discovers built stdio connector; no Perk authorization or travel call attempted' }));
} finally { await fixture.close(); }
