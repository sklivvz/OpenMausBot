#!/usr/bin/env node
import readline from 'node:readline';
import { createDetector, toolDefinition } from './detector.ts';
const detect = createDetector();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
async function main() {
for await (const line of input) {
  let message: any;
  try {
    if (line.length > 200000) throw Error('Invalid request size');
    message = JSON.parse(line);
    if (message.id === undefined) continue;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'slop-detector', version: '1.0.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: [toolDefinition] };
    else if (message.method === 'tools/call' && message.params?.name === toolDefinition.name) {
      try { result = { content: [{ type: 'text', text: JSON.stringify(await detect(message.params.arguments)) }] }; }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: error instanceof Error && error.message.startsWith('Invalid') ? error.message : 'Slop detector unavailable. No copy was changed; do not report a clean check.' }] }; }
    } else throw Error('Invalid method');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  } catch {
    if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Invalid request' } }) + '\n');
  }
}

}
void main();
