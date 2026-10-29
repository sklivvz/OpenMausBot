import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { authorizationFrom, callerServer } from './snapshot.ts';

const bots = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caller-')), 'bots.json');
fs.writeFileSync(bots, JSON.stringify({ bots: [{ id: 'b1', name: 'Gustave H.' }, { id: 'b2', name: 'Bill Lumbergh' }] }));
const entry = (token: string) => ({ type: 'http', url: 'http://positron-mcp:8080/mcp', headers: { Authorization: `Bearer ${token}` }, enabled: true });
const config = { mcpServers: { 'positron-tasks-gustave-h': entry('gustave-token-0123456'), 'positron-tasks-bill-lumbergh': entry('bill-token-012345678') } };

test('each bot reads with its own credential', () => {
  assert.equal(callerServer('b1', bots), 'positron-tasks-gustave-h');
  assert.equal(authorizationFrom(config, { server: callerServer('b1', bots) }), 'Bearer gustave-token-0123456');
});

test('a read with no calling bot or an unknown bot is refused', () => {
  assert.throws(() => callerServer('', bots), /no calling bot/);
  assert.throws(() => callerServer('nope', bots), /unknown bot/);
});

test('shared registration reads only the calling bot credential file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-shared-'));
  const oldId = process.env.OMB_BOT_ID, oldArgv = [...process.argv], oldDir = process.env.OMB_POSITRON_CREDENTIALS_DIR;
  try {
    process.env.OMB_BOT_ID = 'b1'; process.env.OMB_POSITRON_CREDENTIALS_DIR = dir;
    fs.writeFileSync(path.join(dir, 'b1.json'), JSON.stringify({ botId: 'b1', url: 'http://positron-mcp:8080/mcp', authorization: 'Bearer fixture-b1-token-123456' }), { mode: 0o600 });
    const config = { mcpServers: { 'positron-tasks': { enabled: true, url: 'http://positron-mcp:8080/mcp' } } };
    assert.equal(authorizationFrom(config, { server: 'positron-tasks-alice' }), 'Bearer fixture-b1-token-123456');
    assert.equal(authorizationFrom(config, { server: '' }), 'Bearer fixture-b1-token-123456');
    process.argv.push('--positron-caller-bot=b2', '--positron-caller-bot=b1');
    assert.equal(authorizationFrom(config, { server: '' }), 'Bearer fixture-b1-token-123456');
    process.argv = oldArgv.slice();
    process.argv.push('--positron-caller-bot=b2');
    assert.throws(() => authorizationFrom(config, { server: 'positron-tasks-alice' }), /invalid/);
  } finally {
    if (oldId === undefined) delete process.env.OMB_BOT_ID; else process.env.OMB_BOT_ID = oldId;
    process.argv = oldArgv;
    if (oldDir === undefined) delete process.env.OMB_POSITRON_CREDENTIALS_DIR; else process.env.OMB_POSITRON_CREDENTIALS_DIR = oldDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
