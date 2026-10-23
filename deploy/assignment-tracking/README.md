# Existing assignment tracking

`track_existing_assignments` reduces repeated interpretation of native assignment
state to deterministic, compact advice. The caller supplies the conversation,
root assignment ID and exact assignment IDs from its existing handoff receipts.
An optional expected native version rejects stale snapshots. No new assignment
ledger, classifier or model call is involved.

The runtime already deduplicates an identical brief, assignee and destination
under one parent. This tool retains those IDs instead of proposing another
dispatch. It does not prove semantic equivalence of differently worded tasks,
search all conversations, or enforce a business-wide uniqueness constraint.

| Observed execution | Advice |
| --- | --- |
| queued, running, waiting, resume | Reuse the existing assignment and wait |
| needs_input | Resolve its recorded dependency |
| failed | Resolve the failure before any new action |
| completed | Review its result; acceptance remains unverified |
| cancelled/stopped assignment or ancestor | Preserve the stop; expose still-active descendants |
| missing identity, wrong root, broken ancestry | Reconcile identity; do not assume replacement is safe |

Results keep execution state separate from deliverable acceptance and business
outcome. Returned assignee text is labelled as a claim, with a bounded preview,
raw UTF-8 text SHA-256 and the native `assignment_status` reference for full
review. Holds not present in the runtime snapshot remain `not_assessed`; current
task decisions still govern them. The tool never interrupts, retries, dispatches,
changes task status, grants permission or accepts a deliverable.

## Integration contract

`tracker.ts` exports `assignmentTrackingToolDefinition`,
`createAssignmentTracker({readJob})`, and `reconcileAssignments(job, input)`.
The host supplies an authenticated read-only function for
`GET /api/threads/:threadId/job?since=0&full=1`, preserving its existing viewer
scope and transport limits. Do not expose arbitrary base URLs or credentials as
model arguments. The E1 queue reader may reuse `reconcileAssignments` against
its trusted complete stored job evidence; do not accept a caller-invented job
as observed execution.

The reader obtains two native snapshots and compares canonical full content
excluding the sampling `now`. This catches changed results even on a server
whose old version token omitted them. A mismatch returns `source_changed`
without recommendations. Hidden/truncated rows, duplicate IDs, missing root,
wrong conversation and malformed sources remain incomplete. Reads are not a
transaction or a lock: execution may change after the second snapshot.

Host registration/selection and deployment are pending integration-owner work.
This module has no default server URL and cannot call production by itself.

## Native version correction

`server/job-view.ts` now hashes the public snapshot, excluding sampling time and
the query's `since` cutoff,
instead of a subset that omitted returned result text, outcome detail, source
titles and timestamps. Long-poll and snapshot consumers can now observe those
changes through `version`. Hidden result content is not hashed into the public
version. This server change requires a separately verified deployment; the
reader's full-content comparison also works with the existing server.

## Verification

```sh
node --experimental-strip-types --test deploy/assignment-tracking/tracker.test.ts
pnpm exec vitest run --config deploy/assignment-tracking/vitest.config.ts
```

Twelve deterministic tracking tests cover native states, stopped ancestry,
returned-claim boundaries, missing IDs, duplicate/partial source, stale version,
changed results without a changed native version, failure and compact multi-ID
reads. Twenty-one native job-view/job-route tests pass, including source-version
invalidation. Strict targeted TypeScript, targeted lint and diff checks pass.

An isolated application was launched through `scripts/control-omb.ts launch`
at `http://127.0.0.1:21176`. The published control surface sent a synthetic task
to its fake engine and waited for settlement. The real native `/job` response
fed the tracker; it returned `review_result`, `deliverableAcceptance: unverified`
and `redispatchAuthorized: false`. No live app, task, credential or provider was
used. Private evidence: `.omb-scratch/fixture-evidence.json` in the task worktree.
Server log:
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792782197864-22918.log`.

These checks prove deterministic tracking and native fixture behavior, not live
adoption, global duplicate prevention, business outcomes or token savings.
