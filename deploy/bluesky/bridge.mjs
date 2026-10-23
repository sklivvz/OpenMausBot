import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

const collection = 'app.bsky.feed.post';
const op = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().refine(s => s.isWellFormed());
const prepareSchema = z.object({
  operationId: op,
  text: text.refine(s => Buffer.byteLength(s) <= 3000 && [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length <= 300),
  images: z.array(z.object({ path: z.string(), sha256: sha, alt: text.min(1).max(10000) }).strict()).max(4).default([]),
  links: z.array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(), url: z.string().max(2048) }).strict()).max(50).default([]),
  langs: z.array(z.string().refine(s => { try { return Intl.getCanonicalLocales(s).length === 1; } catch { return false; } })).max(3).default([]),
}).strict().refine(v => v.text.length > 0 || v.images.length > 0);
const operationSchema = z.object({ operationId: op, contentSha256: sha }).strict();
const properties = { operationId: { type: 'string', description: 'Stable immutable business operation ID; reuse on every retry.' }, contentSha256: { type: 'string' } };
export const toolDefinitions = [
  { name: 'bluesky_prepare_post', description: 'Prepare one exact Bluesky text/image post locally. No publication. Links use explicit UTF-16 start/end offsets, converted to protocol UTF-8 facets. Mentions, replies, videos and cards are not supported.', inputSchema: { type: 'object', additionalProperties: false, required: ['operationId', 'text'], properties: { operationId: properties.operationId, text: { type: 'string' }, images: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['path', 'sha256', 'alt'], properties: { path: { type: 'string' }, sha256: { type: 'string' }, alt: { type: 'string' } } } }, links: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['start', 'end', 'url'], properties: { start: { type: 'integer' }, end: { type: 'integer' }, url: { type: 'string' } } } }, langs: { type: 'array', items: { type: 'string' } } } } },
  ...['publish', 'reconcile'].map(action => ({ name: `bluesky_${action}_post`, description: action === 'publish' ? 'Publish a prepared operation only with publishing enabled and an unexpired private host grant matching operation, account and content. Never accepts caller approval. Repeated calls reconcile, never blindly resubmit.' : 'Read back a stable operation record and verify exact content and URI/CID without writing.', inputSchema: { type: 'object', additionalProperties: false, required: ['operationId', 'contentSha256'], properties } })),
  { name: 'bluesky_account_status', description: 'Check fixed account authentication. Does not publish.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
];
export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
class Blocker extends Error { constructor(code, nextAction) { super(code); this.code = code; this.nextAction = nextAction; } }
const stop = (code, nextAction) => { throw new Blocker(code, nextAction); };
const inside = (file, root) => file === root || file.startsWith(root + path.sep);
function privateRead(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 1024 * 1024) stop('private_file_invalid', 'Operator must provide a regular private file (0600), at most 1 MiB.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(file, value) {
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(dir) !== path.resolve(dir) || (fs.statSync(dir).mode & 0o077) !== 0) stop('private_directory_invalid', 'Operator must configure a real private directory (0700).');
  return path.resolve(dir);
}
function tid(stateDir) {
  const file = path.join(stateDir, 'clock.json');
  const previous = fs.existsSync(file) ? BigInt(privateRead(file).micros) : 0n;
  const micros = BigInt(Date.now()) * 1000n > previous ? BigInt(Date.now()) * 1000n : previous + 1n;
  save(file, { micros: micros.toString() });
  let n = (micros << 10n) | BigInt(randomBytes(2).readUInt16BE() & 1023);
  let result = '';
  for (let i = 0; i < 13; i++) { result = '234567abcdefghijklmnopqrstuvwxyz'[Number(n & 31n)] + result; n >>= 5n; }
  return result;
}
function facets(input) {
  const ranges = [...input.links].sort((a, b) => a.start - b.start);
  let end = 0;
  const result = ranges.map(link => {
    let url;
    try { url = new URL(link.url); } catch { stop('invalid_link', 'Supply an absolute HTTPS link.'); }
    if (url.protocol !== 'https:' || url.username || url.password || link.start < end || link.end <= link.start || link.end > input.text.length || !input.text.slice(0, link.start).isWellFormed() || !input.text.slice(0, link.end).isWellFormed()) stop('invalid_link', 'Supply nonoverlapping UTF-16 ranges on complete characters and HTTPS links without credentials.');
    end = link.end;
    return { index: { byteStart: Buffer.byteLength(input.text.slice(0, link.start)), byteEnd: Buffer.byteLength(input.text.slice(0, link.end)) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: link.url }] };
  });
  for (const match of input.text.matchAll(/https?:\/\/[^\s]+/g)) {
    if (!ranges.some(r => r.start <= match.index && r.end > match.index)) stop('unfaceted_url', 'Supply an explicit link range for each URL, excluding punctuation deliberately.');
  }
  if (/(?:^|\s)@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}/.test(input.text)) stop('unsupported_mention', 'Mention resolution is not supported by this connector; obtain an approved plain-name version or add verified DID resolution.');
  return result;
}
export function createBridge(config) {
  let pds;
  try { pds = new URL(config.pdsUrl); } catch { stop('configuration_invalid', 'Operator must set the trusted PDS HTTPS origin.'); }
  if (pds.pathname !== '/' || pds.search || pds.hash || pds.username || pds.password || !(pds.protocol === 'https:' || (pds.protocol === 'http:' && pds.hostname === '127.0.0.1'))) stop('configuration_invalid', 'PDS must be an HTTPS origin; HTTP is allowed only for literal loopback fixtures.');
  if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(config.accountDid ?? '')) stop('configuration_invalid', 'Operator must pin the account DID.');
  const roots = (config.artifactRoots ?? []).map(p => fs.realpathSync(p));
  const stateDir = privateDir(config.stateDir);
  const grantDir = privateDir(config.grantDir);
  const credentialFile = path.resolve(config.credentialsFile);
  for (const file of [stateDir, grantDir, credentialFile]) if (roots.some(root => inside(file, root) || inside(root, file))) stop('configuration_invalid', 'Credentials, grants and state must be outside artifact roots.');
  if (inside(grantDir, stateDir) || inside(stateDir, grantDir)) stop('configuration_invalid', 'Grant and state directories must be separate.');
  const sessionFile = path.join(stateDir, 'session.json');
  const timeoutMs = Math.min(Math.max(config.timeoutMs ?? 15000, 100), 30000);
  const operationFile = id => path.join(stateDir, `operation-${id}.json`);
  async function request(method, params, token, bytes, mime) {
    const url = new URL(`/xrpc/${method}`, pds);
    const isGet = ['com.atproto.repo.getRecord', 'com.atproto.server.getSession'].includes(method);
    if (isGet) url.search = new URLSearchParams(params).toString();
    let response;
    try {
      response = await fetch(url, { method: isGet ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(!isGet ? { 'content-type': mime ?? 'application/json' } : {}) }, body: isGet ? undefined : bytes ?? JSON.stringify(params) });
      const reader = response.body.getReader();
      let size = 0; const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) { await reader.cancel(); stop('provider_response_too_large', 'Operator must inspect the provider response; no automatic retry.'); } chunks.push(value); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok) {
        const code = ['RecordNotFound', 'InvalidSwap', 'ExpiredToken', 'InvalidToken', 'AuthenticationRequired', 'AuthFactorTokenRequired', 'AccountTakedown', 'AccountDeactivated', 'InvalidRequest', 'RateLimitExceeded'].includes(body.error) ? body.error : 'ProviderRejected';
        throw new Blocker(code, response.status === 401 ? 'Operator must reconnect the configured Bluesky account.' : 'Inspect operation status before retry; provider response was rejected.');
      }
      return body;
    } catch (error) { if (error instanceof Blocker) throw error; stop('provider_unavailable', 'Reconcile the stable operation before retrying any write.'); }
  }
  function validateSession(session) {
    if (session.did !== config.accountDid || session.active === false) stop('account_mismatch_or_inactive', 'Operator must reconnect the pinned active account; do not switch accounts automatically.');
    return session;
  }
  async function authenticate() {
    let session;
    if (fs.existsSync(sessionFile)) {
      session = privateRead(sessionFile);
      try { validateSession(await request('com.atproto.server.getSession', {}, session.accessJwt)); return session.accessJwt; }
      catch (error) {
        if (!['ExpiredToken', 'InvalidToken', 'AuthenticationRequired'].includes(error.code)) throw error;
        try { session = validateSession(await request('com.atproto.server.refreshSession', {}, session.refreshJwt)); }
        catch { stop('auth_expired', 'Operator must reconnect Bluesky and replace the private session; no login loop was attempted.'); }
      }
    } else {
      if (!fs.existsSync(credentialFile)) stop('auth_missing', 'Operator must install the private account app-password credentials.');
      const credential = privateRead(credentialFile);
      if (typeof credential.appPassword !== 'string' || !credential.appPassword) stop('auth_missing', 'Operator must configure an app-password for the pinned account.');
      session = validateSession(await request('com.atproto.server.createSession', { identifier: config.accountDid, password: credential.appPassword }));
    }
    if (typeof session.accessJwt !== 'string' || typeof session.refreshJwt !== 'string') stop('provider_contract_invalid', 'Operator must inspect the authentication response.');
    save(sessionFile, session);
    return session.accessJwt;
  }
  function imageBytes(image) {
    let real;
    try { real = fs.realpathSync(image.path); } catch { stop('image_missing', 'Restore the exact approved local image.'); }
    if (!roots.some(root => inside(real, root))) stop('image_outside_artifacts', 'Use an image within configured artifact roots.');
    const fd = fs.openSync(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let bytes;
    try {
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.size > 2000000 || info.size === 0) stop('invalid_image_size', 'Use a nonempty PNG, JPEG or WebP no larger than 2,000,000 bytes.');
      const buffer = Buffer.alloc(2000001);
      let size = 0;
      while (size < buffer.length) { const count = fs.readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; }
      if (size === 0 || size > 2000000) stop('invalid_image_size', 'Use a nonempty image no larger than 2,000,000 bytes.');
      bytes = buffer.subarray(0, size);
    } finally { fs.closeSync(fd); }
    if (hash(bytes) !== image.sha256) stop('image_hash_mismatch', 'Restore the exact approved image; changed content requires a new operation and grant.');
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!mime) stop('unsupported_image', 'Use an approved PNG, JPEG or WebP; this tool does not convert images.');
    return { bytes, mime };
  }
  function approval(saved) {
    if (config.allowPublish !== true) stop('publishing_disabled', 'Operator must enable publishing after channel qualification.');
    const file = path.join(grantDir, `${saved.operationId}.json`);
    if (!fs.existsSync(file)) stop('approval_missing', 'Request an exact host-issued grant for this operation, account and content hash.');
    const grant = privateRead(file);
    if (grant.operationId !== saved.operationId || grant.contentSha256 !== saved.contentSha256 || grant.accountDid !== config.accountDid || grant.pdsUrl !== pds.origin || typeof grant.authoritySource !== 'string' || !grant.authoritySource.trim() || !(Date.parse(grant.notBefore) <= Date.now()) || !(Date.parse(grant.expiresAt) > Date.now())) stop('approval_invalid_or_expired', 'Obtain a matching current host-issued grant from the actual approval authority.');
  }
  const summary = saved => ({ status: saved.status, operationId: saved.operationId, contentSha256: saved.contentSha256, accountDid: config.accountDid, pdsUrl: pds.origin, rkey: saved.rkey, ...(saved.verified ? { ...saved.verified } : {}), ...(saved.lastWriteError ? { lastWriteError: saved.lastWriteError } : {}), preview: saved.input });
  async function reconcile(saved) {
    const uri = `at://${config.accountDid}/${collection}/${saved.rkey}`;
    let remote;
    try { remote = await request('com.atproto.repo.getRecord', { repo: config.accountDid, collection, rkey: saved.rkey }); }
    catch (error) {
      if (error.code !== 'RecordNotFound') throw error;
      return { ...summary(saved), status: saved.status === 'prepared' ? 'not_published' : 'unresolved', nextAction: saved.status === 'prepared' ? 'Obtain an exact grant before publishing.' : 'Record absent at readback. Do not create a new operation or resend; operator must resolve the uncertain attempt.' };
    }
    if (!saved.record || remote.uri !== uri || typeof remote.cid !== 'string' || !remote.cid || hash(remote.value) !== hash(saved.record)) stop('record_conflict', 'The stable record key has unexpected content. Do not overwrite or delete it.');
    saved.status = 'verified';
    saved.verified = { uri, cid: remote.cid, permalink: `https://bsky.app/profile/${config.accountDid}/post/${saved.rkey}`, verifiedAt: new Date().toISOString() };
    save(operationFile(saved.operationId), saved);
    return summary(saved);
  }
  return async function invoke(name, args = {}) {
    let locked = false;
    const lock = path.join(stateDir, '.lock');
    try {
      try { fs.mkdirSync(lock, { mode: 0o700 }); locked = true; } catch (error) { if (error.code === 'EEXIST') stop('busy', 'Another connector call owns the lock. If its process crashed, an operator must reconcile receipts before removing the stale lock.'); throw error; }
      if (name === 'bluesky_account_status') { z.object({}).strict().parse(args); await authenticate(); return { status: 'authenticated', accountDid: config.accountDid, pdsUrl: pds.origin, publishingEnabled: config.allowPublish === true }; }
      if (name === 'bluesky_prepare_post') {
        const input = prepareSchema.parse(args);
        const annotations = facets(input);
        for (const image of input.images) imageBytes(image);
        const contentSha256 = hash({ accountDid: config.accountDid, pdsUrl: pds.origin, input, facets: annotations });
        const file = operationFile(input.operationId);
        if (fs.existsSync(file)) { const saved = privateRead(file); if (saved.contentSha256 !== contentSha256) stop('operation_conflict', 'Operation IDs are immutable. Preserve the existing operation; changed approved content needs a new ID.'); return summary(saved); }
        const saved = { accountDid: config.accountDid, pdsUrl: pds.origin, operationId: input.operationId, contentSha256, input, facets: annotations, status: 'prepared', rkey: tid(stateDir), createdAt: new Date().toISOString() };
        save(file, saved);
        return summary(saved);
      }
      if (!['bluesky_publish_post', 'bluesky_reconcile_post'].includes(name)) stop('unknown_tool', 'Select a listed Bluesky tool.');
      const input = operationSchema.parse(args);
      if (!fs.existsSync(operationFile(input.operationId))) stop('operation_missing', 'Prepare the exact post before publishing or reconciling.');
      const saved = privateRead(operationFile(input.operationId));
      if (saved.accountDid !== config.accountDid || saved.pdsUrl !== pds.origin) stop('operation_account_changed', 'Restore the original pinned account/PDS configuration; this operation cannot move accounts.');
      if (hash({ accountDid: saved.accountDid, pdsUrl: saved.pdsUrl, input: saved.input, facets: saved.facets }) !== saved.contentSha256) stop('operation_corrupt', 'Operator must restore the immutable prepared operation; do not publish corrupted state.');
      if (saved.contentSha256 !== input.contentSha256) stop('content_hash_mismatch', 'Use the exact prepared content hash.');
      if (name === 'bluesky_reconcile_post' || saved.status !== 'prepared') return await reconcile(saved);
      approval(saved);
      const existing = await reconcile(saved);
      if (existing.status !== 'not_published') return existing;
      const images = saved.input.images.map(image => ({ ...imageBytes(image), alt: image.alt }));
      const token = await authenticate();
      const embeds = [];
      for (const image of images) {
        approval(saved);
        saved.status = 'upload_pending'; save(operationFile(saved.operationId), saved);
        const response = await request('com.atproto.repo.uploadBlob', {}, token, image.bytes, image.mime);
        const blob = response.blob;
        if (blob?.$type !== 'blob' || typeof blob.ref?.$link !== 'string' || blob.size !== image.bytes.length || blob.mimeType !== image.mime) stop('provider_contract_invalid', 'Image upload response does not match approved media. No post was submitted.');
        embeds.push({ alt: image.alt, image: blob });
      }
      saved.record = { $type: collection, text: saved.input.text, createdAt: saved.createdAt, ...(saved.facets.length ? { facets: saved.facets } : {}), ...(saved.input.langs.length ? { langs: saved.input.langs } : {}), ...(embeds.length ? { embed: { $type: 'app.bsky.embed.images', images: embeds } } : {}) };
      approval(saved);
      saved.status = 'write_pending'; save(operationFile(saved.operationId), saved);
      try { await request('com.atproto.repo.putRecord', { repo: config.accountDid, collection, rkey: saved.rkey, record: saved.record, validate: true, swapRecord: null }, token); }
      catch (error) { saved.lastWriteError = error.code ?? 'provider_unavailable'; save(operationFile(saved.operationId), saved); return await reconcile(saved); }
      return await reconcile(saved);
    } catch (error) {
      return { status: 'blocked', code: error instanceof z.ZodError ? 'invalid_arguments' : error.code ?? 'connector_unavailable', nextAction: error instanceof z.ZodError ? 'Use the exact documented tool schema and supported content limits.' : error.nextAction ?? 'Operator must inspect private configuration and durable operation state; do not blindly retry writes.' };
    } finally { if (locked) fs.rmdirSync(lock); }
  };
}
