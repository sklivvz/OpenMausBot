# Delivery commitments and reviewed procedures

The approved repair organizes work around usable deliverables and completion
targets. It does not implement elapsed-time interruption. Leads retain business
ownership, delegate scoped contributions with return times, check risk early and
verify the result. Review requests do not authorize edits to the source asset.

## Isolated evidence

An isolated `launchVerificationServer` fixture used the packaged server and
fake provider. For eight temporary bots it installed the prior skill disabled,
removed it, imported the reviewed replacement, installed new delivery skills and
patched the proposed profile. Every skill body and profile matched exact readback;
all twelve skill instances were enabled without warnings. A fake-provider turn
settled after the configuration changes. No live business task was used for this
test. The fixture log was `server-1792759720143-3315.log` in the local verification
evidence directory.

The controller and portfolio suite contains 24 passing checks, including:

- Optional timing records preserve compatibility with existing portfolios.
- Incomplete contracts, inverted times and unsupported delivery claims fail
  validation.
- Clock advancement reports check_due and overdue without changing continuation,
  cancelling an assignment or asserting business success.
- Explicit stops remain stopped; delivered with a receipt remains a claim.
- A real isolated guarded-request workflow retains a delivery record across a
  controller restart.

Run the relevant fixture and unit suite with:

```sh
pnpm exec vitest run server/objective-portfolio.test.ts server/objective-controller.test.ts server/objective-controller.e2e.test.ts
pnpm exec tsc -p tsconfig.server.json --noEmit
node deploy/objectives/build.mjs
```

## Live configuration

The repair installed `delivery-commitments` on Darcy, Blake, Luis, Louis, Bill and
Donna. It replaced six disabled skill instances: the marketing brief on Darcy,
Liz and Edna; Darcy's calendar tracking; and Bill's intake and action briefing
procedures. The source files are in `deploy/agentic/skills`.

Eight profiles now specify scoped delivery and early risk handling. Other skills,
models, user stops and purchase permissions were preserved. Backups of exact
prior profiles, skill contents and metadata are in the application's maintenance
backup directory under `delivery-commitments-20261023/plan.json`. The installer
checks for concurrent edits and verifies content, enabled status and warnings
after import. Bill's unchanged skill text still needed re-import because its
review checksum was invalid; merely requesting enablement was rejected.

## Limits

Configuration readback and a fake-provider turn do not prove live compliance or
better business outcomes. Active turns are not interrupted to reload instructions.
Controller timing observations use the last settled checkpoint, not an active
agent's current progress. Legacy objectives without a delivery record remain
unrecorded; no deadlines are invented. Runtime admission, explicit stops and
intervened portfolios retain their existing behavior. The rejected interruption
implementation is not part of this change.
