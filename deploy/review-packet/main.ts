#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
import { z } from 'zod';
import { createReviewPacket, reviewPacketToolDefinition } from './packet.ts';

const reviewDestinations = process.env.REVIEW_PACKET_DESTINATIONS_FILE ? z.array(z.object({ botId: z.string().regex(/^[\w-]{1,200}$/), threadId: z.string().regex(/^[\w-]{1,200}$/) }).strict()).max(100).parse(JSON.parse(fs.readFileSync(process.env.REVIEW_PACKET_DESTINATIONS_FILE, 'utf8'))) : [];
const prepare = createReviewPacket({ appUrl: process.env.REVIEW_PACKET_APP_URL || 'http://127.0.0.1:8799', reviewDestinations });
async function main() {
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let message: { id?: string | number; method?: string; params?: { name?: string; arguments?: unknown } } | undefined;
  try {
    if (line.length > 128000) throw Error('Request too large');
    message = JSON.parse(line);
    if (message?.id === undefined) continue;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'review-packet', version: '1.0.0' } };
    else if (message.method === 'tools/list') result = { tools: [reviewPacketToolDefinition] };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/call' && message.params?.name === reviewPacketToolDefinition.name) {
      try { result = { content: [{ type: 'text', text: JSON.stringify(await prepare(message.params.arguments)) }] }; }
      catch { result = { isError: true, content: [{ type: 'text', text: 'Review packet could not be verified. Check the supplied identifiers and app source access. No content, task or approval was changed.' }] }; }
    } else throw Error('Unknown method');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  } catch {
    if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Invalid request' } }) + '\n');
  }
}

}
void main();
