# First agentic increment: deployment receipt

Deployed 23 October 2026, Tallinn time. This is an implementation and fixture
receipt; it is not evidence that a live marketing launch or sales objective
has succeeded autonomously.

## Installed

- Coordination contains Darcy, Louis Tully, Blake, Bill, Luis and Donna.
  Donna is the default responder. The [room agreement](../../deploy/agentic/leadership-room.md)
  requires contribution offers, reconciliation, accepted work with acceptance
  criteria, specialist execution and evidence-based returns.
- Room leads can dispatch direct work to non-member specialists while keeping
  the leadership room restricted to orchestrators. Existing access checks apply.
- Direct work requests open distinct threads and histories. A retry of an
  identical request still deduplicates through the runtime.
- Computer waits persist their dependencies. Direct browser takeover parks
  the affected assignment until control is returned, then resumes the same
  assignment with an instruction to verify before repeating an action.
- A delegated input card wakes the waiting lead once with the original
  objective, dependency and existing request references. The child stays
  unfinished and resumes through its existing card.
- The independent observer runs without provider calls, approval prompts or
  network access. It records runtime evidence and revisions in its own volume,
  and reports saved dependencies. Business outcome remains unverified until
  evaluated separately.

Application image: `openmausbot-local:agentic-minimal-20261023`.
The deployed file hashes match [the repair manifest](../../deploy/runtime-repair/manifest.json).
The previous running image was `openmausbot-local:selver-auth-check-live`.
The persisted Compose image setting now points to the deployed release.

Source changes remain in the local `fix/runtime-stalls-and-restart` working
tree alongside earlier edits; no changes were discarded. Both remotes were
fetched. The requested fast-forward of `fork/main` to `origin/main` was rejected
by the local pre-push hook because `pnpm` is unavailable. The hook was not
bypassed and no remote branch changed. Upstream source integration is separate
from this deployed repair and remains pending.

## Verification

All workflow mutations ran in isolated fake-provider fixtures, including checks
against the exact patched package before deployment.

| Check | Result |
| --- | --- |
| Runtime, coordinator and observer unit checks | 278 passed |
| Agents catalog contract and size checks | 36 passed |
| Packaged runtime-roots and leadership/observer workflow | 14 passed |
| Packaged saved-login/browser workflow | 3 passed |
| Final package leadership/observer workflow | Passed |
| Server TypeScript check | Passed |
| Hash-checked patch reproduction | Reproduced both deployed files exactly |
| Live application health after deployment | Healthy |
| Live observer health after deployment | Healthy and caught up |
| Stopped Liz publishing continuation after restart | Cancelled / stopped |

The leadership fixture gives the room one unaddressed objective. Its scripted
leads consult for an offer, accept it, send work to a specialist outside the
room, produce an actual temporary checklist, and return through the same
delegation tree. The observer sees the sequence without being mentioned to
the agents and does not mistake their claims for business success.

Browser and runtime fixtures cover a real viewer takeover, parked admission
without repeated executions, dependency persistence, missing resolver,
release, Stop precedence, card escalation and separate histories. Production
checks read health, hashes, room configuration and runtime state only.

Private local logs and bounded receipts are in
`.omb-scratch/blocker-release-20261023/`. Test-generated detailed evidence is
retained next to the isolated server logs; it contains fixture data only.

## Manual publication and preserved decisions

Marco reported publishing X, then the remaining Mastodon/Threads posts himself.
The publication register, calendar and three channel task files record
`published_user_reported` / manual takeover, with no invented permalinks or bot
success. They instruct the team not to republish. Independent permalink
verification remains pending. Bluesky's previously verified bot publication is
unchanged.

Liz's input handoff was cancelled and the continuation stopped before the
deployment. The observer confirms root `c9f4389c-8f8e-4b5c-bd7e-fccce1e32a02`
remains cancelled with outcome `stopped`. No publication was attempted by the
frontier during this deployment.

## Deployment incident

The first deployment precondition found that `.env` named an older image than
the running container. A shell command continued after that check failed and
briefly recreated the older configured image. The setting was corrected to the
tested release and the application recreated again. No running or queued
assignments were present. Final image and file hashes, health and stopped work
were verified. Future multi-command deployment invocations must fail immediately
on any failed precondition; use `set -e` or checked subprocess calls.

## Limits and next observation

The contribution process is a working agreement executed through existing
coordination tools. It is not a new mechanical proof of voluntary agreement,
semantic task sizing or business acceptance. The fake-provider fixture proves
the routing and persistence; the next genuine objective will show whether the
live leads use them well.

Browser takeover recovery covers direct assignments. Unknown business blockers,
goal runs and room browser takeover require further work based on observations.
Card escalation preserves and delivers the request references; the lead still
has to explain the needed personal action clearly.

The observer collects continuously. It does not run a frontier model, perform
automatic semantic reviews or repair arbitrary defects overnight. Scrum and
retrospective instructions are recorded, but recurring ceremonies were not
scheduled as part of this increment. Todoist publication tasks were not closed
by the frontier; manual publication receipts still need reconciliation.

## Rollback

Room configuration and runtime backup are retained under
`/data/.openmausbot/maintenance-backups/agentic-minimal-20261023/`.
Publication files have adjacent `before-manual-takeover-20261023` backups.

Retain manual takeover decisions during any code rollback. The old runtime
does not understand the new dependency field: before reverting it, drain or
explicitly stop assignments carrying `continuation.waitFor`, and confirm there
is no executing or queued work. Point `OMB_LOCAL_IMAGE` at the previous running
image, not the stale pre-deployment `.env` value, then recreate only `omb`.
Do not restore a whole runtime database over newer user work.
