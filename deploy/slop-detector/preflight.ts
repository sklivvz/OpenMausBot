import crypto from 'node:crypto';
import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);
const operation = z.enum(['review', 'write_copy', 'design', 'assemble', 'publish']);
export const briefSchema = z.object({
  objective: text,
  audience: text,
  deliverable: text,
  kind: z.enum(['collateral', 'editorial', 'campaign']),
  owner: text,
  revision: text,
  sourceReferences: z.array(text).min(1).max(30),
  acceptanceCriteria: z.array(text).min(1).max(30),
  authorizedOperations: z.array(operation).min(1),
  holds: z.array(operation).default([]),
  assignment: z.object({ operation, owner: text, role: z.enum(['orchestrator', 'copy', 'design', 'production']), briefRevision: text }).strict(),
}).strict();

export function checkBrief(raw: unknown) {
  const parsed = briefSchema.safeParse(raw);
  if (!parsed.success) return { status: 'needs_information', issues: parsed.error.issues.map(i => ({ field: i.path.join('.'), reason: i.message })), authorizationVerified: false };
  const brief = parsed.data;
  const issues: { field: string; reason: string }[] = [];
  const expected = { review: 'orchestrator', write_copy: 'copy', design: 'design', assemble: 'production', publish: 'production' };
  if (brief.assignment.briefRevision !== brief.revision) issues.push({ field: 'assignment.briefRevision', reason: 'Assignment references a different brief revision.' });
  if (brief.assignment.operation !== 'review' && brief.assignment.role !== expected[brief.assignment.operation]) issues.push({ field: 'assignment.role', reason: `This operation belongs to the ${expected[brief.assignment.operation]} role.` });
  if (!brief.authorizedOperations.includes(brief.assignment.operation)) issues.push({ field: 'assignment.operation', reason: 'Operation is outside the supplied authority.' });
  if (brief.holds.includes(brief.assignment.operation)) issues.push({ field: 'holds', reason: 'The requested operation is held; other authorized preparation remains independent.' });
  return { status: issues.length ? 'needs_correction' : 'structurally_ready', briefSha256: hash(brief), issues, authorizationVerified: false,
    limitation: 'Checks supplied structure and consistency, not whether sources establish authority or the brief captures the business intent.' };
}

export const constraintsSchema = z.object({
  forbiddenPhrases: z.array(z.string().min(1).max(160)).max(30).default([]),
  maxCharacters: z.number().int().min(1).max(12000).optional(),
  preserveExactly: z.array(z.string().min(1).max(12000)).max(30).default([]),
  requiredUrls: z.array(z.url().max(2000)).max(30).default([]),
}).strict();
export type Finding = { category: string; severity: 'revise' | 'review'; action: string; passage?: { start: number; end: number; text: string; offsetUnit: 'UTF-16 code units' } };
export const hash = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export function deterministicChecks(draft: string, constraints: z.infer<typeof constraintsSchema>): Finding[] {
  const findings: Finding[] = [];
  const add = (category: string, action: string, start?: number, end?: number, severity: 'revise' | 'review' = 'revise') => findings.push({ category, severity, action,
    ...(start !== undefined && end !== undefined ? { passage: { start, end, text: draft.slice(start, end), offsetUnit: 'UTF-16 code units' as const } } : {}) });
  for (const phrase of constraints.forbiddenPhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const before = /^[\p{L}\p{N}_]/u.test(phrase) ? '(?<![\\p{L}\\p{N}_])' : '';
    const after = /[\p{L}\p{N}_]$/u.test(phrase) ? '(?![\\p{L}\\p{N}_])' : '';
    const matches = draft.matchAll(new RegExp(`${before}${escaped}${after}`, 'giu'));
    for (const match of matches) add('explicit_phrase_constraint', 'Resolve this explicitly prohibited phrase within the editing scope. Protected wording takes precedence; escalate a conflict.', match.index, match.index + match[0].length);
  }
  if (constraints.maxCharacters !== undefined && Array.from(draft).length > constraints.maxCharacters) add('character_limit', `The supplied limit is ${constraints.maxCharacters} Unicode code points. Shorten within scope; this is not a platform-specific weighted count.`);
  for (const protectedText of constraints.preserveExactly) if (!draft.includes(protectedText)) add('protected_text_changed', 'Restore the supplied protected wording or return the authority conflict. Do not invent a replacement.');
  for (const url of constraints.requiredUrls) {
    const urls = draft.match(/https?:\/\/[^\s<>"[\]]+/g) ?? [];
    if (!urls.some(found => found === url || found.replace(/[),.;!?]+$/, '') === url)) add('required_url_missing', `Preserve the required exact URL: ${url}`);
  }
  const lines = new Map<string, number>();
  for (const match of draft.matchAll(/[^\r\n]+/g)) {
    const normalized = match[0].trim().replace(/\s+/g, ' ');
    if (normalized.length < 50) continue;
    if (lines.has(normalized)) add('repeated_paragraph', 'Check whether this repeated paragraph is intentional. Do not delete approved or intentionally repeated text automatically.', match.index, match.index + match[0].length, 'review');
    lines.set(normalized, match.index);
  }
  return findings.length <= 60 ? findings : [...findings.slice(0, 59), { category: 'additional_matches', severity: 'review', action: `${findings.length - 59} additional matches omitted from this bounded response. Resolve the listed mechanical issues, then recheck the complete asset.` }];
}

export const briefToolDefinition = { name: 'check_marketing_brief', description: 'Check a supplied brief and assignment for required fields, role, revision, scope and operation-specific holds without a model call. Returns missing fields; does not establish approval or business suitability.', inputSchema: { ...z.toJSONSchema(briefSchema), required: [] }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
