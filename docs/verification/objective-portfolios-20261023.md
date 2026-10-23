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

Source implementation, deployment, observed execution and business acceptance
are reported separately below.

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

### Continuation repair

The live controllers later stopped in three distinct conditions: new user
instructions superseded their exact request, a user retried the same request on
a replacement branch, and repeated checkpoints marked future reviews as ready.
One controller recorded an unsuccessful request before later user work completed.
These controller states did not establish that the bots themselves were idle.

The repair reconciles the complete bounded conversation ancestry and successful
runtime terminal records. It accepts settled user corrections and exact retries,
preserves Stop and rewind fences, waits for actual dependencies, retains prior
objective checkpoints and carries historical user updates as context rather than
new requests to repeat. Scheduled reviews have their own state and wake at their
recorded time. Conversation changes during a wait trigger reconciliation.

Todoist project membership does not establish ownership: explicit accountable
owners route cross-project contributions, children inherit only absent ownership,
and human-owned decisions remain unresolved for bots rather than inheriting
authority. PMO retains whole-portfolio intake visibility.

The isolated controller fixture includes a real user correction between guarded
requests, a controller restart, preserved checkpoint evidence and a new guarded
continuation. It asserts that the original request appears only once. Unit
fixtures additionally cover exact retries, unrelated branches, Stop, rewinds,
mid-turn steering, missing ancestry, pending inputs, scheduling and explicit
cross-team/human ownership. Account-quota recovery uses only configured fallbacks;
it does not bypass the workspace spend limit or enlarge task permissions.

## Subsequent recovery checks, 23 October

The reconciler now accepts a proven successful terminal outcome on the original
request after a maintenance observation, while still requiring the latest turn
and outcome to match and all live work/input dependencies to settle. Provider
recovery can leave only the failed leaf as its anchor. The reconciler walks that
leaf's ancestry to the original user request and accepts only an exact-text retry
at the same parent; unrelated branches, missing ancestry and Stop remain held.
The guarded send endpoint remains the final admission fence and is unchanged.
Ownership parsing also recognizes the `Accountable lead:` label present in the
current objective records. Explicit human ownership remains unresolved for bot
execution and does not inherit a parent bot's authority.

Twenty-nine unit tests passed across ownership, reconciliation, portfolio and
controller modules. The four controller HTTP fixtures passed: the first three
in the full run, then the late-completion case after its missing fake-provider
script was supplied. The retry fixture uses the real message-edit/retry route
following a provider failure. The late-completion fixture preserves an actual
successful server transcript and recreates the controller's earlier maintenance
observation in isolated fixture state. It does not inject a success into the
user's data. The exact deployed package was used for supported fixtures via
`OMB_VERIFICATION_ENTRY`; the capacity fixture launches the source server as in
its existing recipe.

During live maintenance, new controller dispatches were temporarily held while
waiting for an idle permission-update window. That held ready Sales work too
long. All six temporary holds were removed; no running turn was interrupted.
Do not repeat a global dispatch hold to install an optional read-tool grant.

Live observations are narrower than business acceptance: Sales resumed at cycle
8, reviewed its due qualification evidence and dispatched the overdue investor
slide's missing Finance contribution. Marketing delivered its existing newsletter
packet, delegated copy and template corrections, and retained the no-send hold.
Edna's design attempt encountered the shared Claude quota. Edna, Blake and Bill
were then configured for Sol high; Darcy was also explicitly set to high.
These model settings and activity do not prove the quality of the final output.
