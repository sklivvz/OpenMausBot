# Continuing objective portfolios, 23 October 2026

## Requirement and correction

Marco requires continuous pursuit of the accepted objectives of all teams, and
multiple objectives within each team. The initial investigation incorrectly
narrowed the repair to Darcy's launch. No launch-only controller was enabled.
The implementation was expanded before deployment to independent portfolios for
Marketing, Sales, Legal, Accounting, personal Operations and PMO.

The read-only Todoist snapshot at 05:57:38 UTC contained 107 open tasks across
five projects: Accounting 32, Legal 28, Operations 16, Marketing 24 and Sales 7.
Those are task counts, not counts of accepted objectives or actionable tasks.
Leads must reconcile sources and explicit holds before acting. PMO owns routing
across projects, not a duplicate domain backlog.

## Implementation

The separate deterministic controller retains guarded request identities and
independent lifecycle observations across restarts. It follows actual runtime
settlement, including teammate returns, and admits another turn without a new
user message. Each checkpoint retains all previously recorded objectives and
maps every source task supplied at admission. Missing coverage is rejected.
Any ready objective keeps the portfolio active; blocked or verification states
on another objective do not suspend it. Timed dependencies and changes in task
or source conversation evidence wake retained portfolios.

A two-request admission limit and least-recently-started order share capacity.
The controller waits behind existing bot work and uses the guarded endpoint;
it does not steer, interrupt, enlarge permissions or resume stopped work.
A transport retry reuses the persisted exact request. A changed conversation,
unproven provider completion or repeated invalid/no-progress checkpoints remains
an explicit unfinished maintenance/intervention state, never success.

## Isolated evidence

`server/objective-controller.e2e.test.ts` launches a disposable application with
scripted providers. Two independent outcomes remain in one portfolio: one
verification claim cannot suppress the other's ready work. The fixture follows
three actual guarded requests through settlement, a controller restart and a
timed dependency, without another user submission. It leaves final claims
awaiting acceptance. The fixture saves bounded request snapshots and final state
beside its launcher log with `.objectives.json` suffix.

Unit checks cover lost-response replay, active-request deduplication, Stop after
restart, provider ambiguity, bounded checkpoint recovery, unchanged work,
objective retention, source coverage, independent team states and earliest waits.
Existing guarded-message HTTP fixtures cover admission fences and concurrency.
These are mechanical checks. They do not establish model judgment, truthful
checkpoint content, output quality, or achievement of a live business objective.

## Deployment and observation

Pending live registration and observation. Source implementation, deployment,
observed execution and business acceptance must be reported separately.

### First live admissions

Six dedicated portfolio threads were registered with their inherited task
permissions: five Full and PMO Auto. The five domain sweep schedules were
backed up and disabled; Bill's briefing/intake routines and specialists' dated
jobs were unchanged. The controller admitted Marketing and personal Operations
at 06:29:34–35 UTC. These are execution admissions, not business acceptance.
Darcy's observed source review explicitly recovered customer permissions,
editorial work, Slush, merchandise, paid advertising, measurement and newsletter
renewal in addition to the launch. Donna recovered personal sources and scoped
holds. Remaining teams await admission or their existing work finishing.

Donna encountered a missing `/usr/local/bin/operations-queue` in the current
image. Direct inspection also found the two attention-scan launchers absent.
The three existing fixed read-only launchers were restored without restarting
the app, and the image recipe now retains them. No scans or domain writes were
substituted by the frontier. PMO controller activation awaits the verified
Auto-compatible package; its current routines remain active.
