#!/usr/bin/env node
import readline from 'node:readline';
import { configuredAuthorization, createTaskSnapshotReader } from '../positron-tasks/snapshot.ts';
import { createQueueReader, queueToolDefinitions } from './reader.ts';

const readTasks = createTaskSnapshotReader({ authorization: () => configuredAuthorization() });
const call = createQueueReader({ readTasks, appUrl: process.env.EXECUTION_QUEUE_APP_URL, directory: process.env.EXECUTION_QUEUE_EVIDENCE_DIR });
async function main() {
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message: any;
  try {
    if (line.length > 16000) throw Error('Invalid request size');
    message = JSON.parse(line);
    if (message.id === undefined) continue;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'execution-queue', version: '1.0.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: queueToolDefinitions };
    else if (message.method === 'tools/call') {
      try { result = { content: [{ type: 'text', text: JSON.stringify(await call(message.params?.name, message.params?.arguments)) }] }; }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: error instanceof Error && error.message.startsWith('Invalid') ? error.message : 'Execution source unavailable; no complete current source was established.' }] }; }
    } else throw Error('Invalid method');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  } catch {
    if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Invalid request' } }) + '\n');
  }
}
}
void main();
