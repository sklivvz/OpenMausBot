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
