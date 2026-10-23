import readline from 'node:readline';
import { loadConfig, PerkConnector } from './connector.mjs';
import { TOOLS } from './catalog.mjs';

export async function serve({ input = process.stdin, output = process.stdout, configPath = process.env.PERK_CONNECTOR_CONFIG, credentialProvider } = {}) {
  let connector;
  let startupReason;
  try { connector = new PerkConnector(await loadConfig(configPath), { credentialProvider }); }
  catch (error) { startupReason = error.reason ?? 'config_unavailable'; }
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    let message;
    try { if (Buffer.byteLength(line) > 256 * 1024) throw new Error(); message = JSON.parse(line); }
    catch { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON RPC request' } })}\n`); continue; }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON RPC request' } })}\n`);
      continue;
    }
    if (!Object.hasOwn(message, 'id')) continue;
    let result;
    let error;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'openmausbot-perk', version: '1.0.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: TOOLS };
    else if (message.method === 'tools/call') {
      const body = connector ? await connector.invoke(message.params?.name, message.params?.arguments) : { status: 'blocked', reason: startupReason };
      result = { content: [{ type: 'text', text: JSON.stringify(body) }], isError: ['blocked', 'failed', 'unknown', 'pending', 'provider_error'].includes(body.status) };
    } else error = { code: -32601, message: 'Method not found' };
    output.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...(error ? { error } : { result }) })}\n`);
  }
}
