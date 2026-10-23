#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const visible = value => value.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function checkTemplate(html, issueCopy) {
  if (typeof html !== 'string' || typeof issueCopy !== 'string' || !html.trim() || !issueCopy.trim()) throw Error('Supply the actual template HTML and current issue copy.');
  if (Buffer.byteLength(html) > 2 * 1024 * 1024 || Buffer.byteLength(issueCopy) > 256 * 1024) throw Error('Template or issue exceeds the check limit.');
  const source = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const openings = [...source.matchAll(/<keila-content\b[^>]*>/gi)];
  const slots = [...source.matchAll(/<keila-content\b[^>]*>([\s\S]*?)<\/keila-content\s*>/gi)];
  const problems = [];
  if (openings.length !== 1 || slots.length !== 1) problems.push('Require exactly one reusable keila-content slot.');
  if (slots.some(slot => visible(slot[1]))) problems.push('The reusable content slot must be empty. Put issue content in the campaign.');
  const body = visible(source);
  const paragraphs = issueCopy.split(/\n\s*\n/).map(visible).filter(text => text.length >= 80);
  if (!paragraphs.length) problems.push('Issue copy has no substantive paragraph to compare; copy separation is unverified.');
  const embedded = paragraphs.filter(text => body.includes(text));
  if (embedded.length) problems.push(`${embedded.length} issue paragraph(s) are embedded in the reusable template.`);
  if (!/\{\{\s*unsubscribe_link\s*\}\}/.test(source)) problems.push('Missing Keila unsubscribe_link variable.');
  if (/(?:src|href)\s*=\s*["'](?:\.\.?\/|file:|\/data\/)/i.test(source) || /url\(\s*["']?(?:\.\.?\/|file:|\/data\/)/i.test(html)) problems.push('Local or relative assets will not travel with the saved email template.');
  return { checked: 'reusable-keila-template', passed: problems.length === 0, templateSha256: digest(html), issueSha256: digest(issueCopy), problems,
    limits: 'Structural and copy-separation checks only. No provider writes, visual acceptance, deliverability check, or send authorization. Compare a fresh saved-provider readback with the intended template before accepting installation.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw Error('Usage: newsletter-template-preflight TEMPLATE_HTML ISSUE_COPY');
    for (const file of process.argv.slice(2)) if (!fs.statSync(file).isFile() || fs.statSync(file).size > 2 * 1024 * 1024) throw Error('Expected a bounded text file.');
    const result = checkTemplate(fs.readFileSync(process.argv[2], 'utf8'), fs.readFileSync(process.argv[3], 'utf8'));
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({ passed: false, error: error.message }) + '\n');
    process.exitCode = 2;
  }
}
