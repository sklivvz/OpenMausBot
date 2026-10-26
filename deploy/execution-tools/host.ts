import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createQueueReader, queueToolDefinitions } from '../execution-queue/reader.ts';
import { validateHandoff, handoffToolDefinition } from '../agentic/handoff-validation.ts';
import { createAssignmentTracker, assignmentTrackingToolDefinition } from '../assignment-tracking/tracker.ts';
import { createEvidenceObserver, createExecutionRecorder, executionReceiptToolDefinition, receiptInput } from '../execution-receipts/receipts.ts';
import { TASKS_CONFIG_FILE, TASKS_ORIGIN, configuredAuthorization, createTaskSnapshotReader } from '../positron-tasks/snapshot.ts';

const absolute = z.string().min(1).max(4096).refine(path.isAbsolute);
const project = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const plainUrl = (value: string) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash && !url.search && url.pathname === '/';
};
const configuredUrl = z.url().refine(value => {
  const url = new URL(value);
  return plainUrl(value) && (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
});
export const executionConfigSchema = z.object({
  appUrl: configuredUrl.default('http://127.0.0.1:8799'),
  tasksOrigin: z.url().refine(value => plainUrl(value) && ['http:', 'https:'].includes(new URL(value).protocol)).default(TASKS_ORIGIN),
  tasksConfigFile: absolute.default(TASKS_CONFIG_FILE), tasksServer: z.string().min(1).max(200).optional(),
  evidenceDir: absolute, receiptDir: absolute,
  signingKeyFile: absolute, artifactRoots: z.array(absolute).min(1).max(64),
  allowedProjects: z.array(project).min(1).max(64),
}).strict();
export const executionToolDefinitions = [...queueToolDefinitions, handoffToolDefinition, assignmentTrackingToolDefinition, executionReceiptToolDefinition];

function privateFile(file: string, maximum: number) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maximum || (stat.mode & 0o077)) throw Error('Invalid private host credential file');
  return fs.readFileSync(file);
}
function resolvedLocation(file: string): string {
  if (fs.existsSync(file)) return fs.realpathSync(file);
  return path.join(resolvedLocation(path.dirname(file)), path.basename(file));
}
export function createExecutionTools(rawConfig: unknown, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  const config = executionConfigSchema.parse(rawConfig);
  const roots = config.artifactRoots.map(root => fs.realpathSync(root));
  for (const privatePath of [config.evidenceDir, config.receiptDir, config.signingKeyFile, config.tasksConfigFile]) {
    const resolved = resolvedLocation(privatePath);
    if (roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) throw Error('Invalid host configuration: private storage must be outside artifact roots');
  }
  if (new Set([config.evidenceDir, config.receiptDir].map(resolvedLocation)).size !== 2) throw Error('Invalid host configuration: use separate evidence and receipt directories');
  const key = privateFile(config.signingKeyFile, 4096);
  if (key.byteLength < 32) throw Error('Invalid host signing key length');
  const readJob = async (threadId: string): Promise<unknown> => {
    if (!/^[\w-]{1,200}$/.test(threadId)) throw Error('Invalid assignment thread identity');
    const response = await fetchImpl(new URL(`/api/threads/${threadId}/job?since=0&full=1`, config.appUrl), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('Assignment source unavailable'); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4 * 1024 * 1024) throw Error('Assignment source exceeds bounded size'); chunks.push(value); } }
    finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const readTasks = createTaskSnapshotReader({ origin: config.tasksOrigin, fetchImpl,
    authorization: () => configuredAuthorization({ configFile: config.tasksConfigFile, ...(config.tasksServer ? { server: config.tasksServer } : {}), origin: config.tasksOrigin }) });
  const queue = createQueueReader({ readTasks, fetchImpl, appUrl: config.appUrl, directory: config.evidenceDir });
  const tracker = createAssignmentTracker({ readJob });
  const recorder = createExecutionRecorder({ directory: config.receiptDir, signingKey: key, observe: createEvidenceObserver({ artifactRoots: roots, readJob }) });
  return {
    tools: executionToolDefinitions,
    async call(name: string, input: unknown = {}) {
      if (queueToolDefinitions.some(tool => tool.name === name)) return queue(name, input);
      if (name === handoffToolDefinition.name) return validateHandoff(input);
      if (name === assignmentTrackingToolDefinition.name) return tracker(input);
      if (name === executionReceiptToolDefinition.name) {
        const parsed = receiptInput.parse(input);
        if (!parsed.projectId || !config.allowedProjects.includes(parsed.projectId)) throw Error('Project is outside this execution host scope');
        const result = await recorder.record(parsed);
        return { operationId: result.operationId, taskId: result.input.taskId, objectiveId: result.input.objectiveId, projectId: result.input.projectId, checkedAt: result.checkedAt, sourceComplete: result.sourceComplete, outcome: result.outcome, receiptSha256: result.receiptSha256, receiptFile: result.receiptFile, replayed: result.replayed, supportedStatuses: result.supportedStatuses, changedEvidence: result.changedEvidence, gaps: result.gaps,
          observations: result.observations.map(row => ({ id: row.ref.id, kind: row.ref.kind, state: row.state, sha256: row.sha256 })), businessOutcome: result.businessOutcome, acceptance: result.acceptance, association: result.association };
      }
      throw Error('Invalid execution tool');
    },
  };
}
