import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createQueueReader, queueToolDefinitions } from '../execution-queue/reader.ts';
import { validateHandoff, handoffToolDefinition } from '../agentic/handoff-validation.ts';
import { createAssignmentTracker, assignmentTrackingToolDefinition } from '../assignment-tracking/tracker.ts';
import { createEvidenceObserver, createExecutionRecorder, executionReceiptToolDefinition, receiptInput } from '../execution-receipts/receipts.ts';
import { createTodoistProgress, progressToolDefinitions } from '../todoist-progress/progress.ts';
import { createProgressRpc } from '../todoist-progress/transport.mjs';

const absolute = z.string().min(1).max(4096).refine(path.isAbsolute);
const project = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const configuredUrl = z.url().refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash && !url.search && (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
});
export const executionConfigSchema = z.object({
  appUrl: configuredUrl.default('http://127.0.0.1:8799').refine(value => new URL(value).pathname === '/'),
  queueUrl: configuredUrl.default('http://127.0.0.1:8798/review'),
  evidenceDir: absolute, receiptDir: absolute, progressReceiptDir: absolute,
  signingKeyFile: absolute, artifactRoots: z.array(absolute).min(1).max(64),
  allowedProjects: z.array(project).min(1).max(64), brokerOrigin: configuredUrl.optional(), brokerTokenFile: absolute.optional(),
}).strict();
export const executionToolDefinitions = [...queueToolDefinitions, handoffToolDefinition, assignmentTrackingToolDefinition, executionReceiptToolDefinition, ...progressToolDefinitions];

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
  for (const privatePath of [config.evidenceDir, config.receiptDir, config.progressReceiptDir, config.signingKeyFile, ...(config.brokerTokenFile ? [config.brokerTokenFile] : [])]) {
    const resolved = resolvedLocation(privatePath);
    if (roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) throw Error('Invalid host configuration: private storage must be outside artifact roots');
  }
  if (new Set([config.evidenceDir, config.receiptDir, config.progressReceiptDir].map(resolvedLocation)).size !== 3) throw Error('Invalid host configuration: use separate evidence and receipt directories');
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
  const queue = createQueueReader({ fetchImpl, appUrl: config.appUrl, queueUrl: config.queueUrl, directory: config.evidenceDir });
  const tracker = createAssignmentTracker({ readJob });
  const recorder = createExecutionRecorder({ directory: config.receiptDir, signingKey: key, observe: createEvidenceObserver({ artifactRoots: roots, readJob }) });
  let progress: ReturnType<typeof createTodoistProgress> | undefined;
  const progressTool = () => {
    if (progress) return progress;
    if (!config.brokerOrigin || !config.brokerTokenFile) throw Error('Progress connector is not configured');
    const token = privateFile(config.brokerTokenFile, 16384).toString('utf8').trim();
    if (!token || /\s/.test(token)) throw Error('Invalid private progress credential');
    progress = createTodoistProgress({ receiptDir: config.progressReceiptDir, allowedProjects: config.allowedProjects, verifyEvidence: recorder.verifyEvidence, rpc: createProgressRpc({ origin: config.brokerOrigin, token, fetchImpl }) });
    return progress;
  };
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
      if (progressToolDefinitions.some(tool => tool.name === name)) return progressTool().call(name, input);
      throw Error('Invalid execution tool');
    },
  };
}
