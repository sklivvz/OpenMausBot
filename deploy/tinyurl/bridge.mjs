import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const DOMAIN = 'tinyurl.com';
export const TIMEOUT_MS = 4000;
const ALIAS = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9._~+/=-]{10,4096}$/;

class Blocked extends Error {
  constructor(code, nextAction) {
    super(code);
    this.code = code;
    this.nextAction = nextAction;
  }
}

const stop = (code, nextAction) => { throw new Blocked(code, nextAction); };
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
  : item);
export const operationKey = ({ url, domain, alias }) => createHash('sha256')
  .update(canonical({ url, domain, alias: alias ?? null })).digest('hex');

function privateFile(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    stop('private_file_invalid', 'Operator must provide a regular 0600 file.');
  }
  if (info.size === 0 || info.size > 65536) {
    stop('private_file_invalid', 'Operator must provide a non-empty file of at most 64 KiB.');
  }
  return fs.readFileSync(file, 'utf8');
}

function readToken(file) {
  let text;
  try { text = privateFile(file).trim(); } catch (error) {
    if (error instanceof Blocked) throw error;
    stop('credentials_unavailable', 'Operator must provide the TinyURL API token in a valid private token file.');
  }
  if (text.startsWith('{')) {
    try { text = (JSON.parse(text).token ?? JSON.parse(text).apiToken ?? '').trim(); } catch { text = ''; }
  }
  if (!TOKEN.test(text)) stop('credentials_unavailable', 'Operator must provide a valid TinyURL API token in the configured private file.');
  return text;
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return null;
    stop('state_unreadable', 'Operator must repair or remove the private operation record.');
  }
}

function ensureStateDirs(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const current of [path.dirname(dir), dir]) {
    const info = fs.lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
      stop('private_directory_invalid', 'Operator must provide a real private state directory (0700).');
    }
  }
}

function syncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeState(dir, file, value) {
  ensureStateDirs(dir);
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  syncDir(dir);
}

