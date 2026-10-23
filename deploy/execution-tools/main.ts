#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createExecutionTools, executionToolDefinitions } from './host.ts';
let host: ReturnType<typeof createExecutionTools> | undefined;
function getHost() {
  if (host) return host;
  const file = process.env.EXECUTION_TOOLS_CONFIG_FILE;
  if (!file || !path.isAbsolute(file) || fs.statSync(file).size > 64000) throw Error('Invalid execution host configuration');
  host = createExecutionTools(JSON.parse(fs.readFileSync(file, 'utf8')));
  return host;
}
async function main() {
  for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    let request: { id?: string | number; method?: string; params?: { name?: string; arguments?: unknown } } | undefined;
    try {
      if (line.length > 200000) throw Error('Invalid request size');
      request = JSON.parse(line);
      if (request?.id === undefined) continue;
      let result;
      if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'execution-tools', version: '1.0.0' } };
      else if (request.method === 'ping') result = {};
      else if (request.method === 'tools/list') result = { tools: executionToolDefinitions };
      else if (request.method === 'tools/call') {
        try { result = { content: [{ type: 'text', text: JSON.stringify(await getHost().call(request.params?.name ?? '', request.params?.arguments)) }] }; }
        catch { result = { isError: true, content: [{ type: 'text', text: 'Execution operation could not establish a verified result. Check its configured sources, receipt and input; an uncertain write must be reconciled before retrying.' }] }; }
      } else throw Error('Invalid method');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
    } catch { if (request?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Invalid request' } }) + '\n'); }
  }
}
void main();
