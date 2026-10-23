# Independent execution observer

This service observes the application without asking a bot to report. It reads
`runtime.db`, `messages.db`, `bots.json` and `groups.json` from a read-only data
mount. It writes its own SQLite history on a separate Docker volume. Bots receive
no observer tools, reporting instructions, credentials or additional turns.
The service has no network, no provider connection and no application write API.

## What it establishes

- Original runtime briefs and acceptance requests; source conversations and IDs.
- Actual delegation trees, recipients, execution starts, waits, returns, failures,
  cancellations and restart reconciliation from the runtime's durable events.
- Persisted resource/browser dependencies under `waitingFor`, separately from
  input cards under `waitingOnPerson`.
- Tool receipts, observed tool failures, routing attribution, questions and
  answers, user messages, request provenance and per-turn digests from transcripts.
- Bot names, configured models, soul hashes and room membership snapshots to help
  compare executions after configuration changes. A configured model is not proof
  of the model actually used by a particular turn.
- Source timestamps separately from the time the observer collected a snapshot.
- Collector health, backlog, failed collection attempts and refresh timestamps.

Reports retain agent responses under `agentClaim`. A completed runtime turn or
successful tool result never sets `businessOutcome` to achieved. It remains
`unverified` until a separate evaluation establishes the user's acceptance criteria.
The observer does not publish, ask for help, retry work or decide business success.

The cycle under discussion is objective → steps → execution → step verification →
objective verification → achieved/blocked/failed → help from the layer above when
needed. Current reports identify the parts for which the runtime supplies evidence.
They do not infer a plan, voluntary ownership, valid acceptance checks or escalation
to the correct role from conversational assertions. Those gaps are visible.

## Operation

Build the self-contained Node bundle:

```sh
node deploy/observability/build.mjs
```

The local Compose override includes the observer. On a new installation, create
its state volume and make it writable by the application's data owner (UID 1001
in this installation). This initialization affects only the new observer volume:

```sh
docker volume create openmausbot_observability-state
docker run --rm --network none --user 0:0 --entrypoint chown \
  -v openmausbot_observability-state:/state \
  openmausbot-local:task-queue-20261021 1001:1001 /state
docker compose up -d --no-deps observability
```

For a different Compose project or source data UID, use its actual volume name
and owner. `OMB_OBSERVER_IMAGE` overrides the local image; it must contain Node 24+
with `node:sqlite`. No image is built or application service restarted by the
observer's start command.

Read health and recent work; narrow to a shared-room thread or a runtime root:

```sh
docker compose exec -T observability node /opt/observer/observer.cjs health
docker compose exec -T observability node /opt/observer/observer.cjs report --limit 10
docker compose exec -T observability node /opt/observer/observer.cjs report --thread THREAD_ID --limit 100
docker compose exec -T observability node /opt/observer/observer.cjs report --root ROOT_ID
```

These are deterministic local commands. They do not call agents or wait for bot
approval. Root selection separates independent assignments in the same room;
thread context remains explicitly separate from root attribution. The report
retains `requestMessageId` where the application supplied exact message provenance.
Reports can contain private business text; keep exports private.

The collector polls every 15 seconds after catching up. Initial backlog is read
in batches of 500 with a one-second delay, never a busy loop. Each pass also
refreshes the latest 500 messages and advances a 500-row sweep over older messages
and assignments, retaining changed versions. Changes to old records may therefore
appear after a full sweep; inspect `messages.refreshCompletedAt`. This is snapshot
history, not a record of every intermediate text edit or streamed token.

Source event identities and cursors survive observer restarts; re-reading unchanged
records adds no revisions. A replaced database or a backwards source cursor fails
collection visibly, requiring investigation before state reset. Source records
already pruned before collection are unavailable. Source read failures roll back
that pass, including cursor movement, so the next pass retries the same evidence.

The service is capped at 0.25 CPU, 192 MiB RAM and 32 processes. Its SQLite database
has a 512 MiB page limit (WAL files can temporarily add space). History is not
silently pruned: archive or expand the observation store if it reaches the limit.
Health fails on collection errors or a last success older than two minutes. Docker
records unhealthy status; it does not automatically notify the operator or run a
frontier repair. Reviewing and repairing the system still happens in maintenance
sessions. Credential-shaped content is scrubbed; secret/sign-in card contents and
screen pixels are omitted. Oversized messages leave an explicit capture gap.

## Verification

```sh
node node_modules/vitest/vitest.mjs run server/observability.test.ts server/observability.e2e.test.ts
```

The end-to-end check launches the prescribed isolated fake-engine server and drives
a contribution offer, accepted work, specialist execution outside the leadership
room and continuation through `control-omb`. It verifies a fixture artifact, collection,
correlation, independent success assessment and observer restart persistence. It
saves commands, wait results, transcripts and the report beside the fixture log as
`*.observability.json`. No test is sent to the live bots or external accounts.

Set `OMB_VERIFICATION_ENTRY` to an absolute packaged `index.js` to qualify the same
workflow against a release artifact while retaining the isolated home and fake
providers. The deployed room agreement and release evidence are described in
[the first increment](../../docs/plans/2026-10-22-agentic-first-increment.md).

## Rollback

```sh
docker compose stop observability
```

Remove only its service entry from `compose.override.yaml` to disable future
starts. Keep the state volume for retained evidence. This does not alter the
application's database or bot configuration.
