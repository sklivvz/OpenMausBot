import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createQueueReader, queueToolDefinitions } from '../execution-queue/reader.ts';
import { validateHandoff, handoffToolDefinition } from '../agentic/handoff-validation.ts';
import { createAssignmentTracker, assignmentTrackingToolDefinition } from '../assignment-tracking/tracker.ts';
import { createEvidenceObserver, createExecutionRecorder, executionReceiptToolDefinition, receiptToolInput, resolveLocation } from '../execution-receipts/receipts.ts';
import { TASKS_CONFIG_FILE, TASKS_ORIGIN, configuredAuthorization, createTaskSnapshotReader } from '../positron-tasks/snapshot.ts';
import { configFailure, ExecutionFailure, invalidArguments, sourceFailure } from '../execution-receipts/errors.ts';

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

const overlaps = (left: string, right: string) => left === right || left.startsWith(right + path.sep) || right.startsWith(left + path.sep);

export function executionToolDefinitionsFor(allowedProjects: readonly string[]) {
  return executionToolDefinitions.map(definition => {
    if (definition.name !== executionReceiptToolDefinition.name) return definition;
    const inputSchema = structuredClone(executionReceiptToolDefinition.inputSchema) as { properties?: Record<string, Record<string, unknown>> };
    const properties = inputSchema.properties ?? {};
    inputSchema.properties = { ...properties, projectId: { ...properties.projectId, enum: [...allowedProjects] } };
    return { ...definition, inputSchema };
  });
}

function privateFile(file: string, maximum: number) {
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { throw new ExecutionFailure('invalid_config', 'Invalid private host credential file'); }
  if (!stat.isFile() || stat.size > maximum || (stat.mode & 0o077)) throw new ExecutionFailure('invalid_config', 'Invalid private host credential file');
  try { return fs.readFileSync(file); } catch { throw new ExecutionFailure('invalid_config', 'Invalid private host credential file'); }
}

function parseConfig(raw: unknown) {
  try { return executionConfigSchema.parse(raw); } catch (error) { throw configFailure(error); }
}

export function createExecutionTools(rawConfig: unknown, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  const config = parseConfig(rawConfig);
  const roots = config.artifactRoots.map(resolveLocation);
  const privatePaths = [config.evidenceDir, config.receiptDir, config.signingKeyFile, config.tasksConfigFile].map(resolveLocation);
  for (const privatePath of privatePaths) {
    if (roots.some(root => overlaps(root, privatePath))) throw new ExecutionFailure('invalid_config', 'Invalid host configuration: private storage must be outside artifact roots');
  }
  if (new Set([config.evidenceDir, config.receiptDir].map(resolveLocation)).size !== 2) throw new ExecutionFailure('invalid_config', 'Invalid host configuration: use separate evidence and receipt directories');
  const key = privateFile(config.signingKeyFile, 4096);
  if (key.byteLength < 32) throw new ExecutionFailure('invalid_config', 'Invalid host signing key length');
  const readJob = async (threadId: string): Promise<unknown> => {
    if (!/^[\w-]{1,200}$/.test(threadId)) throw new ExecutionFailure('invalid_request', 'Invalid assignment thread identity');
    let response: Response;
    try {
      response = await fetchImpl(new URL(`/api/threads/${threadId}/job?since=0&full=1`, config.appUrl), { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw sourceFailure(error);
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new ExecutionFailure('source_unavailable', `Assignment source returned HTTP ${response.status}`); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) throw new ExecutionFailure('source_unavailable', 'Assignment source exceeds bounded size');
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof ExecutionFailure) throw error;
      throw sourceFailure(error);
    } finally { await reader.cancel(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new ExecutionFailure('source_unavailable', 'Assignment source returned invalid JSON'); }
  };
  const readTasks = createTaskSnapshotReader({ origin: config.tasksOrigin, fetchImpl,
    authorization: () => configuredAuthorization({ configFile: config.tasksConfigFile, ...(config.tasksServer ? { server: config.tasksServer } : {}), origin: config.tasksOrigin }) });
  const queue = createQueueReader({ readTasks, fetchImpl, appUrl: config.appUrl, directory: config.evidenceDir });
  const tracker = createAssignmentTracker({ readJob });
  const recorder = createExecutionRecorder({ directory: config.receiptDir, signingKey: key, observe: createEvidenceObserver({ artifactRoots: roots, protectedPaths: privatePaths, readJob }) });
  return {
    tools: executionToolDefinitionsFor(config.allowedProjects),
    async call(name: string, input: unknown = {}) {
      try {
        if (queueToolDefinitions.some(tool => tool.name === name)) return queue(name, input);
        if (name === handoffToolDefinition.name) return validateHandoff(input);
        if (name === assignmentTrackingToolDefinition.name) return tracker(input);
        if (name === executionReceiptToolDefinition.name) {
          const parsed = receiptToolInput.parse(input);
          if (!config.allowedProjects.includes(parsed.projectId)) throw new ExecutionFailure('project_out_of_scope', 'Project is outside this execution host scope', { allowedProjects: config.allowedProjects });
          const result = await recorder.record(parsed);
          return { operationId: result.operationId, taskId: result.input.taskId, objectiveId: result.input.objectiveId, projectId: result.input.projectId, checkedAt: result.checkedAt, sourceComplete: result.sourceComplete, outcome: result.outcome, receiptSha256: result.receiptSha256, receiptFile: result.receiptFile, replayed: result.replayed, supportedStatuses: result.supportedStatuses, changedEvidence: result.changedEvidence, gaps: result.gaps,
            observations: result.observations.map(row => ({ id: row.ref.id, kind: row.ref.kind, state: row.state, sha256: row.sha256 })), businessOutcome: result.businessOutcome, acceptance: result.acceptance, association: result.association };
        }
        throw new ExecutionFailure('invalid_request', 'Invalid execution tool');
      } catch (error) {
        if (error instanceof z.ZodError) throw invalidArguments(error);
        throw error;
      }
    },
  };
}
