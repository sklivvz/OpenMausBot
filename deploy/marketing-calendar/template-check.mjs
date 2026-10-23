import crypto from 'node:crypto';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const visible = value => value.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const markup = value => value.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
const placeholders = value => visible(value).match(/\[[^\]\n]{1,120}\]/g) ?? [];

export function checkTemplate(html, issueCopy, reference) {
  if (typeof html !== 'string' || typeof issueCopy !== 'string' || !html.trim() || !issueCopy.trim()) throw Error('Supply the actual template HTML and current issue copy.');
  if (Buffer.byteLength(html) > 2 * 1024 * 1024 || Buffer.byteLength(issueCopy) > 256 * 1024) throw Error('Template or issue exceeds the check limit.');
  if (reference !== undefined && (typeof reference !== 'string' || !reference.trim() || Buffer.byteLength(reference) > 2 * 1024 * 1024)) throw Error('Supply the bounded original designer template for comparison.');
  const source = markup(html);
  const openings = [...source.matchAll(/<keila-content\b[^>]*>/gi)];
  const slots = [...source.matchAll(/<keila-content\b[^>]*>([\s\S]*?)<\/keila-content\s*>/gi)];
  const problems = [];
  const dataDriven = /(?:\{\{\s*campaign\.data\.[\w.]+|\{%\s*for\s+\w+\s+in\s+campaign\.data\.[\w.]+)/.test(source);
  if ((!slots.length && !dataDriven) || openings.length !== slots.length) problems.push('Require named, paired keila-content slots or a campaign.data Liquid template. Retain the reusable design.');
  const names = openings.map(slot => slot[0].match(/^<keila-content\s+name\s*=\s*(?:"([^"\s>]+)"|'([^'\s>]+)'|([^\s>/]+))/i)?.slice(1).find(Boolean));
  if (names.some(name => !name) || new Set(names).size !== names.length) problems.push('Each content slot needs a unique name as its first attribute.');
  if (slots.some(slot => /<keila-content\b/i.test(slot[1]))) problems.push('Content slots must not be nested.');
  if (reference !== undefined) {
    const remaining = placeholders(html);
    for (const placeholder of placeholders(reference)) {
      const index = remaining.indexOf(placeholder);
      if (index < 0) problems.push(`Designer placeholder removed: ${placeholder}`);
      else remaining.splice(index, 1);
    }
    const referenceClasses = new Set([...markup(reference).matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)].flatMap(match => match[1].split(/\s+/)).filter(Boolean));
    const installedClasses = new Set([...source.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)].flatMap(match => match[1].split(/\s+/)).filter(Boolean));
    for (const name of referenceClasses) if (!installedClasses.has(name)) problems.push(`Designer layout class removed: ${name}`);
  }
  const body = visible(source);
  const paragraphs = issueCopy.split(/\n\s*\n/).map(visible).filter(text => text.length >= 80);
  if (!paragraphs.length) problems.push('Issue copy has no substantive paragraph to compare; copy separation is unverified.');
  const embedded = paragraphs.filter(text => body.includes(text));
  if (embedded.length) problems.push(`${embedded.length} issue paragraph(s) are embedded in the reusable template.`);
  if (!/\{\{\s*unsubscribe_link\s*\}\}/.test(source)) problems.push('Missing Keila unsubscribe_link variable.');
  if (/(?:src|href)\s*=\s*["'](?:\.\.?\/|file:|\/data\/)/i.test(source) || /url\(\s*["']?(?:\.\.?\/|file:|\/data\/)/i.test(html)) problems.push('Local or relative assets will not travel with the saved email template.');
  return { checked: 'reusable-keila-template', passed: problems.length === 0, templateSha256: digest(html), issueSha256: digest(issueCopy), referenceSha256: reference === undefined ? null : digest(reference), dataDriven, slots: names.filter(Boolean), placeholders: placeholders(html), problems,
    limits: 'Structural, known placeholder/layout-class retention and copy-separation checks only; not full design fidelity. Default content inside slots is valid. No provider writes, visual acceptance, deliverability check, or send authorization. Compare a fresh saved-provider readback with the intended template before accepting installation.' };
}

