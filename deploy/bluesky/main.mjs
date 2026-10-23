#!/usr/bin/env node
import fs from 'node:fs';
import { createBridge, toolDefinitions } from './bridge.mjs';
let bridge;
let buffer = '';
let queue = Promise.resolve();
let pending = 0;
async function dispatch(line) {
  let message;
  try {
    message = JSON.parse(line);
    if (message.id === undefined) return;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'bluesky', version: '1.0.0' } };
    else if (message.method === 'tools/list') result = { tools: toolDefinitions };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/call') {
      let output;
      try { bridge ??= createBridge(JSON.parse(fs.readFileSync(process.env.BLUESKY_CONFIG_FILE, 'utf8'))); output = await bridge(message.params.name, message.params.arguments); }
      catch { output = { status: 'blocked', code: 'configuration_unavailable', nextAction: 'Operator must provide a valid private BLUESKY_CONFIG_FILE.' }; }
      result = { ...(output.status === 'blocked' ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(output) }] };
    } else throw Error();
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  } catch { if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Invalid request' } }) + '\n'); }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 65536) { process.stderr.write('Bluesky MCP request exceeds 64 KiB.\n'); process.exit(1); }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); pending++; if (pending > 32) { process.stderr.write('Bluesky MCP queue exceeds 32 requests.\n'); process.exit(1); } queue = queue.then(() => dispatch(line)).finally(() => { pending--; }); }
});
