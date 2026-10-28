import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const DOMAIN = 'tinyurl.com';
export const TIMEOUT_MS = 4000;
const ALIAS = /^[A-Za-z0-9_-]{1,30}$/;
const TOKEN = /^[A-Za-z0-9._~+/=-]{10,4096}$/;
const LOCK_STALE_MS = 60000;

class Blocked extends Error {
  constructor(code, nextAction) {
    super(code);
    this.code = code;
    this.nextAction = nextAction;
  }
}

const stop = (code, nextAction) => { throw new Blocked(code, nextAction); };
const shortUrlMatches = (value, alias) => {
  if (typeof value !== 'string') return false;
  try {
    const tiny = new URL(value);
    return tiny.protocol === 'https:' && tiny.hostname === DOMAIN && !tiny.username && !tiny.password
      && !tiny.search && !tiny.hash && tiny.pathname === `/${alias}`;
  } catch { return false; }
};
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

function aliasLockName(alias) {
  return createHash('sha256').update(`${DOMAIN}\0${alias}`).digest('hex');
}

async function acquireAliasLocks(stateDir, aliases, waitMs) {
  const locksDir = path.join(stateDir, 'locks');
  const acquired = [];
  try {
    ensureStateDirs(locksDir);
    for (const alias of [...new Set(aliases)].sort()) {
      const lock = path.join(locksDir, `${aliasLockName(alias)}.lock`);
      const until = Date.now() + waitMs;
      for (;;) {
        try {
          fs.mkdirSync(lock, 0o700);
          acquired.push(lock);
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          try {
            const info = fs.statSync(lock);
            if (Date.now() - info.mtimeMs > LOCK_STALE_MS) { fs.rmdirSync(lock); continue; }
          } catch { continue; }
          if (Date.now() >= until) stop('operation_in_progress', 'Another operation for this exact alias is in progress. Retry after it finishes.');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    }
  } catch (error) {
    for (const lock of acquired.reverse()) { try { fs.rmdirSync(lock); } catch {} }
    throw error;
  }
  return () => { for (const lock of acquired.reverse()) { try { fs.rmdirSync(lock); } catch {} } };
}

function ambiguousMutationFile(stateDir, alias) {
  return path.join(stateDir, 'mutations', `${aliasLockName(alias)}.json`);
}

function aliasMutationEventFile(stateDir, alias) {
  return path.join(stateDir, 'mutations', 'events', `${aliasLockName(alias)}.json`);
}

function markAliasReceiptsStale(operations, alias) {
  let names;
  try { names = fs.readdirSync(operations); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(operations, name);
    const record = readState(file);
    if (!record || record.domain !== DOMAIN || record.alias !== alias) continue;
    if (record.status === 'ok') {
      writeState(operations, file, { ...record, status: 'stale', staleReason: 'alias_updated_or_deleted', updatedAt: new Date().toISOString() });
    } else if (record.status === 'pending') {
      writeState(operations, file, { ...record, status: 'unknown', failure: 'alias_updated_or_deleted', updatedAt: new Date().toISOString() });
    }
  }
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
    stop('invalid_alias', 'Alias must be 1-30 characters using only letters, digits, underscore or hyphen.');
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
  if (!shortUrlMatches(tinyUrl, alias)) {
    stop('response_invalid', 'TinyURL returned a short link that does not match the reported alias.');
  }
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
    if (cached?.status === 'stale') {
      removeState(file);
    } else if (cached) return existingOutcome(input, cached);

    const token = readToken(config.tokenFile);
    const startedMs = Date.now();
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
    if (input.alias === undefined) {
      const release = await acquireAliasLocks(config.stateDir, [parsed.alias], Math.min(Math.max(timeoutMs * 2, 1000), 10000));
      try {
        const event = readState(aliasMutationEventFile(config.stateDir, parsed.alias));
        if (event && Number.isFinite(event.atMs) && event.atMs >= startedMs) {
          writeState(operations, file, {
            ...pending,
            status: 'unknown',
            failure: 'alias_mutated_during_create',
            updatedAt: new Date().toISOString(),
          });
          stop('write_outcome_unknown', 'A mutation touched the generated alias while the create was in flight. The link may be dead; do not report or retry blindly.');
        }
        writeState(operations, file, record);
      } finally { release(); }
    } else {
      writeState(operations, file, record);
    }
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
    const work = (async () => {
      const release = input.alias === undefined
        ? () => {}
        : await acquireAliasLocks(config.stateDir, [input.alias], Math.min(Math.max(timeoutMs * 2, 1000), 10000));
      try {
        if (input.alias !== undefined && readState(ambiguousMutationFile(config.stateDir, input.alias))) {
          stop('write_outcome_unknown', 'A previous mutation for this exact alias has an unknown outcome. Do not retry blindly; operator must reconcile the alias.');
        }
        return await createUnlocked(input, key, file);
      } finally { release(); }
    })().finally(() => inflight.delete(key));
    inflight.set(key, work);
    return work;
  }

  async function providerRequest({ method, pathname, body, write, token }) {
    let response;
    try {
      response = await fetchImpl(`https://api.tinyurl.com${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (error) {
      if (write) {
        stop('write_outcome_unknown', 'The write request was interrupted or timed out and may have reached TinyURL. Do not retry blindly; reconcile the exact alias.');
      }
      stop(error?.name === 'TimeoutError' ? 'read_timeout' : 'read_failed', 'The TinyURL read did not complete and may be retried.');
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        stop('api_rejected', `TinyURL rejected the request with HTTP ${response.status}.`);
      }
      if (write) stop('write_outcome_unknown', `TinyURL returned HTTP ${response.status} and the write outcome is unknown. Do not retry blindly.`);
      stop('provider_unavailable', `TinyURL returned HTTP ${response.status} for the read.`);
    }
    let payload;
    try { payload = await response.json(); } catch {
      if (write) stop('write_outcome_unknown', 'TinyURL returned an unreadable response and the write outcome is unknown. Do not retry blindly.');
      stop('response_invalid', 'TinyURL returned an unreadable read response.');
    }
    if (payload?.code !== 0) stop('api_rejected', 'TinyURL rejected the request with a provider error code.');
    if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      if (write) stop('write_outcome_unknown', 'TinyURL returned an incomplete response and the write outcome is unknown. Do not retry blindly.');
      stop('response_invalid', 'TinyURL returned an incomplete read response.');
    }
    return payload.data;
  }

  function parseAliasArgs(args) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) stop('invalid_arguments', 'Provide a JSON object with alias and optional domain.');
    const unknown = Object.keys(args).filter(key => !['alias', 'domain'].includes(key));
    if (unknown.length) stop('invalid_arguments', `Unknown fields: ${unknown.join(', ')}.`);
    if (typeof args.alias !== 'string') stop('invalid_alias', 'Supply the exact alias to read, update, change or delete.');
    return { alias: validateAlias(args.alias), domain: validateDomain(args.domain) };
  }

  function checkedTinyUrl(data, alias, required) {
    if (data.tiny_url === undefined && !required) return undefined;
    if (!shortUrlMatches(data.tiny_url, alias)) stop('response_invalid', 'TinyURL returned a short link that does not match the exact alias.');
    return data.tiny_url;
  }

  function clearMutationBarrier(aliases) {
    for (const alias of new Set(aliases)) removeState(ambiguousMutationFile(config.stateDir, alias));
  }

  async function mutationRequest(aliases, request) {
    const unique = [...new Set(aliases)];
    for (const alias of unique) {
      if (readState(ambiguousMutationFile(config.stateDir, alias))) {
        stop('write_outcome_unknown', 'A previous mutation for this exact alias has an unknown outcome. Do not retry blindly; operator must reconcile the alias.');
      }
    }
    const at = new Date().toISOString();
    const atMs = Date.now();
    for (const alias of unique) {
      writeState(path.join(config.stateDir, 'mutations', 'events'), aliasMutationEventFile(config.stateDir, alias), {
        domain: DOMAIN, alias, action: request.pathname, at, atMs,
      });
      writeState(path.join(config.stateDir, 'mutations'), ambiguousMutationFile(config.stateDir, alias), {
        domain: DOMAIN, alias, action: request.pathname, status: 'pending', at,
      });
    }
    try {
      return await providerRequest(request);
    } catch (error) {
      if (error?.code !== 'write_outcome_unknown') clearMutationBarrier(unique);
      throw error;
    }
  }

  async function read(args) {
    const input = parseAliasArgs(args);
    const token = readToken(config.tokenFile);
    const data = await providerRequest({
      method: 'GET',
      pathname: `/alias/${DOMAIN}/${encodeURIComponent(input.alias)}`,
      write: false,
      token,
    });
    if (data.domain !== DOMAIN || data.alias !== input.alias || typeof data.url !== 'string') {
      stop('response_invalid', 'TinyURL returned data that does not match the exact alias.');
    }
    const output = { status: 'ok', destination: data.url, domain: DOMAIN, alias: input.alias };
    const tinyUrl = checkedTinyUrl(data, input.alias, false);
    if (tinyUrl !== undefined) output.tinyUrl = tinyUrl;
    if (typeof data.deleted === 'boolean') output.deleted = data.deleted;
    if (typeof data.archived === 'boolean') output.archived = data.archived;
    if (Array.isArray(data.tags)) output.tags = data.tags.filter(tag => typeof tag === 'string');
    if (typeof data.expires_at === 'string' || data.expires_at === null) output.expiresAt = data.expires_at;
    if (typeof data.created_at === 'string') output.createdAt = data.created_at;
    if (data.analytics && typeof data.analytics === 'object') {
      output.analytics = {
        ...(typeof data.analytics.enabled === 'boolean' ? { enabled: data.analytics.enabled } : {}),
        ...(typeof data.analytics.public === 'boolean' ? { public: data.analytics.public } : {}),
      };
    }
    return output;
  }

  async function update(args) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) stop('invalid_arguments', 'Provide a JSON object with alias and metadata changes.');
    const allowed = ['alias', 'domain', 'new_alias', 'new_stats', 'new_tags', 'new_expires_at', 'new_description'];
    const unknown = Object.keys(args).filter(key => !allowed.includes(key));
    if (unknown.length) stop('invalid_arguments', `Unknown fields: ${unknown.join(', ')}.`);
    if (typeof args.alias !== 'string') stop('invalid_alias', 'Supply the exact alias to update.');
    const input = { alias: validateAlias(args.alias), domain: validateDomain(args.domain) };
    const changes = {};
    if (args.new_alias !== undefined) changes.new_alias = validateAlias(args.new_alias);
    if (args.new_stats !== undefined) {
      if (typeof args.new_stats !== 'boolean') stop('invalid_arguments', 'new_stats must be a boolean.');
      changes.new_stats = args.new_stats;
    }
    if (args.new_tags !== undefined) {
      if (!Array.isArray(args.new_tags) || args.new_tags.length > 50
        || args.new_tags.some(tag => typeof tag !== 'string' || tag.length < 1 || tag.length > 45)) {
        stop('invalid_arguments', 'new_tags must be an array of at most 50 non-empty strings of at most 45 characters.');
      }
      changes.new_tags = args.new_tags;
    }
    if (args.new_expires_at !== undefined) {
      if (args.new_expires_at !== null && (typeof args.new_expires_at !== 'string' || args.new_expires_at.length < 1 || args.new_expires_at.length > 100)) {
        stop('invalid_arguments', 'new_expires_at must be null or an ISO8601 string.');
      }
      changes.new_expires_at = args.new_expires_at;
    }
    if (args.new_description !== undefined) {
      if (args.new_description !== null && (typeof args.new_description !== 'string' || args.new_description.length < 3 || args.new_description.length > 1000)) {
        stop('invalid_arguments', 'new_description must be null or a string of 3-1000 characters.');
      }
      changes.new_description = args.new_description;
    }
    if (Object.keys(changes).length === 0) stop('invalid_arguments', 'Supply at least one new_alias, new_stats, new_tags, new_expires_at or new_description change.');
    const aliases = changes.new_alias === undefined ? [input.alias] : [input.alias, changes.new_alias];
    const release = await acquireAliasLocks(config.stateDir, aliases, Math.min(Math.max(timeoutMs * 2, 1000), 10000));
    try {
      const token = readToken(config.tokenFile);
      for (const alias of new Set(aliases)) markAliasReceiptsStale(operations, alias);
      const data = await mutationRequest(aliases, {
        method: 'PATCH',
        pathname: '/update',
        body: { domain: DOMAIN, alias: input.alias, ...changes },
        write: true,
        token,
      });
      const alias = changes.new_alias ?? input.alias;
      if (data.domain !== DOMAIN || data.alias !== alias || (data.url !== undefined && typeof data.url !== 'string')) {
        stop('write_outcome_unknown', 'TinyURL did not confirm the updated domain and alias. The write may have been applied; do not retry blindly.');
      }
      let tinyUrl;
      if (data.tiny_url !== undefined && !shortUrlMatches(data.tiny_url, alias)) {
        stop('write_outcome_unknown', 'TinyURL returned a short link that does not match the updated alias. The write may have been applied; do not retry blindly.');
      }
      if (data.tiny_url !== undefined) tinyUrl = data.tiny_url;
      clearMutationBarrier(aliases);
      const output = { status: 'ok', action: 'updated', domain: DOMAIN, alias, destination: data.url };
      if (tinyUrl !== undefined) output.tinyUrl = tinyUrl;
      if (Array.isArray(data.tags)) output.tags = data.tags.filter(tag => typeof tag === 'string');
      if (typeof data.analytics === 'object' && data.analytics) {
        output.analytics = {
          ...(typeof data.analytics.enabled === 'boolean' ? { enabled: data.analytics.enabled } : {}),
          ...(typeof data.analytics.public === 'boolean' ? { public: data.analytics.public } : {}),
        };
      }
      return output;
    } finally { release(); }
  }

  async function changeDestination(args) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) stop('invalid_arguments', 'Provide a JSON object with alias, url and optional domain.');
    const unknown = Object.keys(args).filter(key => !['alias', 'domain', 'url'].includes(key));
    if (unknown.length) stop('invalid_arguments', `Unknown fields: ${unknown.join(', ')}.`);
    if (typeof args.alias !== 'string') stop('invalid_alias', 'Supply the exact alias whose destination will change.');
    if (typeof args.url !== 'string') stop('invalid_url', 'Supply the exact new absolute http(s) destination URL.');
    const input = { alias: validateAlias(args.alias), domain: validateDomain(args.domain), url: validateUrl(args.url) };
    const release = await acquireAliasLocks(config.stateDir, [input.alias], Math.min(Math.max(timeoutMs * 2, 1000), 10000));
    try {
      const token = readToken(config.tokenFile);
      markAliasReceiptsStale(operations, input.alias);
      const data = await mutationRequest([input.alias], {
        method: 'PATCH',
        pathname: '/change',
        body: { domain: DOMAIN, alias: input.alias, url: input.url },
        write: true,
        token,
      });
      if (data.url !== input.url) {
        stop('write_outcome_unknown', 'TinyURL did not confirm the exact new destination. The write may have been applied; do not retry blindly.');
      }
      clearMutationBarrier([input.alias]);
      return { status: 'ok', action: 'destination_changed', destination: input.url, domain: DOMAIN, alias: input.alias };
    } finally { release(); }
  }

  async function remove(args) {
    const input = parseAliasArgs(args);
    const release = await acquireAliasLocks(config.stateDir, [input.alias], Math.min(Math.max(timeoutMs * 2, 1000), 10000));
    try {
      const token = readToken(config.tokenFile);
      markAliasReceiptsStale(operations, input.alias);
      const data = await mutationRequest([input.alias], {
        method: 'DELETE',
        pathname: `/alias/${DOMAIN}/${encodeURIComponent(input.alias)}`,
        write: true,
        token,
      });
      if (data.domain !== DOMAIN || data.alias !== input.alias) {
        stop('write_outcome_unknown', 'TinyURL did not confirm deletion of the exact domain and alias. The write may have been applied; do not retry blindly.');
      }
      clearMutationBarrier([input.alias]);
      const output = { status: 'ok', action: 'deleted', domain: DOMAIN, alias: input.alias };
      if (typeof data.url === 'string') output.destination = data.url;
      return output;
    } finally { release(); }
  }

  return { create, read, update, changeDestination, remove, delete: remove, status };
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
        alias: { type: 'string', description: 'Optional alias: 1-30 letters, digits, underscore or hyphen.' },
      },
    },
  },
  {
    name: 'tinyurl_read',
    description: 'Read one exact TinyURL alias through GET /alias/{domain}/{alias}. Requires alias; domain is fixed to tinyurl.com.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['alias'],
      properties: {
        alias: { type: 'string', description: 'Exact alias to read.' },
        domain: { type: 'string', enum: [DOMAIN], description: `Fixed ${DOMAIN} domain.` },
      },
    },
  },
  {
    name: 'tinyurl_update',
    description: 'Update metadata or rename one exact TinyURL alias through PATCH /update. Requires alias and at least one new_* field. Never changes the destination; use tinyurl_change_destination for that.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['alias'],
      properties: {
        alias: { type: 'string', description: 'Exact existing alias to update.' },
        domain: { type: 'string', enum: [DOMAIN], description: `Fixed ${DOMAIN} domain.` },
        new_alias: { type: 'string', description: 'New alias: 1-30 letters, digits, underscore or hyphen.' },
        new_stats: { type: 'boolean', description: 'Enable or disable click analytics collection.' },
        new_tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tags, each at most 45 characters.' },
        new_expires_at: { type: ['string', 'null'], description: 'ISO8601 expiration, or null for never.' },
        new_description: { type: ['string', 'null'], description: 'Description of 3-1000 characters, or null.' },
      },
    },
  },
  {
    name: 'tinyurl_change_destination',
    description: 'Change the destination of one exact TinyURL alias through PATCH /change. Requires alias and the exact new absolute http(s) url.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['alias', 'url'],
      properties: {
        alias: { type: 'string', description: 'Exact existing alias whose destination will change.' },
        domain: { type: 'string', enum: [DOMAIN], description: `Fixed ${DOMAIN} domain.` },
        url: { type: 'string', description: 'Exact new absolute http(s) destination URL, preserved byte-for-byte.' },
      },
    },
  },
  {
    name: 'tinyurl_delete',
    description: 'Delete one exact TinyURL alias through DELETE /alias/{domain}/{alias}. Requires alias; domain is fixed to tinyurl.com.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['alias'],
      properties: {
        alias: { type: 'string', description: 'Exact alias to delete.' },
        domain: { type: 'string', enum: [DOMAIN], description: `Fixed ${DOMAIN} domain.` },
      },
    },
  },
  {
    name: 'tinyurl_status',
    description: 'Read-only check for TinyURL connector configuration, token and private state directory. Does not create a link or write state.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];
