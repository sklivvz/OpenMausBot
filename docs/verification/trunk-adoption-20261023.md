# Trunk adoption audit, 23 October 2026

Marco requested committing the accumulated work, adopting trunk-based
development and recovering work stranded on other branches.

## History inventory

- The current custom branch, `fix/runtime-stalls-and-restart`, starts at
  `c1fb5bb6e` before this consolidation. It includes all 16 commits unique to
  the fork relative to the fetched upstream main, including the table dialog,
  runtime and Selver work.
- Local `fix/table-dialog-scroll-sync` and the detached Codex worktree both
  point to that same commit and have clean working trees. They are retained
  for their owners; no worktree is removed or switched.
- There are no current stashes.
- Of 1,037 fork remote refs, the only branch name absent upstream is the custom
  runtime branch. Every other branch except `main` and `feat/chat-apps` has the
  same head as its upstream counterpart. The fork's `feat/chat-apps` head is an
  ancestor of upstream's version, verified after fetching that branch.
- Unreachable history contains a dropped deployment/Selver stash and its index
  commit. All 48 added lines from that stash are present in the current files;
  subsequent upstream integration changed some surrounding context. The audit
  does not reapply the obsolete patch over newer code.

The fetched `origin/main` is `30b62aaf18adc22099c24a7181abf5e9ddead980`.
It has 374 commits absent from the old custom head. Upstream integration is
being handled separately; this consolidation does not claim those changes are
integrated or deployed. The fork's development trunk now includes its custom
history rather than serving as an upstream-only mirror.

## Source and verification

Source, tests, deployment configuration and operational documentation are
included. Secrets, live state, private scratch evidence and reproducible
bundles stay outside Git. `pnpm build:local-tools` rebuilds the four generated
deployment tools. This avoids committing bundled third-party code as maintained
source; the underlying source remains linted and tested.

Lint source issues in the Design refresh callback and calendar prefix check
were corrected without disabling rules. Verification receipts are retained in
`.omb-scratch/trunk-20261023/`. Pre-push lint, typecheck and locale gates are
required; targeted server fixtures and deterministic service tests are run
separately. This action does not restart or redeploy the live app.

The targeted server run passed 114 of 115 tests initially. The remaining Selver
test still expected the old thrown error; it now requires the exact
`backendRejected` state, with no returned token. All five Selver tests passed on
recheck. The ten detector/calendar tests and 24 Node service tests passed.
The whole repository test suite was not run for this consolidation.

The continuing workflow is documented in [trunk development](../trunk-development.md).
