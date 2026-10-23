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
and unmapped source tasks. An objective can be ready, waiting on an owned timed
dependency, awaiting verification, or explicitly stopped with source evidence.
Any ready objective continues its lead even when another is blocked. A completed
provider turn is never business acceptance. Semantic source truth, sensible
priorities and output quality still require reasoning and independent review.

Checkpoints are claims and are stored separately from the controller's runtime
observations. The controller follows the exact admitted request through real
teammate returns. It does not trust an earlier acknowledgement as a final. Lost
HTTP responses replay the same persisted send identity. Explicit Stop, a changed
conversation and unproven request ownership prevent automatic resubmission.
A server-recorded model-capacity failure can use the configured fallback chain,
once per entry, in the same objective thread. The next turn must reconcile prior
effects before continuing. Stop takes precedence. Other provider failures, three
missing/invalid checkpoints or three unchanged ready checkpoints produce a visible
`maintenance` state with retained unfinished work. The controller does not repair
arbitrary provider failures
or classify new human messages. Those cases require orchestration repair; it
never silently converts them to completion.

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
pnpm exec vitest run server/objective-controller.test.ts server/objective-portfolio.test.ts server/objective-controller.e2e.test.ts server/guarded-messages-api.test.ts
pnpm exec tsc -p tsconfig.server.json --noEmit
```

The isolated fixture proves multiple retained objectives, automatic continuation,
timed waits and restart persistence through real guarded HTTP requests. Scripted
providers and fixture-authored checkpoints prove lifecycle, not live judgment.
