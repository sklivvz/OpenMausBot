import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { RemoteMcpClient } from '../../server/mcp-http.ts';
import { ENDPOINT, OPERATIONS, TOOLS } from './catalog.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const PAGE_SIZE = 6000;
const canonical = (value) => JSON.stringify(value, (_, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])) : entry);
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const contained = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
const blocked = (reason, extra = {}) => ({ status: 'blocked', reason, ...extra });

export class PerkError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

export async function privateJson(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new PerkError('private_file_permissions_required');
  if (stat.size > MAX_BYTES) throw new PerkError('private_file_too_large');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export async function loadConfig(file, { externalCredentials = false } = {}) {
  if (!file || !path.isAbsolute(file)) throw new PerkError('config_missing');
  const config = await privateJson(file);
  if ((!externalCredentials && !path.isAbsolute(config.tokenFile ?? '')) || (config.tokenFile !== undefined && !path.isAbsolute(config.tokenFile)) || !path.isAbsolute(config.stateDir ?? '') || typeof config.allowDrafts !== 'boolean') throw new PerkError('config_invalid');
  const state = path.resolve(config.stateDir);
  if (contained(state, path.resolve(file)) || (config.tokenFile && contained(state, path.resolve(config.tokenFile)))) throw new PerkError('credentials_inside_evidence_directory');
  await fs.mkdir(state, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(state);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new PerkError('private_directory_permissions_required');
  return { ...config, stateDir: state };
}

export function makeProvider(access, fetchImpl = fetch) {
  const client = new RemoteMcpClient({ type: 'http', url: ENDPOINT, headers: { Authorization: `Bearer ${access}` } }, {
    maxBytes: MAX_BYTES,
    fetch: (url, init) => {
      if (String(url) !== ENDPOINT) throw new PerkError('unexpected_provider_destination');
      return fetchImpl(url, { ...init, redirect: 'error' });
    },
  });
  return {
    initialize: (signal) => client.initialize('openmausbot-perk', signal),
    list: (cursor, signal) => client.request('tools/list', cursor ? { cursor } : {}, signal),
    call: (name, args, signal) => client.request('tools/call', { name, arguments: args }, signal),
    close: () => client.close(),
  };
}

export class PerkConnector {
  constructor(config, { providerFactory = makeProvider, credentialProvider = () => privateJson(config.tokenFile), now = Date.now, timeoutMs = 25_000 } = {}) {
    this.config = config;
    this.providerFactory = providerFactory;
    this.credentialProvider = credentialProvider;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.ajv = new Ajv({ strict: false, allErrors: false, validateFormats: true, addUsedSchema: false });
    addFormats(this.ajv);
    this.validators = new Map(TOOLS.map((tool) => [tool.name, this.ajv.compile(tool.inputSchema)]));
  }

  async session(action) {
    let token;
    try { token = await this.credentialProvider(); }
    catch (error) { throw new PerkError(error.code === 'ENOENT' ? 'auth_missing' : error.reason ?? 'credential_invalid'); }
    if (typeof token.access !== 'string' || !token.access || /[\r\n]/.test(token.access)) throw new PerkError('auth_missing');
    if (!Number.isFinite(token.expiresAt) || token.expiresAt <= this.now() + 30_000) throw new PerkError('auth_expired');
    const provider = this.providerFactory(token.access);
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      await provider.initialize(signal);
      const contracts = new Map();
      let cursor;
      const seen = new Set();
      for (let page = 0; page < 8; page++) {
        const result = await provider.list(cursor, signal);
        if (!Array.isArray(result?.tools)) throw new PerkError('invalid_provider_catalog');
        for (const tool of result.tools) {
          if (!Object.hasOwn(OPERATIONS, tool.name)) continue;
          if (contracts.has(tool.name) || !tool.inputSchema || tool.inputSchema.type !== 'object' || Buffer.byteLength(JSON.stringify(tool.inputSchema)) > 24 * 1024) throw new PerkError('invalid_provider_contract');
          let validate;
          try { validate = this.ajv.compile(tool.inputSchema); }
          catch { throw new PerkError('unsupported_provider_schema'); }
          contracts.set(tool.name, { schema: tool.inputSchema, schemaHash: hash(tool.inputSchema), validate });
        }
        cursor = result.nextCursor;
        if (!cursor) return await action(provider, contracts, signal);
        if (typeof cursor !== 'string' || seen.has(cursor)) throw new PerkError('invalid_provider_pagination');
        seen.add(cursor);
      }
      throw new PerkError('provider_catalog_limit');
    } finally { await provider.close().catch(() => {}); }
  }

  filename(id) { return path.join(this.config.stateDir, `${id}.json`); }

  async save(receipt, exclusive = false) {
    const file = this.filename(receipt.receiptId);
    const serialized = JSON.stringify(receipt);
    if (Buffer.byteLength(serialized) > MAX_BYTES) throw new PerkError('evidence_limit');
    const destination = exclusive ? file : `${file}.${randomUUID()}.tmp`;
    const handle = await fs.open(destination, 'wx', 0o600);
    try { await handle.writeFile(serialized); await handle.sync(); }
    finally { await handle.close(); }
    if (!exclusive) await fs.rename(destination, file);
    const directory = await fs.open(this.config.stateDir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }

  async result(id, offset = 0) {
    let receipt;
    try { receipt = await privateJson(this.filename(id)); }
    catch (error) { if (error.code === 'ENOENT') return blocked('receipt_missing'); throw error; }
    const { payload, fingerprint: _fingerprint, ...summary } = receipt;
    if (payload === undefined) return { ...summary, nextAction: 'Reconcile the draft trip in Perk before any new preparation attempt.' };
    const serialized = JSON.stringify(payload);
    if (offset > serialized.length) return blocked('invalid_result_offset');
    const next = offset + PAGE_SIZE;
    return { ...summary, ...(receipt.status === 'unknown' ? { nextAction: 'Reconcile the draft trip in Perk; never retry with a new operationId.' } : {}), evidence: { format: 'json-fragment', offset, totalCharacters: serialized.length, content: serialized.slice(offset, next), nextOffset: next < serialized.length ? next : null }, bookingStatus: 'not_confirmed_by_connector' };
  }

  async invoke(name, args = {}) {
    const validate = this.validators.get(name);
    if (!validate || !validate(args)) return blocked('invalid_tool_arguments');
    try {
      if (name === 'perk_result') return await this.result(args.receiptId, args.offset);
      if (name === 'perk_prepare') {
        const existing = await this.existing(args);
        if (existing) return existing;
        if (!this.config.allowDrafts) return blocked('draft_preparation_disabled');
      }
      return await this.session(async (provider, contracts, signal) => {
        if (name === 'perk_status') return { status: 'ready', allowDrafts: this.config.allowDrafts, bookingBoundary: 'human_checkout_only', operations: [...contracts.keys()].map((operation) => ({ operation, effect: OPERATIONS[operation] })), qualification: 'authenticated_schema_discovery_only' };
        const contract = contracts.get(args.operation);
        if (!contract) return blocked('operation_unavailable', { operation: args.operation });
        if (name === 'perk_contract') return { status: 'ready', operation: args.operation, effect: OPERATIONS[args.operation], inputSchema: contract.schema, schemaHash: contract.schemaHash };
        if (args.schemaHash !== contract.schemaHash) return blocked('schema_changed', { nextAction: 'Read perk_contract and revalidate the intended arguments.' });
        if (!contract.validate(args.arguments)) return blocked('provider_arguments_invalid', { fields: contract.validate.errors?.map((item) => ({ path: item.instancePath, rule: item.keyword })) });
        const receipt = {
          receiptId: name === 'perk_prepare' ? args.operationId : randomUUID(),
          operation: args.operation, effect: OPERATIONS[args.operation],
          fingerprint: hash(args), sourceRef: args.sourceRef ?? null,
          schemaHash: args.schemaHash, createdAt: new Date(this.now()).toISOString(),
          status: 'pending',
        };
        try { await this.save(receipt, true); }
        catch (error) { if (error.code === 'EEXIST') return await this.existing(args) ?? blocked('receipt_conflict'); throw error; }
        try {
          const payload = await provider.call(args.operation, args.arguments, signal);
          if (!payload || !Array.isArray(payload.content) || Buffer.byteLength(JSON.stringify(payload)) > MAX_BYTES - 8192) throw new PerkError('invalid_provider_result');
          receipt.payload = payload;
          receipt.status = payload.isError ? (receipt.effect === 'prepare' ? 'unknown' : 'provider_error') : 'provider_returned';
          receipt.completedAt = new Date(this.now()).toISOString();
          await this.save(receipt);
        } catch (error) {
          receipt.status = receipt.effect === 'prepare' ? 'unknown' : 'failed';
          receipt.reason = this.errorReason(error);
          await this.save(receipt);
        }
        return await this.result(receipt.receiptId);
      });
    } catch (error) { return blocked(this.errorReason(error)); }
  }

  async existing(args) {
    try {
      const receipt = await privateJson(this.filename(args.operationId));
      if (receipt.fingerprint !== hash(args)) return blocked('operation_id_conflict');
      return { ...await this.result(args.operationId), replayed: true };
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  errorReason(error) {
    if (error.reason) return error.reason;
    if (error.status === 401) return 'auth_required';
    if (error.status === 403) return 'account_scope_role_or_plan_denied';
    if (error.status === 429) return 'rate_limited';
    if (['TimeoutError', 'AbortError'].includes(error.name)) return 'timeout';
    return 'provider_or_storage_failure';
  }
}
