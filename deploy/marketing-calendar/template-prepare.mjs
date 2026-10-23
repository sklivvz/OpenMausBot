#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkTemplate } from './template-check.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

export async function prepareTemplate({ source, issueCopy, plan, readAsset, fetchAsset }) {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 2 * 1024 * 1024) throw Error('Expected bounded original HTML.');
  if (!plan || !Array.isArray(plan.slots) || !plan.slots.length || plan.slots.length > 32 || !Array.isArray(plan.assets) || plan.assets.length > 32) throw Error('Plan requires 1..32 slots and up to 32 asset mappings.');
  if (/<keila-content\b/i.test(source)) throw Error('Source already has content slots; use it directly or correct its original adaptation plan.');
  const names = new Set();
  const edits = plan.slots.map(slot => {
    if (!slot || !/^[a-z][a-z0-9_-]{0,63}$/.test(slot.name) || names.has(slot.name) || typeof slot.content !== 'string' || !slot.content) throw Error('Each slot needs a unique name and exact nonempty source content.');
    names.add(slot.name);
    const start = source.indexOf(slot.content);
    if (start < 0 || source.indexOf(slot.content, start + 1) >= 0) throw Error(`Slot ${slot.name} must match exactly one source region.`);
    return { start, end: start + slot.content.length, name: slot.name, content: slot.content };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end) throw Error('Slot regions overlap.');
  const htmlParts = [];
  let at = 0;
  for (const edit of edits) {
    htmlParts.push(source.slice(at, edit.start), `<keila-content name="${edit.name}">`, edit.content, '</keila-content>');
    at = edit.end;
  }
  htmlParts.push(source.slice(at));
  let html = htmlParts.join('');
  const assets = [];
  const seen = new Set();
  for (const asset of plan.assets) {
    if (!asset || typeof asset.from !== 'string' || !/^\.\.?\/[^\s"'<>]+$/.test(asset.from) || seen.has(asset.from)) throw Error('Each asset mapping needs a unique relative source URL.');
    seen.add(asset.from);
    let url;
    try { url = new URL(asset.to); } catch { throw Error('Asset destination must be an HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || /["'<>\s]/.test(asset.to)) throw Error('Asset destination must be an HTTPS URL without credentials.');
    const occurrences = html.split(asset.from).length - 1;
    if (!occurrences) throw Error('Asset mapping is absent from the designer source.');
    const original = await readAsset(asset.from);
    const hosted = await fetchAsset(asset.to);
    if (!original.length || original.length > 10 * 1024 * 1024 || hosted.length > 10 * 1024 * 1024 || digest(original) !== digest(hosted)) throw Error(`Hosted asset does not match designer bytes: ${asset.from}`);
    html = html.split(asset.from).join(asset.to);
    assets.push({ from: asset.from, to: asset.to, sha256: digest(original), occurrences });
  }
  const check = checkTemplate(html, issueCopy, source);
  if (!check.passed) throw Error(JSON.stringify({ problems: check.problems }));
  const outsideSlots = html.replace(/<keila-content\s+name="[^"]+">[\s\S]*?<\/keila-content>/g, '');
  if (/\[[^\]\n]{1,120}\]/.test(outsideSlots.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ''))) throw Error('A visible designer placeholder is outside the editable slots.');
  return { html, receipt: { sourceSha256: digest(source), templateSha256: digest(html), slots: edits.map(e => e.name), assets, check,
    limits: 'Only wraps exact source regions and replaces byte-verified asset URLs. No provider installation, email-client compatibility, visual acceptance or send authorization.' } };
}

async function fetchAsset(url) {
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!r.ok || Number(r.headers.get('content-length')) > 10 * 1024 * 1024 || !r.body) throw Error('Hosted asset could not be verified.');
  const chunks = [];
  let size = 0;
  for await (const chunk of r.body) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw Error('Hosted asset exceeds the limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function run(argv) {
  if (argv.length !== 4) throw Error('Usage: newsletter-template-prepare DESIGNER_HTML PLAN_JSON ISSUE_COPY OUTPUT_HTML');
  const [sourcePath, planPath, copyPath, outputPath] = argv.map(file => path.resolve(file));
  if ([sourcePath, planPath, copyPath].includes(outputPath) || fs.existsSync(outputPath)) throw Error('Output must be a new file, never an original or existing artifact.');
  const read = (file, limit) => { if (!fs.statSync(file).isFile() || fs.statSync(file).size > limit) throw Error('Expected a bounded source file.'); return fs.readFileSync(file, 'utf8'); };
  const result = await prepareTemplate({ source: read(sourcePath, 2 * 1024 * 1024), issueCopy: read(copyPath, 256 * 1024), plan: JSON.parse(read(planPath, 2 * 1024 * 1024)), fetchAsset,
    readAsset: async relative => {
      const file = path.resolve(path.dirname(sourcePath), relative);
      if (!fs.statSync(file).isFile() || fs.statSync(file).size > 10 * 1024 * 1024) throw Error('Expected a bounded original asset file.');
      return fs.readFileSync(file);
    },
  });
  fs.writeFileSync(outputPath, result.html, { flag: 'wx', mode: 0o600 });
  return { ...result.receipt, outputPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(await run(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write(JSON.stringify({ passed: false, error: error.message }) + '\n'); process.exitCode = 1; }
}
