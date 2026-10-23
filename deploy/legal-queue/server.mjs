import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRpc, run } from './queue.mjs';

const string = { type: 'string' };
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const tools = [
  { name: 'legal_queue_snapshot', description: 'Read every page of the Legal queue before choosing work. Pass nextCursor until complete is true.', inputSchema: schema({ cursor: string }, []), annotations: { readOnlyHint: true } },
  { name: 'legal_queue_progress', description: 'Record evidence, owner and next action on an open Legal task; preserve its original instructions and deadline and verify readback.', inputSchema: schema({ taskId: string, expectedUpdatedAt: string, status: { enum: ['ready', 'in_progress', 'in_review', 'waiting_external', 'waiting_user', 'held'] }, owner: string, nextAction: string, evidence: string, title: string, blocker: string, followUp: string }, ['taskId', 'expectedUpdatedAt', 'status', 'owner', 'nextAction', 'evidence']) },
  { name: 'legal_queue_add', description: 'Add a scoped Legal task with a stable source and acceptance criteria; check source and title duplicates and verify readback.', inputSchema: schema({ source: string, title: string, description: string, priority: { type: 'integer', minimum: 1, maximum: 4 }, sectionId: string }, ['source', 'title', 'description', 'priority']) },
  { name: 'legal_queue_complete', description: 'Close an open Legal task only after acceptance criteria are met. Require evidence, reject open subtasks and recurring tasks, and verify completion.', inputSchema: schema({ taskId: string, expectedUpdatedAt: string, evidence: string, confirmAcceptance: { const: true } }, ['taskId', 'expectedUpdatedAt', 'evidence', 'confirmAcceptance']) },
];

export function createServer(deps) {
  let writing = false;
  const pages = new Map();
  async function execute(command, input) {
    if (!['snapshot', 'progress', 'add', 'complete'].includes(command)) throw Error('Unknown Legal queue operation');
    if (writing) throw Error('Legal queue write in progress; reread before trying again');
    if (command !== 'snapshot') writing = true;
    try { return await run(command, input, deps); }
    finally { if (command !== 'snapshot') writing = false; }
  }
  async function call(name, input) {
    const tool = tools.find(t => t.name === name);
    if (!tool) throw Error('Unknown Legal queue tool');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Tool arguments must be an object');
    for (const key of Object.keys(input)) if (!Object.hasOwn(tool.inputSchema.properties, key)) throw Error('Unknown argument: ' + key);
    if (name !== 'legal_queue_snapshot') return execute(name.replace('legal_queue_', ''), input);
    for (const [key, value] of pages) if (value.expires < Date.now()) pages.delete(key);
    let snapshot;
    if (input.cursor) {
      snapshot = pages.get(input.cursor);
      if (!snapshot) throw Error('Unknown or expired cursor; start a fresh snapshot');
      pages.delete(input.cursor);
    } else snapshot = { ...(await execute('snapshot', {})), expires: Date.now() + 600000 };
    const items = snapshot.tasks.slice(0, 5);
    const remaining = snapshot.tasks.slice(5);
    const nextCursor = remaining.length ? randomUUID() : undefined;
    if (nextCursor) {
      if (pages.size >= 100) throw Error('Too many unfinished snapshots');
      pages.set(nextCursor, { ...snapshot, tasks: remaining });
    }
    return { checkedAt: snapshot.checkedAt, project: snapshot.project, tasks: items, complete: !nextCursor, nextCursor, note: snapshot.note };
  }
  return http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    // This service is confined to the trusted container loopback; browser origins cannot invoke writes.
    if (req.headers.origin) return reply(403, { error: 'Browser origins are not accepted' });
    if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true });
    if (req.method !== 'POST' || !['/mcp', '/queue'].includes(req.url)) return reply(405, { error: 'Unsupported operation' });
    if (!String(req.headers['content-type']).startsWith('application/json')) return reply(415, { error: 'JSON required' });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 40000) return reply(413, { error: 'Request too large' }); }
    let request;
    try { request = JSON.parse(body); } catch { return reply(400, { error: 'Invalid JSON' }); }
    if (req.url === '/queue') {
      try { return reply(200, await execute(request.command, request.input ?? {})); }
      catch (e) { return reply(409, { ok: false, error: e.message }); }
    }
    const id = request.id;
    if (id === undefined) { res.writeHead(202); return res.end(); }
    const result = value => reply(200, { jsonrpc: '2.0', id, result: value });
    if (request.method === 'initialize') return result({ protocolVersion: request.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'legal-queue', version: '1.0.0' } });
    if (request.method === 'ping') return result({});
    if (request.method === 'tools/list') return result({ tools });
    if (request.method !== 'tools/call') return reply(200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    try { return result({ content: [{ type: 'text', text: JSON.stringify(await call(request.params?.name, request.params?.arguments ?? {})) }] }); }
    catch (e) { return result({ isError: true, content: [{ type: 'text', text: e.message }] }); }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const rpc = createRpc({ origin: process.env.OMB_COMPOSIO_BROKER_URL, token: process.env.OMB_COMPOSIO_BROKER_TOKEN });
  createServer({ rpc, record: e => fs.appendFileSync('/state/queue-events.jsonl', JSON.stringify(e) + '\n', { mode: 0o600 }) }).listen(8797, '127.0.0.1', () => console.log('Legal queue ready'));
}
