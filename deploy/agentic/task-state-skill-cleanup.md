# Current task state in reusable skills

`skills/execute-next-step/SKILL.md` is the reusable queue procedure. Current
authority comes from the owning task's decisions and source messages, and actual
effects come from operation receipts. The skill does not establish a campaign's
approval, publication, stopped or pending state. Removing an obsolete assertion
does not grant permission or reopen its task.

`marketing-evidence-and-delegation.md` supplies the corresponding marketing
principle. Keep the source message, time, artifact/version and affected operation
together. Resolve chronology within scope; missing evidence leaves the affected
operation restricted while independent authorized work can continue.

## Observed deployment drift

A read-only inspection on 23 October 2026 found five installed execution skills.
Four shared the generic source hash below. Darcy's execution skill and her
`direct-social-publishing` skill had the same obsolete newsletter paragraph,
including an assertion that two named campaigns remained unapproved drafts.
The shared source already had newer task-state guidance, but those installed
appendices still carried the old assertion. No matching SOUL file was found in
the scoped workspace search. This is a drift observation, not proof that every
other skill is free of task-specific state.

The two prepared Darcy changes replace only that obsolete paragraph with the
source-backed current-decision procedure and change a task-specific newsletter
review instruction into a conditional reusable procedure. Their surrounding
production ownership, no-send-without-authority, duplicate prevention and
review-delivery safeguards remain byte-for-byte unchanged. Their captured skill
directories contained only `SKILL.md`; recheck before installation.

| Snapshot | Reviewed input SHA-256 | Proposed SHA-256 |
| --- | --- | --- |
| Generic execution | `d4879493810610ca17f9e7702d8c071bd3a919ba9e4dd4bfc4054936aea181a0` | `d11e280728a5f8f50c156b6d239defa0653b31861fbd595d816953ffa43c4474` |
| Darcy execution | `ef31d78ecf8d532d4873cea153ff553f5c72b202665e14f618a3337468051e96` | `4e6df31ce2146faeef00404d61be48d848ab9ef9c8535eb3f258b56e6bd5ecb6` |
| Darcy social publishing | `b74385fe6fb4551c02466243dba813cc5e4bb45587c3c8402b0f2389400c50d8` | `d2afb796838428c81fe6d3547a466817530fe246eb7f448c7ed1b1e8251769d7` |

Private snapshots and exact plans are in the implementation worktree's
`.omb-scratch/{generic,darcy-execute,darcy-social}-{before.md,input.json,plan.json,after.md}`.
They are review evidence, not new active task records. No campaign state was
rewritten or copied into a competing task-state store.

## Guarded preparation and installation

`skill-text-plan.mjs` accepts a local JSON object with `text`, `expectedSha256`
and `replacements: [{before, after}]`. It verifies the complete input hash,
requires each original span exactly once, rejects overlaps and bounds input and
output sizes. It emits proposed text and hashes. It never contacts the app,
changes a file, installs a skill or interprets its text as authority.

```sh
node deploy/agentic/skill-text-plan.mjs REVIEWED_INPUT.json > PROPOSED_PLAN.json
```

Before applying a reviewed plan, read the skill through
`GET /api/bots/:id/skills/:name` and verify its hash against `expectedSha256`.
Read the listing and preserve enablement, origin and referenced assets. An
unexpected hash or new supporting file requires a fresh merge/review; do not
force the captured snapshot over it. Preserve the existing content as a private
deployment backup, then use the normal skill installation API and verify exact
content and enablement by readback. Do not write directly into the installed
skill directory, where reviewed checksums would become stale.

The skill-template endpoint refuses an already imported name. For the observed
single-file skills, the fixture verified `DELETE /api/bots/:id/skills/:name`
followed by `POST /api/bots/:id/skill-template` with the reviewed replacement,
description, source and preserved enabled flag. This is a replacement lifecycle,
not an atomic update; retain the backup for recovery if installation fails.
Do not use that single-file procedure if new supporting assets have appeared.

The current skill-template API has no atomic expected-hash precondition. The
planner is a local review guard, not a server concurrency guarantee. Do not
install while another writer is updating that skill; if that cannot be
established, keep the plan pending. Active bot turns need not be interrupted.
None of these steps authorizes editing task state, resuming a hold or sending
another campaign.

## Verification

`node --test deploy/agentic/skill-text-plan.test.mjs` checks exact scoped
replacement, preservation of surrounding safeguards, changed-source refusal,
missing/duplicate/overlapping spans, nonrecursive edits, uninterpreted quoted
text and size bounds. The skill-creator validator and targeted lint pass.

An isolated app fixture imports each old snapshot into a disposable bot, reads
it back, removes that exact skill and installs the prepared variant through the
normal skill-template API. It confirms exact text through the skill GET route
and checks enablement. Its private script and receipt are `.omb-scratch/verify.mjs` and
`.omb-scratch/fixture-evidence.json`. This proves installation mechanics, not
live decision quality. Root review, deployment and observation remain separate.
