# Deterministic automation integration — 23 October 2026

Twelve delegated workstreams were reviewed and integrated into `main`. The
runtime bundles were built from `dd8f65598`. The deployment uses persistent
files beneath `/data/.openmausbot/providers/automation-tools`, so mounting the
tools does not require restarting the application or replacing another agent's
uncommitted ACP runtime changes.

| Workstream | Implemented capability |
| --- | --- |
| Keila automation | Inventory, exact snapshots and guarded draft/template preparation |
| Brief and copy preflight | Mechanical constraints, bounded semantic checks and exact-input receipts |
| Work-kind classification | Narrow Jev classification with evidence and explicit uncertainty |
| Specialist ownership | Deterministic known operations and bounded classification for ambiguity |
| Assembled-output verification | Artifact hashes, required copy, links, images and placeholders |
| Actionable review packets | Source messages, exact artifact versions and direct decision links |
| Stale facts in reusable skills | Scoped replacements preserving current user authority in task sources |
| Queue/context retrieval | Complete source checks, compact pages and retained exact evidence |
| Handoff validation | Structured checks and native delegation payload preparation |
| Assignment tracking | Native assignment reconciliation without duplicate dispatch |
| Todoist progress | Targeted reads, evidence validation, managed metadata and exact readback |
| Execution receipts | Independently observed artifacts/assignments with authenticated receipts |

## Independent verification

The integration owner reviewed the modules, reran their targeted suites and
corrected defects found during review: inline HTML text preservation, stopped
assignment ancestry, native version churn on query cutoffs, MCP schema shape,
and repeated full-queue reads when inspecting one Todoist task. The joined
execution host also passed its fixture sequence: artifact baseline, observed
change, signed receipt, progress metadata update and exact provider readback.

The isolated application fixture at `http://127.0.0.1:20029` discovered and
persisted the execution and review MCP selections. It verified a real
message-scoped file, exact hash failures, native conversation retrieval, and
baseline-versus-changed artifact receipts. A separate lifecycle check reproduced
an unreviewed skill-file change, observed the checksum warning, reinstalled the
reviewed text through the supported API and verified exact readback. Temporary
paired administration sessions were revoked and rejected subsequent use.

Private evidence is retained in the integration worktree's `.omb-scratch`:
`execution-app-verification.json`, `review-packet-verification.json`,
`fixture-evidence.json`, and the `rollout` scripts. Repository lint, type
checking and locale validation passed in the normal trunk push hook.

## Live read-only checks

At 19:51–19:52 UTC the installed Keila bundle successfully read the project's
one template. The execution bundle collected all 246 open tasks, consumed every
compact page and inspected one exact task through the existing managed Todoist
connector. No provider draft, task or external message was changed for these
checks. Jev configuration was present. This establishes connector access, not
production adoption or quality gains.

The original MCP configuration, bot selections and skill texts are backed up
privately under `providers/automation-tools/rollback-dd8f65598`. Its `status.json`
records each verified installation and any remaining idle-window waits;
`smoke.json` records the live read-only results. Skill changes compare the actual
file hash, preserve supporting assets, use the application installation API and
verify exact text, enablement and absence of review warnings. They never directly
overwrite approved skill files.

## Limits

The native assignment-version correction is integrated in source but requires a
future server deployment. The new tracker independently compares full job data
and does not depend on that correction. The running server was deliberately not
replaced over the separate ACP work or restarted during active bot turns.

The receipt adapter supports evidence-backed `in_progress`, not business
acceptance, task completion or arbitrary waiting states. Baseline snapshots and
returned prose cannot prove progress. Artifact verification does not render email
clients or prove link reachability. Prepared review packets do not prove delivery.
Keila's credential is project-wide; omitted sending operations are a tool boundary.
Local hashes are preconditions, not provider-side atomic compare-and-swap.

Tools do not guarantee their own adoption. The existing independent observer
remains necessary; future genuine task executions must establish correct use,
reduced retries and lower new-token consumption. Historical skill totals overlap
whole turns and cannot be added together or represented as guaranteed savings.
