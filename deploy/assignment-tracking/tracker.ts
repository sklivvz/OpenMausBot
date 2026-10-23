import crypto from 'node:crypto';
import { z } from 'zod';

const id = z.string().min(1).max(200).regex(/^[\w-]+$/);
const statuses = ['queued', 'running', 'needs_input', 'waiting', 'resume', 'completed', 'failed', 'cancelled'] as const;
const nodeSchema = z.object({
  id, rootId: id, parentId: id.optional(), botId: id, threadId: id,
  status: z.enum(statuses), outcome: z.string().max(100).optional(),
  result: z.string().max(12000).optional(), question: z.string().max(12000).optional(),
  outcomeDetail: z.string().max(12000).optional(), executions: z.number().int().nonnegative(),
  finishedAt: z.number().nonnegative().optional(),
}).passthrough();
const jobSchema = z.object({
  threadId: id, version: z.string().min(1).max(200), scope: z.literal('job'), since: z.literal(0),
  now: z.number().nonnegative(), roots: z.array(id).max(500), nodes: z.array(nodeSchema).max(500),
  hidden: z.number().int().nonnegative(),
  counts: z.object({ queued: z.number().int().nonnegative(), running: z.number().int().nonnegative(), waiting: z.number().int().nonnegative(), needsInput: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative() }).strict(),
}).passthrough();
export const trackingInputSchema = z.object({
  threadId: id, rootId: id,
  assignmentIds: z.array(id).min(1).max(50).refine(ids => new Set(ids).size === ids.length, 'Use each assignment ID once'),
  expectedVersion: z.string().min(1).max(200).optional(),
}).strict();
const hash = (value: unknown) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export function assignmentSnapshotHash(raw: unknown) {
  const parsed = jobSchema.parse(raw);
  const { now: _now, ...stable } = parsed;
  return hash(canonical(stable));
}

export function reconcileAssignments(raw: unknown, request: unknown) {
  const input = trackingInputSchema.parse(request);
  const base = { toolVersion: '1.0.0', threadId: input.threadId, rootId: input.rootId,
    dispatch: 'none', redispatchAuthorized: false, deliverableAcceptance: 'unverified', businessOutcome: 'unverified', holds: 'not_assessed',
    limitation: 'Runtime execution evidence only. A completed turn or returned text is not accepted work. No matching ID does not authorize replacement work. Read current task decisions before any action.' };
  const parsed = jobSchema.safeParse(raw);
  if (!parsed.success) return { ...base, status: 'source_failed', sourceComplete: false, issues: ['invalid_job_snapshot'], assignments: [] };
  const job = parsed.data;
  const issues: string[] = [];
  if (job.threadId !== input.threadId) issues.push('wrong_conversation');
  if (job.hidden || Object.values(job.counts).reduce((a, b) => a + b, 0) !== job.nodes.length) issues.push('hidden_or_truncated_assignments');
  if (new Set(job.nodes.map(node => node.id)).size !== job.nodes.length) issues.push('duplicate_assignment_identity');
  const byId = new Map(job.nodes.map(node => [node.id, node]));
  const root = byId.get(input.rootId);
  if (!root || !job.roots.includes(input.rootId)) issues.push('root_not_in_scope');
  if (input.expectedVersion && input.expectedVersion !== job.version) issues.push('source_version_changed');
  if (issues.length) return { ...base, status: 'needs_reconciliation', sourceComplete: false, sourceVersion: job.version, sourceSha256: assignmentSnapshotHash(job), issues, assignments: [] };
  const assignments = input.assignmentIds.map(assignmentId => {
    const node = byId.get(assignmentId);
    if (!node || node.rootId !== input.rootId) return { assignmentId, action: 'resolve_identity', executionState: 'unknown', issue: !node ? 'missing_assignment' : 'different_root', redispatchAuthorized: false };
    const lineage = [node];
    let current = node;
    while (current.id !== input.rootId) {
      const parent = current.parentId ? byId.get(current.parentId) : undefined;
      if (!parent || parent.rootId !== input.rootId || lineage.some(item => item.id === parent.id)) return { assignmentId, action: 'resolve_identity', executionState: node.status, issue: 'invalid_parent_lineage', redispatchAuthorized: false };
      lineage.push(parent); current = parent;
    }
    const stoppedLineage = lineage.some(item => item.status === 'cancelled' || item.outcome === 'stopped');
    const action = stoppedLineage ? 'preserve_stop'
      : node.status === 'needs_input' ? 'resolve_dependency'
      : node.status === 'failed' ? 'resolve_failure'
      : node.status === 'completed' ? 'review_result' : 'reuse_and_wait';
    return { assignmentId, botId: node.botId, threadId: node.threadId, executionState: node.status, outcome: node.outcome ?? null,
      action, executions: node.executions, activeUnderStoppedLineage: stoppedLineage && !['completed', 'failed', 'cancelled'].includes(node.status),
      result: node.result ? { preview: node.result.slice(0, 240), sha256: hash(node.result), characters: node.result.length, truncated: node.result.length > 240, kind: 'assignee_claim', readVia: { tool: 'assignment_status', id: assignmentId } } : null,
      dependency: node.question ? { preview: node.question.slice(0, 240), sha256: hash(node.question), truncated: node.question.length > 240 } : null,
      outcomeDetail: node.outcomeDetail?.slice(0, 240) ?? null, finishedAt: node.finishedAt ?? null,
      deliverableAcceptance: 'unverified', redispatchAuthorized: false };
  });
  return { ...base, status: assignments.some(item => item.action === 'resolve_identity') ? 'needs_reconciliation' : 'tracked', sourceComplete: true, sourceVersion: job.version, sourceSha256: assignmentSnapshotHash(job), sourceObservedAt: job.now, assignments };
}

export function createAssignmentTracker({ readJob }: { readJob: (threadId: string) => Promise<unknown> }) {
  return async (raw: unknown) => {
    const input = trackingInputSchema.parse(raw);
    try {
      const first = await readJob(input.threadId);
      const result = reconcileAssignments(first, input);
      if (!result.sourceComplete) return result;
      const second = await readJob(input.threadId);
      if (assignmentSnapshotHash(first) !== assignmentSnapshotHash(second)) return { ...result, status: 'source_changed', sourceComplete: false, assignments: [], issues: ['assignment_changed_during_read'] };
      return result;
    } catch {
      return { status: 'source_failed', sourceComplete: false, threadId: input.threadId, rootId: input.rootId, assignments: [], dispatch: 'none', redispatchAuthorized: false, deliverableAcceptance: 'unverified', businessOutcome: 'unverified' };
    }
  };
}

export const assignmentTrackingToolDefinition = {
  name: 'track_existing_assignments',
  description: 'Read existing runtime assignments by exact IDs and root. Return compact reuse/wait, result-review, blocker or stop guidance. No dispatch, retries, interruptions or acceptance inference. Uses the native job snapshot, not a parallel task ledger.',
  inputSchema: z.toJSONSchema(trackingInputSchema),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
