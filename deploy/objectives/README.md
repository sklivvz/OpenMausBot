# Continuing team objectives

The deterministic controller retains each lead's complete portfolio of accepted
business objectives across provider turns. It is not a campaign runner and does
not define business objectives from Todoist rows. Leads recover the objectives
and authority from current user conversations and artifacts, then associate the
source tasks with those outcomes.

Each portfolio has its own durable configuration, request identities, checkpoints
and events. A complete Todoist inventory is collected without agent calls every
five minutes. Missing or partial reads are errors, not an empty backlog. New
source evidence wakes a waiting portfolio. Due dependency checks and settled
requests also continue mechanically. Two portfolio requests may run at once;
least recently started portfolios receive admission first. Existing bot activity
and the application's guarded admission prevent competing starts.

## Checkpoints and evidence

A checkpoint inventories every retained objective with its source, priority,
state, next action, evidence and mapped task IDs. Code rejects dropped objectives
and unmapped source tasks. An objective can be ready, scheduled for a recorded review time, waiting on an owned timed
dependency, awaiting verification, or explicitly stopped with source evidence.
Any ready objective continues its lead even when another is blocked. A completed
provider turn is never business acceptance. Semantic source truth, sensible
priorities and output quality still require reasoning and independent review.

Checkpoints are claims and are stored separately from the controller's runtime
observations. The controller follows the exact admitted request through real
teammate returns. It does not trust an earlier acknowledgement as a final. Lost
HTTP responses replay the same persisted send identity. Stop and unproven request
ownership prevent automatic resubmission. A completed user correction on the
current branch, or a completed exact retry of the same request, can be reconciled
from runtime provenance. The controller preserves the latest instructions,
completed effects and retained objectives. Rewinds, different replacement branches,
input cards, active work and pending teammate returns still prevent admission.
Conversation changes also wake a scheduled wait. Historical user updates are
context, not newly authorized requests to repeat.

A server-recorded model-capacity or Claude account-quota failure can use the
configured fallback chain once per entry in the same thread. Other provider
failures, three missing/invalid checkpoints or three unchanged ready checkpoints
remain visible as unfinished maintenance. A stalled portfolio can reconsider new
source evidence; it does not keep executing an unchanged backlog. Scheduled work
waits until its recorded time or new evidence; ongoing record maintenance is not
an endlessly ready objective. The controller does not establish semantic truth or
repair arbitrary provider failures.

Source routing uses explicit accountable owners, inherited parent ownership and
project fallback for unresolved records. Cross-team descendants remain visible
as dependencies, with their own accountable portfolio. An explicit human owner
never inherits bot authority from a parent. Configure each portfolio's
`ownerNames` from its actual lead/specialist roster; names route source visibility,
not permission to execute. PMO intake sees the complete inventory.

## Deployment

Build with `pnpm build:local-tools`. The local override includes the `objectives`
service. It shares the existing loopback network, reads application files only,
and writes its separate `objective-state` volume. It does not require an app
restart. No configurations are bundled: live identities, business instructions
and source decisions belong in the private deployment state.

Each `/state/<portfolio-id>/config.json` follows `ObjectiveConfig` in
`server/objective-controller.ts`. Use a dedicated, existing-authority task thread
per lead, so unrelated conversations cannot silently redirect the objective.
The configured checkpoint directory must be writable by that lead and visible in
the controller's read-only application mount. A `paused` file in a portfolio's
state directory prevents further controller dispatch; it does not interrupt an
already admitted request. Use Stop in the actual task to stop that request.

Initialize the state volume ownership before starting the service, then:

```sh
docker compose up -d --no-deps objectives
docker compose logs --tail 30 objectives
docker compose exec -T objectives cat /state/health.json
```

Run only one service instance for a state volume. Keep the existing source
routines until registration is verified, then disable only the redundant domain
sweeps, retaining their backups for rollback. Preserve dedicated timed jobs,
user briefings and other maintainers' work. Stopping this service removes its
continuations; re-enable backed-up sweeps if rolling it back. Neither action
undoes business work already performed.

## Verification

```sh
pnpm exec vitest run server/objective-controller.test.ts server/objective-portfolio.test.ts server/objective-ownership.test.ts server/objective-reconciliation.test.ts server/objective-controller.e2e.test.ts server/guarded-messages-api.test.ts
pnpm exec tsc -p tsconfig.server.json --noEmit
```

The isolated fixture proves multiple retained objectives, automatic continuation,
timed waits and restart persistence through real guarded HTTP requests. Scripted
providers and fixture-authored checkpoints prove lifecycle, not live judgment.
