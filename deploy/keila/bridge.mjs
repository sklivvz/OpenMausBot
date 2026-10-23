import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkTemplate } from '../marketing-calendar/template-check.mjs';

const MAX_BYTES = 3 * 1024 * 1024;
const resources = ['templates', 'campaigns', 'senders', 'segments'];
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const hashPattern = /^[a-f0-9]{64}$/;
export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fail = message => { throw new Error(message); };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).every(key => fields.includes(key));
const validId = value => typeof value === 'string' && idPattern.test(value);
const readJson = file => {
  if (fs.statSync(file).size > MAX_BYTES) fail('File exceeds size limit');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const syncDirectory = file => {
  const fd = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
const durableWrite = (file, value, exclusive = false) => {
  const fd = fs.openSync(file, exclusive ? 'wx' : 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(file);
};
const atomicReceipt = (file, value) => {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  durableWrite(temporary, value, true);
  fs.renameSync(temporary, file);
  syncDirectory(file);
};
const summary = item => ({ id: item.id, name: item.name, subject: item.subject, type: item.type ?? item.settings?.type, template_id: item.template_id, sent_at: item.sent_at, scheduled_for: item.scheduled_for, sha256: digest(item) });

export function createBridge(config, { fetchImpl = fetch } = {}) {
  if (!object(config) || !validId(config.projectId) || !Array.isArray(config.allowedRoots) || !config.allowedRoots.length || !Array.isArray(config.protectedIds)) fail('Invalid Keila configuration');
  const base = new URL(config.baseUrl ?? 'https://app.keila.io');
  const localFixture = base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname);
  if ((!localFixture && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || base.pathname !== '/') fail('Invalid Keila origin');
  const roots = config.allowedRoots.map(root => fs.realpathSync(root));
  const within = (file, existing = true) => {
    if (typeof file !== 'string' || !path.isAbsolute(file)) fail('Use an absolute artifact path');
    const resolved = existing ? fs.realpathSync(file) : path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
    if (!roots.some(root => resolved.startsWith(root + path.sep))) fail('Artifact outside configured workspace');
    return resolved;
  };
  const source = file => {
    const resolved = within(file);
    if (!fs.statSync(resolved).isFile() || fs.statSync(resolved).size > MAX_BYTES) fail('Invalid artifact file');
    return fs.readFileSync(resolved, 'utf8');
  };
  const resourcePath = (resource, id) => {
    if (!resources.includes(resource) || (id !== undefined && !validId(id))) fail('Invalid Keila resource');
    return `/api/v1/${resource}${id === undefined ? '' : `/${id}`}`;
  };
  const request = async (resource, id, method = 'GET', payload, page) => {
    const token = fs.readFileSync(config.apiKeyFile, 'utf8').trim();
    if (!token || /\s/.test(token)) fail('Keila API key is unavailable');
    const url = new URL(resourcePath(resource, id), base);
    if (page !== undefined) url.searchParams.set('page', String(page));
    let response;
    try {
      response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify({ data: payload }) } : {}) });
    } catch { fail('Keila request failed; consult the operation receipt before retrying a write'); }
    if (!response.ok) { await response.body?.cancel(); fail(`Keila HTTP ${response.status}`); }
    let raw = '';
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      raw += decoder.decode(chunk, { stream: true });
      if (Buffer.byteLength(raw) > MAX_BYTES) { fail('Keila response exceeds size limit'); }
    }
    raw += decoder.decode();
    try { return JSON.parse(raw); } catch { fail('Invalid Keila JSON response'); }
  };
  const get = async (resource, id) => {
    const value = (await request(resource, id)).data;
    if (!object(value) || value.id !== id) fail('Keila returned an unexpected resource');
    return value;
  };
  const writable = (resource, id, current) => {
    if (config.protectedIds.includes(id)) fail('Resource is protected by a hold');
    if (resource === 'campaigns' && (!Object.hasOwn(current, 'sent_at') || !Object.hasOwn(current, 'scheduled_for') || current.sent_at !== null || current.scheduled_for !== null)) fail('Campaign is not a verified unsent, unscheduled draft');
  };
  const listing = async resource => {
    const all = [], seen = new Set();
    for (let page = 0; page < 100; page++) {
      const result = await request(resource, undefined, 'GET', undefined, page);
      if (!Array.isArray(result.data)) fail('Invalid Keila list response');
      for (const value of result.data) {
        if (!validId(value.id) || seen.has(value.id)) fail('Keila pagination repeated a resource');
        seen.add(value.id); all.push(summary(value));
      }
      if (all.length > 1000) fail('Keila inventory exceeds bounded limit');
      if (!result.meta) return all;
      if (result.meta.page !== page || !Number.isInteger(result.meta.page_count) || result.meta.page_count < 0) fail('Invalid Keila pagination');
      if (page + 1 >= result.meta.page_count) return all;
    }
    fail('Keila pagination exceeds bounded limit');
  };
  const validatePayload = (resource, payload) => {
    if (resource === 'templates') {
      if (!exact(payload, ['type', 'name', 'html_body', 'styles', 'assigns']) || payload.type !== 'html' || typeof payload.name !== 'string' || !payload.name.trim() || typeof payload.html_body !== 'string' || (payload.styles !== undefined && typeof payload.styles !== 'string') || (payload.assigns !== undefined && !object(payload.assigns))) fail('Use a named HTML template payload');
    } else if (resource === 'campaigns') {
      if (!exact(payload, ['subject', 'preview_text', 'settings', 'sender_id', 'segment_id', 'template_id', 'html_content', 'data']) || typeof payload.subject !== 'string' || !payload.subject.trim() || !exact(payload.settings, ['type', 'do_not_track']) || payload.settings.type !== 'html' || (payload.settings.do_not_track !== undefined && typeof payload.settings.do_not_track !== 'boolean') || !validId(payload.template_id) || !validId(payload.sender_id) || (payload.segment_id !== undefined && !validId(payload.segment_id)) || (payload.preview_text !== undefined && typeof payload.preview_text !== 'string') || (payload.html_content !== undefined && (!object(payload.html_content) || !Object.values(payload.html_content).every(value => typeof value === 'string'))) || (payload.data !== undefined && !object(payload.data))) fail('Use a complete HTML draft payload with template and sender IDs');
    } else fail('Only template and campaign preparation is supported');
  };
  const prepareUnlocked = async manifestFile => {
    const manifest = JSON.parse(source(manifestFile));
    if (!exact(manifest, ['operation_id', 'resource', 'action', 'id', 'expected_sha256', 'payload_file', 'payload_sha256', 'authorization_ref', 'issue_copy_file', 'reference_html_file', 'template_sha256']) || !validId(manifest.operation_id) || !['create', 'update'].includes(manifest.action) || typeof manifest.authorization_ref !== 'string' || !manifest.authorization_ref.trim() || !hashPattern.test(manifest.payload_sha256 ?? '')) fail('Invalid preparation manifest');
    const bytes = source(manifest.payload_file);
    if (digest(bytes) !== manifest.payload_sha256) fail('Payload changed since the manifest was prepared');
    const payload = JSON.parse(bytes);
    validatePayload(manifest.resource, payload);
    if (manifest.action === 'update' && (!validId(manifest.id) || !hashPattern.test(manifest.expected_sha256 ?? ''))) fail('Updates require the exact ID and prior snapshot hash');
    if (manifest.action === 'create' && (manifest.id !== undefined || manifest.expected_sha256 !== undefined)) fail('Create cannot specify an existing resource');
    if (!config.allowWrites) fail('Keila draft writes are disabled in configuration');
    if (manifest.resource === 'templates') {
      const check = checkTemplate(payload.html_body, source(manifest.issue_copy_file), source(manifest.reference_html_file));
      if (!check.passed) fail(`Template preflight failed: ${check.problems.join('; ')}`);
    }
    fs.mkdirSync(config.receiptDir, { recursive: true, mode: 0o700 });
    const receiptFile = path.join(config.receiptDir, `${manifest.operation_id}.json`);
    const fingerprint = digest({ manifest, payload });
    const before = manifest.action === 'update' ? await get(manifest.resource, manifest.id) : null;
    if (before) writable(manifest.resource, manifest.id, before);
    if (fs.existsSync(receiptFile)) {
      const previous = readJson(receiptFile);
      if (previous.fingerprint !== fingerprint) fail('Operation ID already belongs to different content');
      if (!previous.id) fail('Write outcome is uncertain; reconcile the receipt, do not create another operation');
      const current = await get(manifest.resource, previous.id);
      if (!Object.entries(payload).every(([key, value]) => canonical(current[key]) === canonical(value))) fail('Prior operation readback differs; no automatic retry');
      return { id: current.id, operation_id: previous.operation_id, state: 'verified', sha256: digest(current), replayed: true, receipt_file: receiptFile };
    }
    if (before && digest(before) !== manifest.expected_sha256) fail('Resource changed since its snapshot');
    if (manifest.resource === 'campaigns') {
      if (!hashPattern.test(manifest.template_sha256 ?? '')) fail('Campaign requires an exact template snapshot hash');
      const template = await get('templates', payload.template_id);
      if (digest(template) !== manifest.template_sha256 || template.type !== 'html') fail('Template changed or is not HTML');
      const slots = template.html_content_slots;
      if (!Array.isArray(slots)) fail('Provider did not return template content slots');
      if (Object.keys(payload.html_content ?? {}).some(name => !slots.some(slot => slot.name === name))) fail('Campaign contains an unknown template slot');
    }
    const receipt = { operation_id: manifest.operation_id, fingerprint, resource: manifest.resource, action: manifest.action, authorization_ref: manifest.authorization_ref, payload_sha256: manifest.payload_sha256, id: manifest.id, before, state: 'write-started', started_at: new Date().toISOString() };
    try { durableWrite(receiptFile, receipt, true); } catch (error) { if (error.code === 'EEXIST') fail('Operation already executing; inspect its receipt'); throw error; }
    try {
      const response = await request(manifest.resource, manifest.id, manifest.action === 'create' ? 'POST' : 'PATCH', payload);
      const id = response.data?.id;
      if (!validId(id) || (manifest.id && id !== manifest.id)) fail('Write returned an unexpected resource ID');
      receipt.id = id; receipt.state = 'written'; atomicReceipt(receiptFile, receipt);
      const readback = await get(manifest.resource, id);
      if (manifest.resource === 'campaigns') writable(manifest.resource, id, readback);
      if (!Object.entries(payload).every(([key, value]) => canonical(readback[key]) === canonical(value))) fail('Saved content differs from the exact payload');
      receipt.state = 'verified'; receipt.sha256 = digest(readback); receipt.verified_at = new Date().toISOString(); atomicReceipt(receiptFile, receipt);
      return { state: receipt.state, id, sha256: receipt.sha256, operation_id: manifest.operation_id, receipt_file: receiptFile, url: new URL(`/projects/${config.projectId}/${manifest.resource}/${id}`, base).href };
    } catch (error) {
      receipt.state = 'needs-reconciliation'; atomicReceipt(receiptFile, receipt);
      throw error;
    }
  };
  const prepare = async file => {
    fs.mkdirSync(config.receiptDir, { recursive: true, mode: 0o700 });
    const lock = path.join(config.receiptDir, 'preparation.lock');
    try { durableWrite(lock, { pid: process.pid, started_at: new Date().toISOString() }, true); } catch (error) { if (error.code === 'EEXIST') fail('Operation lock is held; inspect active process and receipts before recovery'); throw error; }
    try { return await prepareUnlocked(file); } finally { fs.unlinkSync(lock); }
  };
  return async (name, args = {}) => {
    if (name === 'keila_inventory' && exact(args, ['resource'])) return { resource: args.resource, items: await listing(args.resource) };
    if (name === 'keila_snapshot' && exact(args, ['resource', 'id', 'output_file'])) {
      const item = await get(args.resource, args.id);
      const output = within(args.output_file, false);
      durableWrite(output, item, true);
      return { ...summary(item), output_file: output };
    }
    if (name === 'keila_prepare' && exact(args, ['manifest_file'])) return prepare(args.manifest_file);
    fail('Invalid Keila tool or arguments');
  };
}

export const toolDefinitions = [
  { name: 'keila_inventory', description: 'List compact Keila template/campaign/sender/segment metadata without browser work or HTML in context. Read-only.', inputSchema: { type: 'object', properties: { resource: { type: 'string', enum: resources } }, required: ['resource'], additionalProperties: false } },
  { name: 'keila_snapshot', description: 'Read a Keila resource into a new local JSON artifact; return its hash and small summary. Existing files are never overwritten.', inputSchema: { type: 'object', properties: { resource: { type: 'string', enum: resources }, id: { type: 'string' }, output_file: { type: 'string' } }, required: ['resource', 'id', 'output_file'], additionalProperties: false } },
  { name: 'keila_prepare', description: 'Install exact file-based HTML template or unsent campaign draft with preflight, prior-hash check, durable operation receipt and independent readback. No send, schedule, test email or delete capability. A repeated operation never repeats its write. Requires existing task authority; held resources are blocked.', inputSchema: { type: 'object', properties: { manifest_file: { type: 'string' } }, required: ['manifest_file'], additionalProperties: false } },
];
