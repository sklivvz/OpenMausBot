# Deterministic Todoist progress

This module replaces repeated task-description editing and readback with one
bounded operation. It does not create tasks, close tasks, alter deadlines or
labels, move tasks, assign Todoist users, send comments or call a model. Owner and
status are progress metadata inside a managed description block, not changes to
the provider's assignee or completion fields.

`createTodoistProgress` exports `inspect`, `update` and `call(name, arguments)`.
`progressToolDefinitions` contains `inspect_todoist_progress` and
`update_todoist_progress` for the execution MCP host. No new task database or
credential is introduced. The transport wraps the existing managed Composio
connector used by the Legal queue, fixes the account to its existing `work`
account and permits only `TODOIST_GET_ALL_TASKS` and `TODOIST_UPDATE_TASK`.
It disables redirects so credentials cannot follow a redirected endpoint.

## Host configuration and evidence

Construct the tool with:

- `rpc`: `createProgressRpc` using the existing broker origin/token. Keep these
  credentials in the host environment, never tool arguments.
- `receiptDir`: an absolute private persistent directory writable only by the
  trusted host, shared by all processes using this capability.
- `allowedProjects`: explicit existing project IDs assigned to this tool's scope.
- `verifyEvidence(ids, {taskId, projectId, status})`: a trusted host adapter which
  reads and revalidates actual source receipts. No caller `verified: true` field
  or arbitrary receipt JSON is accepted as proof.

The evidence adapter returns `{receiptId, taskId, sha256, reference,
supportedStatuses}` for each requested identity. Every identity must match and
support the requested state. The E12 execution-receipt adapter supplies this
contract; do not replace it with a pass-through of bot assertions. An artifact's
initial baseline is not evidence of progress. `waiting_user` needs evidence of
actual decision delivery; task text saying "waiting" cannot supply that proof.
The initial receipt implementation may support only a subset of states; unsupported
states fail explicitly rather than falling back to a model or invented evidence.

Source receipts precede this update. They must not require a successful Todoist
readback already, which would create a circular dependency. This module creates
its own durable operation receipt only after reading the actual provider task.
It verifies the resulting Todoist state separately.

## Workflow

1. Inspect `{taskId, projectId}`. Code reads every task page with duplicate/cursor,
   count and duration bounds and returns `taskSha256` plus current progress.
2. Update with `{taskId, projectId, operationId, expectedTaskSha256, owner,
   status, nextAction, evidenceIds, blocker?, followUp?}`. Use a stable operation
   ID for this exact update. The allowed working states are `ready`, `in_progress`,
   `in_review`, `waiting_external`, `waiting_user` and `held`; there is no
   completion operation. Waiting/held states require a blocker and ISO follow-up.
3. Code checks scope and host evidence, rereads the task, requires its exact hash,
   and changes only the block between `<!-- openmaus-progress:start -->` and
   `<!-- openmaus-progress:end -->`. Text before and after the block is preserved
   byte-for-byte. Duplicate, missing or conflicting delimiters fail before writing.
4. Identical progress is a no-op even with a fresh operation ID. For a changed
   block, write identity and pending state are durable before the connector call.
   Readback must match the exact requested description and all other supplied
   task fields except the provider's `updated_at` value.
5. Return the verified task hash and private operation-receipt reference. A
   verified update proves the progress record was saved, not that the parent
   business objective was achieved or the free-text next action is sensible.

No original user text, deadline, labels, subtasks or task identity are intentionally
changed; the only provider write argument besides task ID is `description`.
Historical `[Legal progress]` or other blocks remain ordinary user/source text.
This tool does not delete or migrate them automatically.

## Concurrency and uncertain outcomes

A private exclusive per-task lock excludes this tool's concurrent writers. A
crash may leave a lock; inspect its recorded PID and receipts before removing it.
There is no unsafe automatic lease expiration. A pending operation also prevents
a new operation ID from bypassing an uncertain earlier write.

A lost write response is followed by readback. If the exact saved description
and preserved fields match, the outcome is reconciled without another write.
Otherwise the operation is `needs_reconciliation`. Retrying its original identity
only reads current state; it never repeats the mutation. If an operator establishes
that no write occurred, resolve the retained receipt/pending record through the
maintenance workflow before submitting new work.

The connector does not expose a demonstrated atomic conditional-update operation.
The task hash is a local preflight check, **not provider compare-and-swap**. Another
client can still edit between the read and write. This tool detects differing
readback but cannot restore an external edit it never observed, and never attempts
an automatic rollback. Avoid concurrent description writers for the same task.

Private receipts contain the original task and resulting progress; exclude their
directory from sharing and model context. No live task has been mutated to test
this module. Runtime host registration, E12 evidence wiring and scoped deployment
remain the integration owner's work.

## Verification

Run:

```sh
node --experimental-strip-types --test deploy/todoist-progress/progress.test.ts
```

Fourteen isolated tests cover exact preservation/readback, unchanged and repeated
operations, suffix preservation, stale snapshots, identity conflicts, lost responses,
uncertain-write bypass prevention, changed preserved fields, evidence/scope/hold
requirements, malicious delimiters, exclusive locks, incomplete paging, actual
connector framing and credential redirect isolation. The full workflow runs
against a synthetic loopback HTTP connector with temporary task data and private
receipts; no production data or account is used. Strict targeted TypeScript and
lint pass. These tests establish mechanical behavior, not semantic correctness of
supplied progress or measured production token savings.
