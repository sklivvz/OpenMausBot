#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
import { createBridge, toolDefinitions } from './bridge.mjs';

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let bridge;
async function main() {
for await (const line of input) {
  let message;
  try {
    if (line.length > 16000) throw Error('Request too large');
    message = JSON.parse(line);
    if (message.id === undefined) continue;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'keila-drafts', version: '1.0.0' } };
    else if (message.method === 'tools/list') result = { tools: toolDefinitions };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/call') {
      try {
        bridge ??= createBridge(JSON.parse(fs.readFileSync(process.env.KEILA_CONFIG_FILE ?? '/data/.openmausbot/keila/config.json', 'utf8')));
        result = { content: [{ type: 'text', text: JSON.stringify(await bridge(message.params.name, message.params.arguments)) }] };
      } catch (error) {
        const safe = /^(Invalid |Use |Keila |Artifact |File |Payload |Updates |Create |Template |Only |Operation |Write |Prior |Resource |Campaign |Provider |Saved )/.test(error.message);
        result = { isError: true, content: [{ type: 'text', text: safe ? error.message : 'Keila adapter unavailable; check private configuration and artifact files. Do not retry uncertain writes.' }] };
      }
    } else throw Error('Unknown method');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  } catch {
    if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Invalid request' } }) + '\n');
  }
}

}
void main();