function claimState(dir, file, value) {
  ensureStateDirs(dir);
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    fs.linkSync(tmp, file);
    syncDir(dir);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function removeState(file) {
  try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  syncDir(path.dirname(file));
}

function validateUrl(input) {
  let parsed;
  try { parsed = new URL(input); } catch { stop('invalid_url', 'Supply an absolute http(s) URL exactly as it should be shortened.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    stop('invalid_url', 'Supply an absolute http(s) URL without embedded credentials.');
  }
  return input;
}

function validateAlias(input) {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || !ALIAS.test(input)) {
    stop('invalid_alias', 'Alias must be 1-64 characters using only letters, digits, underscore or hyphen.');
  }
  return input;
}

function validateDomain(input) {
  if (input !== undefined && input !== DOMAIN) {
    stop('unsupported_domain', `This connector is fixed to the ${DOMAIN} domain.`);
  }
  return DOMAIN;
}

function validResult(input, record) {
  if (record?.status !== 'ok' || record.url !== input.url || record.domain !== input.domain) return false;
  if (input.alias !== undefined && record.alias !== input.alias) return false;
  if (typeof record.tinyUrl !== 'string') return false;
  try {
    const tiny = new URL(record.tinyUrl);
    if (tiny.protocol !== 'https:' || tiny.hostname !== DOMAIN || tiny.username || tiny.password
      || tiny.search || tiny.hash || tiny.pathname !== `/${record.alias}`) return false;
  } catch { return false; }
  return true;
}

function result(record, reused) {
  return {
    status: 'ok',
    destination: record.url,
    domain: record.domain,
    alias: record.alias,
    tinyUrl: record.tinyUrl,
    reused,
  };
}

function parseResponse(input, body) {
  if (body?.code !== 0 || !body?.data) stop('api_rejected', 'TinyURL rejected the request. Check the destination URL and alias.');
  const { url, domain, alias, tiny_url: tinyUrl } = body.data;
  if (typeof url !== 'string' || url !== input.url) {
    stop('destination_mismatch', 'TinyURL returned a different destination; no short link is reported.');
  }
  if (domain !== input.domain || typeof alias !== 'string' || !ALIAS.test(alias) || typeof tinyUrl !== 'string') {
    stop('response_invalid', 'TinyURL returned an incomplete or unexpected response; no short link is reported.');
  }
  try {
    const tiny = new URL(tinyUrl);
    if (tiny.protocol !== 'https:' || tiny.hostname !== DOMAIN || tiny.username || tiny.password
      || tiny.search || tiny.hash || tiny.pathname !== `/${alias}`) {
      stop('response_invalid', 'TinyURL returned a short link that does not match the reported alias.');
    }
  } catch { stop('response_invalid', 'TinyURL returned an invalid short link; no short link is reported.'); }
  if (input.alias !== undefined && alias !== input.alias) {
    stop('alias_mismatch', 'TinyURL returned a different alias; no short link is reported.');
  }
  return { url, domain, alias, tinyUrl };
}

export function createBridge(config, { fetchImpl = globalThis.fetch } = {}) {
  if (!config || typeof config !== 'object' || typeof config.tokenFile !== 'string' || !path.isAbsolute(config.tokenFile)
    || typeof config.stateDir !== 'string' || !path.isAbsolute(config.stateDir)) {
    stop('configuration_invalid', 'Operator must set absolute tokenFile and stateDir values.');
  }
  const timeoutMs = config.timeoutMs ?? TIMEOUT_MS;
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 4000) {
    stop('configuration_invalid', 'timeoutMs must be an integer between 100 and 4000.');
  }
  if (typeof fetchImpl !== 'function') stop('configuration_invalid', 'A fetch implementation is required.');

  const operations = path.join(config.stateDir, 'operations');
  const inflight = new Map();

  function status() {
    let token = false;
    try { readToken(config.tokenFile); token = true; } catch { token = false; }
    let stateDirectory = false;
    try {
      const info = fs.lstatSync(config.stateDir);
      stateDirectory = info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o077) === 0;
    } catch { stateDirectory = false; }
    return {
      status: 'ok',
      configured: token && stateDirectory,
      domain: DOMAIN,
      tokenPresent: token,
      stateDirectoryPresent: stateDirectory,
      timeoutMs,
    };
  }

  function existingOutcome(input, cached) {
    if (cached.status === 'ok') {
      if (!validResult(input, cached)) {
        stop('cache_mismatch', 'A cached operation record does not match this exact destination. Operator must review the private state file.');
      }
      return result(cached, true);
    }
    stop('write_outcome_unknown', 'A previous attempt for this exact operation may have reached TinyURL. Do not retry blindly; operator must reconcile the alias.');
  }

  async function waitForOperation(file) {
    const until = Date.now() + timeoutMs + 250;
    for (;;) {
      const current = readState(file);
      if (current && current.status !== 'pending') return current;
      if (Date.now() >= until) return current;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  async function createUnlocked(input, key, file) {
    const cached = readState(file);
    if (cached?.status === 'pending') {
      const other = await waitForOperation(file);
      if (!other) stop('state_unavailable', 'Another process removed this operation record. Retry only after confirming no short link was created.');
      return existingOutcome(input, other);
    }
    if (cached) return existingOutcome(input, cached);

    const token = readToken(config.tokenFile);
    const now = new Date().toISOString();
    const pending = { key, ...input, status: 'pending', createdAt: now, updatedAt: now };
    if (!claimState(operations, file, pending)) {
      const other = await waitForOperation(file);
      if (!other) stop('state_unavailable', 'Another process removed this operation record. Retry only after confirming no short link was created.');
      return existingOutcome(input, other);
    }

    let response;
    try {
      response = await fetchImpl('https://api.tinyurl.com/create', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ url: input.url, domain: input.domain, ...(input.alias ? { alias: input.alias } : {}) }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      writeState(operations, file, {
        ...pending,
        status: 'unknown',
        failure: error?.name === 'TimeoutError' ? 'timeout' : 'network',
        updatedAt: new Date().toISOString(),
      });
      stop('write_outcome_unknown', 'The create request was interrupted or timed out and may have reached TinyURL. Do not retry blindly; operator must reconcile the alias.');
    }

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        removeState(file);
        stop('api_rejected', `TinyURL rejected the request with HTTP ${response.status}.`);
      }
      writeState(operations, file, { ...pending, status: 'unknown', failure: 'http', updatedAt: new Date().toISOString() });
      stop('write_outcome_unknown', `TinyURL returned HTTP ${response.status} and the write outcome is unknown. Do not retry blindly.`);
    }

    let body;
    try { body = await response.json(); } catch {
      writeState(operations, file, { ...pending, status: 'unknown', failure: 'response', updatedAt: new Date().toISOString() });
      stop('write_outcome_unknown', 'TinyURL returned an unreadable response and the write outcome is unknown. Do not retry blindly.');
    }

    let parsed;
    try { parsed = parseResponse(input, body); } catch (error) {
      writeState(operations, file, { ...pending, status: 'unknown', failure: 'response', updatedAt: new Date().toISOString() });
      throw error;
    }
    const record = { key, ...input, ...parsed, status: 'ok', createdAt: now, updatedAt: new Date().toISOString() };
    writeState(operations, file, record);
    return result(record, false);
  }

  async function create(args = {}) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) stop('invalid_arguments', 'Provide a JSON object with url, optional domain and alias.');
    const unknown = Object.keys(args).filter(key => !['url', 'domain', 'alias'].includes(key));
    if (unknown.length) stop('invalid_arguments', `Unknown fields: ${unknown.join(', ')}.`);
    if (typeof args.url !== 'string') stop('invalid_url', 'Supply the exact absolute URL to shorten.');
    const input = {
      url: validateUrl(args.url),
      domain: validateDomain(args.domain),
      ...(args.alias === undefined ? {} : { alias: validateAlias(args.alias) }),
    };
    const key = operationKey(input);
    const file = path.join(operations, `${key}.json`);
    if (inflight.has(key)) return inflight.get(key);
    const work = createUnlocked(input, key, file).finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
  }

  return { create, status };
}

export const toolDefinitions = [
  {
    name: 'tinyurl_create',
    description: 'Create one exact TinyURL short link through the authenticated TinyURL API. Requires url; domain is fixed to tinyurl.com; alias is optional. Reuses durable operation results and never retries an ambiguous write blindly.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Exact absolute http(s) destination URL, preserved byte-for-byte.' },
        domain: { type: 'string', enum: [DOMAIN], description: `Fixed ${DOMAIN} domain.` },
        alias: { type: 'string', description: 'Optional alias: 1-64 letters, digits, underscore or hyphen.' },
      },
    },
  },
  {
    name: 'tinyurl_status',
    description: 'Read-only check for TinyURL connector configuration, token and private state directory. Does not create a link or write state.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];
