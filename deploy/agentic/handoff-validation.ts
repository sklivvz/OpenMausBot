import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import type { CoordinateBotsCall } from '../../server/coordinator.ts';
import { parseThreadRefUrl } from '../../src/lib/thread-refs.ts';

const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const text = z.string().trim().min(1).max(2000);
const operation = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export function validHandoffReference(value: string): boolean {
  if (!value || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  if (path.posix.isAbsolute(value)) return path.posix.normalize(value) === value;
  if (/\s/.test(value)) return false;
  if (/^record:[a-z][a-z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:' || url.protocol === 'http:') return Boolean(url.hostname);
    return Boolean(parseThreadRefUrl(value));
  } catch { return false; }
}

const reference = z.string().min(1).max(2000).refine(validHandoffReference, 'Use an absolute HTTP(S) URL, supported thread link, normalized absolute file path or record:system/id.');
const sourcedStatement = z.object({ statement: text, reference }).strict();
export const handoffInputSchema = z.object({
  task: z.object({ id: identifier, objectiveId: identifier, reference, revision: identifier }).strict(),
  assignment: z.object({ botId: identifier, objectiveId: identifier, briefRevision: identifier, contribution: text, operations: z.array(operation).min(1).max(20) }).strict(),
  artifactMode: z.enum(['existing', 'new']),
  artifacts: z.array(z.object({ id: identifier, reference, version: identifier, currentVersion: identifier.optional() }).strict()).max(20),
  facts: z.array(sourcedStatement).max(20),
  decisions: z.array(sourcedStatement).max(20),
  acceptanceCriteria: z.array(z.object({ criterion: text, evidenceRequired: text }).strict()).min(1).max(20),
  scope: z.object({ permittedOperations: z.array(operation).max(20), heldOperations: z.array(operation).max(20), decisionReferences: z.array(reference).min(1).max(20) }).strict(),
}).strict();

type Issue = { field: string; kind: 'missing' | 'invalid' | 'inconsistent'; reason: string };
const fingerprint = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateHandoff(raw: unknown) {
  const base = { validatorVersion: '1.0.0', dispatch: 'not_performed', authorizationVerified: false, businessSuitability: 'not_assessed',
    limitation: 'Validates supplied structure and consistency. Does not retrieve sources, verify task ownership or authorization, establish factual truth, or determine whether acceptance criteria achieve the business objective.' };
  const parsed = handoffInputSchema.safeParse(raw);
  if (!parsed.success) return { ...base, status: 'needs_information', issues: parsed.error.issues.map(issue => ({ field: issue.path.join('.'), kind: issue.code === 'invalid_type' && issue.message.includes('undefined') ? 'missing' : 'invalid', reason: issue.message })), nativeCall: null };
  const packet = parsed.data;
  const issues: Issue[] = [];
  const add = (field: string, reason: string) => issues.push({ field, kind: 'inconsistent', reason });
  if (packet.assignment.objectiveId !== packet.task.objectiveId) add('assignment.objectiveId', 'Contribution belongs to a different business objective.');
  if (packet.assignment.briefRevision !== packet.task.revision) add('assignment.briefRevision', 'Contribution references a different task brief revision.');
  if (packet.artifactMode === 'existing' && !packet.artifacts.length) issues.push({ field: 'artifacts', kind: 'missing', reason: 'Existing-artifact work requires its canonical source and version.' });
  for (const [index, artifact] of packet.artifacts.entries()) {
    if (artifact.currentVersion !== undefined && artifact.version !== artifact.currentVersion) add(`artifacts.${index}.version`, 'Requested source version differs from the supplied current version.');
    if (packet.artifacts.findIndex(value => value.id === artifact.id) !== index) add(`artifacts.${index}.id`, 'Artifact identity is repeated; retain one canonical source version.');
  }
  for (const [index, name] of packet.assignment.operations.entries()) {
    if (!packet.scope.permittedOperations.includes(name)) add(`assignment.operations.${index}`, 'Operation is outside the supplied permitted scope.');
    if (packet.scope.heldOperations.includes(name)) add(`assignment.operations.${index}`, 'This operation is explicitly held; independent permitted operations remain separate.');
  }
  const sourceCurrency = packet.artifacts.length && packet.artifacts.some(artifact => artifact.currentVersion === undefined) ? 'unknown' : packet.artifacts.length ? 'compared_supplied_versions' : 'no_existing_artifact';
  const checks = { sourceCurrency, sourceAccess: 'not_checked', factsAndDecisions: 'references_supplied_not_verified', authority: 'supplied_scope_only' };
  const doneWhen = packet.acceptanceCriteria.map((item, index) => `${index + 1}. ${item.criterion} Evidence required: ${item.evidenceRequired}`).join('\n');
  const sections = [
    `Task: ${packet.task.id}; objective: ${packet.task.objectiveId}; brief revision: ${packet.task.revision}\nSource: ${packet.task.reference}`,
    `Assigned contribution: ${packet.assignment.contribution}\nRecipient: ${packet.assignment.botId}\nOperations: ${[...new Set(packet.assignment.operations)].join(', ')}`,
    `Canonical artifacts (${packet.artifactMode}):\n${packet.artifacts.length ? packet.artifacts.map(artifact => `${artifact.id} @ ${artifact.version}: ${artifact.reference}`).join('\n') : 'New output; no existing artifact is being edited.'}`,
    `Current facts:\n${packet.facts.length ? packet.facts.map(item => `${item.statement}\nSource: ${item.reference}`).join('\n') : 'No facts supplied; resolve factual gaps from sources rather than inventing them.'}`,
    `Current decisions:\n${packet.decisions.length ? packet.decisions.map(item => `${item.statement}\nSource: ${item.reference}`).join('\n') : 'No task decisions supplied; existing authority must still be established from its source.'}`,
    `Scope sources: ${packet.scope.decisionReferences.join(', ')}\nHeld operations: ${packet.scope.heldOperations.join(', ') || 'None supplied; this is not a finding that no holds exist.'}`,
    `Acceptance criteria:\n${doneWhen}`,
    'This packet does not grant additional authority. Source access, truth and business suitability remain unverified. Preserve current scoped holds; return evidence through the existing assignment.',
  ];
  const message = sections.join('\n\n');
  if (message.length > 4000) issues.push({ field: 'packet', kind: 'invalid', reason: 'Rendered handoff exceeds the native 4,000-character message limit. Shorten supplied context without losing criteria or source references; nothing was truncated.' });
  if (doneWhen.length > 1000) issues.push({ field: 'acceptanceCriteria', kind: 'invalid', reason: 'Rendered acceptance criteria exceed the native 1,000-character done_when limit. Nothing was truncated.' });
  const nativeCall: CoordinateBotsCall | null = issues.length ? null : { botIds: [packet.assignment.botId], message, doneWhen, rework: false, thread: 'new', reply: 'resume', consult: false };
  return { ...base, status: issues.length ? 'needs_correction' : 'structurally_ready', packetSha256: fingerprint({ version: base.validatorVersion, packet }), checks, issues, nativeCall };
}

export const handoffToolDefinition = {
  name: 'validate_handoff',
  description: 'Validate and render one bounded specialist handoff into the existing coordinate_bots call fields. Checks task/objective identity, brief/source versions, sourced facts/decisions, acceptance evidence and operation-scoped holds. Does not dispatch, fetch sources, approve work or change tasks.',
  inputSchema: { ...z.toJSONSchema(handoffInputSchema), required: [] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
