#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createExecutionTools, executionToolDefinitions } from './host.ts';
import { ExecutionFailure, failurePayload } from '../execution-receipts/errors.ts';
let host: ReturnType<typeof createExecutionTools> | undefined;
function getHost() {
  if (host) return host;
  const file = process.env.EXECUTION_TOOLS_CONFIG_FILE;
  if (!file) throw new ExecutionFailure('invalid_config', 'EXECUTION_TOOLS_CONFIG_FILE is not set');
  if (!path.isAbsolute(file)) throw new ExecutionFailure('invalid_config', 'EXECUTION_TOOLS_CONFIG_FILE must be an absolute path');
  let size: number;
  try { size = fs.statSync(file).size; } catch { throw new ExecutionFailure('invalid_config', 'Execution host configuration file is missing or unreadable'); }
  if (size > 64000) throw new ExecutionFailure('invalid_config', 'Execution host configuration file exceeds the supported size');
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) throw new ExecutionFailure('invalid_config', 'Execution host configuration file is not valid JSON');
    throw new ExecutionFailure('invalid_config', 'Execution host configuration file is unreadable');
  }
  host = createExecutionTools(raw);
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
      else if (request.method === 'tools/list') {
        try { result = { tools: getHost().tools }; }
        catch { result = { tools: executionToolDefinitions }; }
      }
      else if (request.method === 'tools/call') {
        try { result = { content: [{ type: 'text', text: JSON.stringify(await getHost().call(request.params?.name ?? '', request.params?.arguments)) }] }; }
        catch (error) { result = { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: failurePayload(error) }) }] }; }
      } else throw Error('Invalid method');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
    } catch { if (request?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Invalid request' } }) + '\n'); }
  }
}
void main();
