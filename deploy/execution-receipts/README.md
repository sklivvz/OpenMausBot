# Execution evidence receipts

This module implements the mechanical evidence part of `execute-next-step`.
It observes artifacts or native assignment state and writes immutable operation
receipts. It makes no model calls and does not mutate tasks, source artifacts,
assignments, approvals or business outcomes. It is not a second task database.
The only checkpoint is the last successfully observed source snapshot used to
compare later observations; it has no authority over execution.

## Host integration

The module exports `createEvidenceObserver`, `createExecutionRecorder`,
`receiptInput` and `executionReceiptToolDefinition` (`record_execution_receipt`).
The root integration owns MCP registration and invocation from operation hooks.
Tool exposure alone does not guarantee that every operation is observed; existing
independent observation must continue when bots omit this call.

```ts
const observe = createEvidenceObserver({
  artifactRoots: configuredTaskWorkspaceRoots,
  readJob: threadId => appRead(`/api/threads/${threadId}/job?since=0&full=1`),
});
const recorder = createExecutionRecorder({
  directory: configuredPrivateReceiptDirectory,
  signingKey: hostOwnedSigningKeyBytes,
  observe,
});
```

Use a persistent random signing key of at least 32 bytes, supplied by trusted
host configuration, never MCP arguments. Store it privately outside agent
artifact roots. Reuse it across processes/restarts; replacing it intentionally
invalidates old receipt authentication. HMAC signatures authenticate receipts and
observation checkpoints, while SHA-256 identifies evidence. This is not a security
boundary against an actor that can read the signing key or replace the host code.
Do not give untrusted agents key/storage administration access.

Inputs contain `operationId`, `botId`, `taskId`, `objectiveId`, required public
`projectId`, `sourceVersion`, `nextStep`, and up to eight evidence selectors.
Artifact selectors are `{kind:'artifact', id, path}`. Assignment selectors are
`{kind:'assignment', id, threadId, rootId}`. Project ID is the Positron Tasks
department ID; the public schema requires it and `verifyEvidence` requires it to
match the target project. Older stored receipts that omit `projectId` remain
readable for replay and authentication.
Selectors/association and brief version are caller-supplied context, not semantic
proof that an artifact satisfies that objective. No caller-provided success flag,
result, outcome, timestamp or approval is accepted.

The concrete observer reads exact file bytes only beneath configured roots, up
to 3 MiB, and rejects symlink escapes. Native job state is read twice and compared
in full excluding its clock. It requires complete counts, unique assignment
identities, a declared visible root and complete ancestry whose root IDs agree. Queued, running, waiting and
resume are retained as native execution states; canceled/stopped statuses and
explicit stopped outcomes anywhere in that ancestry prevent active-delegation
claims. Returned result text is hashed as a claim,
not accepted as a delivered or approved artifact.

## Outcomes and update evidence

- First artifact presence or absence is a baseline: `unverified`.
- Changed artifact bytes since a prior host observation: `progressed`.
- Actual active/queued assignment: `delegated_active` (not delivery).
- Missing, changing or partial source: `source_failed`.
- Returned text, stopped work, empty evidence of progress: `unverified`.

Only `progressed` and `delegated_active` currently support an `in_progress` task update.
Waiting for a person, external dependencies, business holds and no-actionable
judgments require evidence paths not implemented here. They remain unsupported;
the module does not invent them from bot prose or a prepared review packet.
Business outcome and acceptance always remain unverified. File changes prove
mechanical activity, not relevance, quality or business achievement.

`recorder.verifyEvidence(ids, {taskId, projectId, status})` authenticates stored receipts, checks target
identity/status, and rereads every referenced source. Changed bytes or assignment
state invalidate evidence for that update. It returns receipt identity, hash,
file reference and supported statuses. Source evidence precedes the task update,
whose separate readback follows it.

## Persistence and failure handling

Receipts use exclusive operation IDs; the same ID/input returns its immutable
receipt without another observation. Different input cannot reuse that ID.
Files and directories are fsynced. A per-task exclusive lock serializes captures;
lock contents identify the process/operation. A crashed process can leave a lock.
Reconcile the process and receipts before removing it; locks never expire into
an overlapping writer automatically.

Partial source failure leaves the previous successful observation checkpoint
unchanged. Its gap names a bounded code and safe message, such as
`artifact:proposal: artifact_path_rejected: Artifact outside configured roots`;
raw host configuration and credentials are never included. An authenticated
pending-observation journal is persisted before the receipt.
After a crash, the next capture reconciles a saved receipt into the checkpoint
before accepting another operation ID. A pending marker without a receipt has
no source mutation to replay; it is cleared. Corrupt or incomplete records stop
recovery instead of inventing success. Reusing the original ID never repeats a
business action (this module has no such action).

## Verification

Run `node --experimental-strip-types --test deploy/execution-receipts/receipts.test.ts`.
Eighteen isolated tests use temporary files and injected native job sources. They
cover baseline/change observation, source-failure checkpoint preservation,
missing and protected artifact roots, typed source gaps, immutable
replay/conflicts, stopped ancestry, incomplete/changing job trees, fresh
target-bound verification, forbidden caller success fields, authenticated
tampering refusal, filesystem bounds, concurrent capture locks and interrupted
checkpoint recovery. Strict
TypeScript and targeted lint pass. No live task or bot was changed.

The module has no server route changes. Root must register the exported tool and
run the isolated-app integration after supplying the host adapters and private
key. Live observation coverage and task-updater adoption remain separate from
these contract checks; no production token savings are claimed.
