#!/usr/bin/env node
import readline from 'node:readline';
import { createBridge, toolDefinitions } from './bridge.ts';
const call = createBridge();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
async function main() {
  for await (const line of input) {
    let message: any;
    try {
      if (line.length > 32000) throw Error('Request too large');
      message = JSON.parse(line);
      if (message.id === undefined) continue;
      let result;
      if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'work-review', version: '1.0.0' } };
      else if (message.method === 'tools/list') result = { tools: toolDefinitions };
      else if (message.method === 'ping') result = {};
      else if (message.method === 'tools/call') {
        try { result = { content: [{ type: 'text', text: JSON.stringify(await call(message.params.name, message.params.arguments)) }] }; }
        catch (error) { result = { isError: true, content: [{ type: 'text', text: error instanceof Error && /^(Invalid|Snapshot|Task is|Incomplete|Read source)/.test(error.message) ? error.message : 'Work review unavailable; use direct Positron Tasks evidence. No data changed.' }] }; }
      } else throw Error('Unknown method');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
    } catch {
      if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Invalid request' } }) + '\n');
    }
  }
}
void main();
