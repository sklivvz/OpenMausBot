#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const allowed = new Set([
  'get_claude_design_prompt', 'read_design_skill', 'list_design_systems',
  'list_projects', 'get_project', 'list_files', 'read_file', 'get_conversation',
  'list_comments', 'render_preview', 'finalize_plan', 'write_files',
  'copy_files', 'create_support_js', 'create_project',
]);
const mutations = new Set(['write_files', 'copy_files', 'create_support_js']);
const paged = new Set(['get_claude_design_prompt', 'read_design_skill']);

function validateCall(params) {
  if (!allowed.has(params?.name)) throw new Error('Operation is not enabled for this design connector.');
  const args = params.arguments ?? {};
  if (params.name === 'finalize_plan') {
    if (args.scope === 'project' || args.deletes?.length || !args.writes?.length) {
      throw new Error('Declare the exact write paths; project-wide plans and deletes are not enabled.');
    }
  }
  if (mutations.has(params.name) && !args.plan_token) throw new Error('A path-scoped finalize_plan token is required before editing.');
  if (params.name === 'write_files' && args.files?.some(file => typeof file.if_match !== 'string')) throw new Error('Each edited file needs the etag from a current read or finalize_plan.');
  if (params.name === 'create_support_js' && typeof args.if_match !== 'string') throw new Error('The runtime file needs its current etag, or 0 for a new file.');
  if (params.name === 'copy_files' && args.files?.some(file => typeof file.if_match !== 'string')) throw new Error('Copy individual files with current destination etags.');
  return args;
}

async function refreshWithClaude() {
  // Claude Code 2.1.302 coordinates Design OAuth refresh with its credential-store lock.
  const args = ['-p', 'Use ToolSearch select:DesignSync, then DesignSync list_projects once. This refreshes the existing Design authorization. Return only success or the exact authorization failure. Do nothing else.',
    '--model', 'claude-sonnet-5-5', '--no-session-persistence', '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk',
    '--tools', 'ToolSearch,DesignSync', '--allowedTools', 'ToolSearch,DesignSync', '--max-turns', '3'];
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/local/bin/claude', args, { cwd: os.tmpdir(), stdio: 'ignore', detached: true });
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
    const cancel = () => { stop(); };
    process.once('SIGTERM', cancel);
    process.once('SIGINT', cancel);
    const timer = setTimeout(stop, 60000);
    const clean = () => { clearTimeout(timer); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel); };
    child.once('error', () => { clean(); reject(new Error('Could not start the native Design credential refresh.')); });
    child.once('close', code => {
      clean(); stop();
      if (code === 0) resolve();
      else reject(new Error('Native Design credential refresh failed; check the existing Claude Design authorization.'));
    });
  });
}

function createBridge({ fetchImpl = fetch, credentialPath = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json'), refresh = refreshWithClaude } = {}) {
  let session;
  const pages = new Map();
  async function accessToken() {
    const read = () => {
      try { return JSON.parse(fs.readFileSync(credentialPath, 'utf8')).designOauth; }
      catch { throw new Error('Could not read the existing Claude Design authorization.'); }
    };
    let credential = read();
    if (!credential?.accessToken || !credential.scopes?.includes('user:design:read')) throw new Error('Existing Claude Design authorization is missing; use the native design login.');
    if (credential.expiresAt <= Date.now() + 120000) {
      await refresh();
      credential = read();
      if (!credential?.accessToken || credential.expiresAt <= Date.now()) throw new Error('Claude Design authorization remains expired after native refresh.');
    }
    return credential.accessToken;
  }
  async function rpc(message) {
    const token = await accessToken();
    const response = await fetchImpl('https://api.anthropic.com/v1/design/mcp', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'X-Anthropic-Client': 'openmausbot-claude-design-mcp',
        ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify(message),
    });
    session = response.headers.get('Mcp-Session-Id') || session;
    if (!response.ok) throw new Error(`Claude Design returned HTTP ${response.status}; no automatic mutation retry was made.`);
    if (response.status === 202 || response.status === 204) return null;
    const raw = await response.text();
    if (raw.length > 16 * 1024 * 1024) throw new Error('Claude Design response exceeds the connector limit.');
    let value;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      value = raw.split('\n').filter(line => line.startsWith('data:')).map(line => {
        try { return JSON.parse(line.slice(5)); } catch { return null; }
      }).findLast(item => item?.id === message.id);
    } else value = JSON.parse(raw);
    if (!value) throw new Error('Claude Design returned no matching response.');
    return value;
  }
  async function handle(message) {
    if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} };
    if (message.id === undefined) return null;
    if (!['initialize', 'tools/list', 'tools/call'].includes(message.method)) throw new Error('Unsupported MCP method.');
    if (message.method === 'tools/call') validateCall(message.params);
    if (message.method === 'tools/call' && paged.has(message.params.name)) {
      const { omb_page = 1, ...args } = message.params.arguments ?? {};
      if (!Number.isInteger(omb_page) || omb_page < 1) throw new Error('omb_page must be a positive integer.');
      const key = JSON.stringify([message.params.name, args]);
      if (omb_page === 1 || !pages.has(key)) {
        const response = await rpc({ ...message, params: { ...message.params, arguments: args } });
        if (response.error || response.result?.isError) return response;
        const text = response.result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
        if (typeof text !== 'string') return response;
        if (pages.size >= 8) pages.delete(pages.keys().next().value);
        pages.set(key, text);
      }
      const text = pages.get(key), count = Math.max(1, Math.ceil(text.length / 4500));
      if (omb_page > count) throw new Error(`This result has ${count} pages.`);
      return { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `Claude Design native instructions, page ${omb_page}/${count}. Read every page before design edits. Call this same tool with the same arguments and omb_page set to the next page.\n\n${text.slice((omb_page - 1) * 4500, omb_page * 4500)}` }] } };
    }
    const response = await rpc(message);
    if (message.method === 'tools/list' && response?.result?.tools) {
      response.result.tools = response.result.tools.filter(tool => allowed.has(tool.name));
      for (const tool of response.result.tools) if (paged.has(tool.name)) {
        tool.inputSchema = { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, omb_page: { type: 'integer', minimum: 1, description: 'Page of the complete native instructions. Start at 1 and read through the returned page count.' } } };
      }
    }
    return response;
  }
  return { handle };
}

if (require.main === module) {
  const bridge = createBridge();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = Promise.resolve();
  input.on('line', line => {
    pending = pending.then(async () => {
      let message;
      try {
        message = JSON.parse(line);
        const response = await bridge.handle(message);
        if (response) process.stdout.write(JSON.stringify(response) + '\n');
      } catch (error) {
        if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : 'Design connector failed.' } }) + '\n');
      }
    });
  });
}
module.exports = { createBridge, validateCall };
