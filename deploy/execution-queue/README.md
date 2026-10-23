# Execution source retrieval

This read-only MCP implements the retrieval part of `execute-next-step` without
model calls. It reuses the existing attention service's `/review` snapshot,
whose provider adapter already follows every Todoist page. It does not add
another Todoist credential, classify work, rank priorities or infer permission.

`read_execution_queue` collects that snapshot once. An optional `projectId`
selects returned tasks while retaining the entire retrieved source. The tool
checks completion, task identity, duplicates and reported count before exposing
the result. Compact pages contain at most 15 tasks with IDs, dates, source hashes
and description lengths; full descriptions remain in private evidence.

For a selected task, `read_execution_context` takes `snapshotId`, `taskId` and
`threadId`, optionally `expectedTaskSha256`. It verifies the thread exists in
the app inventory and, for configured company projects, belongs to the task's
team. It follows the actual message API's `before` cursors and reads the actual
assignment tree through `/api/threads/:id/job?since=0&full=1`. Changed conversation
leaf or assignment content, duplicate pages, hidden/truncated assignments,
failed sources and limits produce explicit gaps and `sourceComplete:false`.
The task-to-thread semantic association remains unverified; the lead chooses
the relevant thread from current evidence.

Both tools return stable cursors, a SHA-256, evidence file, source collection
time and separate `sourceComplete`/`allPagesRead` fields. Reading every output
page does not turn a partial source into a complete one. Source collection
completeness also does not mean that the model has read every full description
or message: output excerpts are explicitly marked. Exact API-returned data is
saved mode 0600. The app's own public message representation may omit bounded
nested tool details; this tool cannot recover information not returned by that
API. Attachments and remote artifacts are not fetched.

Snapshots are local evidence artifacts, not a new authoritative task database.
They expire for tool cursor use after ten minutes; old files are retained for
audit. There are at most 32 active snapshots per process, 100 message pages of
100 messages per context, an 8 MB per-response limit and a 32 MB snapshot limit.
Limits never produce silent success. A source failure leaves earlier files
unchanged and does not represent an empty queue. Snapshot hashes identify what
was retrieved; source changes after collection still require a fresh read.
The app has no transactional snapshot for this read sequence. Comparing the
leaf detects new branches/messages, not every in-place edit of older message
data. Assignment content is reread in full and compared excluding only its
clock field, because the native version may omit some result fields.

## Run and integrate

Build with `node deploy/execution-queue/build.mjs [output-file]` (default private
scratch output). Register the resulting absolute command, or import
`createQueueReader` and `queueToolDefinitions` into the existing work-review MCP.
Root integration owns shared build/registration files; this change does not
modify them or deploy to live bots.

Configuration uses `EXECUTION_QUEUE_URL` (default loopback `8798/review`),
`EXECUTION_QUEUE_APP_URL` (default loopback `8799`) and
`EXECUTION_QUEUE_EVIDENCE_DIR` (default `~/.openmausbot/execution-queue`). These
are administrator configuration, never tool arguments. Only an existing source
snapshot POST and app GETs are performed. MCP inputs expose no URL, command,
model choice, task write, delegation or send operation. No observed token-saving
claim is made before real adoption.

## Verification — 23 October 2026

Ten isolated contract tests pass with:

```sh
node --experimental-strip-types --test deploy/execution-queue/reader.test.ts
```

Tests cover stable pagination, exact retained evidence, empty project scopes,
duplicate/partial inventory, all message pages, expired and mismatched task
references, wrong-team sources, page limits/overlap/live changes, hidden and
truncated assignments, failed sources and input/output limits. Strict targeted
TypeScript, targeted lint and bundle build pass.

A real isolated app launched through `scripts/control-omb.ts launch` at
`http://127.0.0.1:21596` discovered both tools, saved and read back fixture bot
selection. A separate synthetic queue HTTP service supplied one task. The
stdio MCP retrieved that task and the real fixture app's messages and native
job state successfully. No synthetic live writes or bot turns were performed.
The fixture was then stopped. Private evidence is `.omb-scratch/verification.json`.
Launcher log:
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792781903161-21676.log`.
