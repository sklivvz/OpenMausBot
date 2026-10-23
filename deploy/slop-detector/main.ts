#!/usr/bin/env node
import readline from 'node:readline';
import { createDetector, toolDefinition } from './detector.ts';
import { checkBrief, briefToolDefinition } from './preflight.ts';
import { createWorkKindClassifier, workKindToolDefinition } from '../marketing-classifier/work-kind.ts';
import { createOwnershipClassifier, ownershipToolDefinition } from '../marketing-classifier/ownership.ts';
const detect = createDetector();
const handlers: Record<string, (input: unknown) => unknown> = {
  [toolDefinition.name]: detect,
  [briefToolDefinition.name]: checkBrief,
  [workKindToolDefinition.name]: createWorkKindClassifier(),
  [ownershipToolDefinition.name]: createOwnershipClassifier(),
};
const definitions = [toolDefinition, briefToolDefinition, workKindToolDefinition, ownershipToolDefinition];
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
async function main() {
for await (const line of input) {
  let message: any;
  try {
    if (line.length > 200000) throw Error('Invalid request size');
    message = JSON.parse(line);
    if (message.id === undefined) continue;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'slop-detector', version: '2.0.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: definitions };
    else if (message.method === 'tools/call' && Object.hasOwn(handlers, message.params?.name ?? '')) {
      try { result = { content: [{ type: 'text', text: JSON.stringify(await handlers[message.params.name](message.params.arguments)) }] }; }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: error instanceof Error && error.message.startsWith('Invalid') ? error.message : 'Marketing check unavailable. No content or authority was changed; do not report a successful check.' }] }; }
    } else throw Error('Invalid method');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  } catch {
    if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Invalid request' } }) + '\n');
  }
}

}
void main();
