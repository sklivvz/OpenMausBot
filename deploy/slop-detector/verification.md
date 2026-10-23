# Copy and brief automation verification — 23 October 2026

Source verification uses temporary receipt directories, synthetic copy, a fake
Jev HTTP endpoint and the isolated OpenMaus launcher. No production content,
models, publishing state or active bot sessions were changed.

## Adoption audit

A read-only query of the live messages database found 35 actual `detect_slop`
activity records across 15 turns and 14 Chandler work threads, dated
22 October 16:45 UTC through 23 October 15:05 UTC. Nineteen returned
`no_flags`; sixteen returned `needs_review`. All 35 draft hashes and full-review
hashes were distinct. Exact caching alone therefore would not have removed any
of these observed calls. Several threads cover multiple channel assets, so a
thread's call count is not evidence of excessive retries for a single asset.

The recorded nested finding details were replaced with `[additional data
omitted]` by bounded transcript previews. This sample does not prove that the
findings were useful, ignored, repaired, or false positives; it also does not
prove which text reached the end user. Full persisted review inputs/receipts and
a compact finding summary in version 2 make subsequent evaluation possible.
Skill-associated turn totals are overlapping, not recoverable skill costs. No
live token savings or live copy-quality improvement is claimed by this change.
Private evidence: `.omb-scratch/detector-calls.json` and
`.omb-scratch/adoption-summary.json` in the implementation worktree.

## Deterministic fixtures

Eighteen tests pass with:

```sh
pnpm exec vitest run --config deploy/slop-detector/vitest.config.ts
```

They cover source-grounded passage offsets, complete-input limits, unavailable
Jev, uncertainty, absent source facts, Unicode text, explicit constraints before
any model call, full-input cache invalidation, persistent receipt reuse, concurrent
call deduplication, expiry, transcript-safe summaries and exact persisted inputs, scoped two-review limits, missing brief fields, role/version/
authority conflicts and independently authorized preparation under publishing
holds. Strict TypeScript checking, targeted lint and the MCP bundle build pass.
Both changed skills pass the skill-creator validator.

## Isolated app and process integration

The launcher used `http://127.0.0.1:22597` with disposable data directory
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verify-data-lXWEcu`.
The updated MCP was registered and probed through the real app endpoints; it
exposed exactly `detect_slop` and `check_marketing_brief`. A fake-engine bot's
MCP selection was saved and read back. Both updated skills were installed through
the fixture's skill-template API, enabled, and read back byte-for-byte.

Two independent MCP processes shared one temporary receipt directory and a fake
Jev endpoint. A mechanical failure made zero HTTP calls. Concurrent identical
reviews made one call; a second draft made a second call; a third draft in the
same scope returned `needs_editor` without a third call. The second process
reused the first process's receipt. This verifies actual cross-process reuse,
not just a mocked in-memory cache.

The private fixture script and result are `.omb-scratch/verify.mjs` and
`.omb-scratch/fixture-evidence.json`. These checks prove the tool contracts and
registration path, not that live agents consistently supply correct scopes or
that the revised passage-choice wording preserves classifier accuracy on all
copy. Model calibration and real workflow savings remain observation work.

## Deployment handoff

Build and install the updated `/usr/local/bin/slop-detector-mcp` bundle without
replacing a newer app server. Existing `detect_slop` callers remain compatible.
Refresh/probe the existing MCP registration so `check_marketing_brief` is
visible. Preserve MCP selections; only intended marketing users need access.
Set a persistent private `SLOP_RECEIPTS_DIR` if the MCP's home is ephemeral.

Merge the changed `copy-preflight` and `marketing-deliverable-brief` procedures
with any newer live corrections using the app's skill installation API. Preserve
referenced assets and reviewed/enabled state; compare current content before
writing. Do not alter `brand-copy-quality` facts or voice rules without reading
the current live version. Do not restart or interrupt active turns; refreshed
instructions/tool discovery take effect on subsequent turns. No synthetic live
marketing task is needed: observe the next genuinely authorized asset.
