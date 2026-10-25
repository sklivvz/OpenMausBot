# Darcy and Liz systemic repair, 24 October 2026

## What this package changes

It replaces the contradictory operating contracts and adds runtime boundaries for the diagnosed failure mechanisms. It does not publish, send, buy, edit protected originals or create live marketing objectives.

- **Correction continuity:** work corrections continue the exact original assignment thread; independent channels and objectives keep separate threads.
- **Two-sided admission:** Darcy must declare the workflow, independently verifiable deliverables, operations and acceptance evidence before a Liz work turn. Six channels cannot be bundled into one admission. Invalid bundles return `needs_decomposition` before a paid executor turn and do not create an orphan thread. A bounded bounce guard stops repeated identical dispatches.
- **Admitted-scope execution:** Liz is marked `admissionRequired`, so delegated work sent to her needs the structured admission, from any sender. Her turn receives the admitted scope. Every installed effect path checks the declared channel/operation before dispatch: Composio app tools, direct MCP servers, browser and computer tools. A post-turn check remains as a second net. Extra work needs another admission.
- **Acceptance:** Darcy->Liz work requires trusted evidence before settlement. Preparation/assembly needs a signed `record_execution_receipt` bound to this thread, objective and task, or a passing assembled-output check; neither proves an external publication. Publication needs a provider readback/reconcile result naming the exact object (and linking prepared content where the connector supports it). A hash-shaped string, a bot-supplied `sourceComplete` flag, a claim, report, tool acknowledgement or settled turn is not acceptance.
- **Roles:** Darcy keeps research, coordination, review, decision packets and preparation, but loses social/email/print/ads writes and browser. Liz keeps the installed LinkedIn, Keila, Bluesky/Threads and receipt paths; `execution-tools` is added to her MCP list so she can produce the signed receipt. She loses browser, and cannot take design/copy or unadmitted work.
- **Automatic learning:** the skill-review prompt receives the bot's role/SOUL and is told not to create or enable a skill that grants off-role work. This is probabilistic guidance; authority is enforced separately by the connector scopes and admission/receipt gates.
- **Time allocation:** an explicit person allocation is recorded with its source and deadline. Queueing, rework and retries do not reset it; admission rejects known-infeasible scope; expiry blocks a new effect and preserves completed work and receipts.

## What is intentionally unchanged

- Darcy and Liz model selections and fallbacks. A cheaper executor experiment is proposed separately in the review report; it is not applied in this deployment.
- Approval modes, the social connector approval machinery, other bots and live objectives.
- The existing `keila-drafts`, `bluesky-connector`, `threads-connector`, `execution-tools`, `slop-detector`, `sonarcloud` and `assembled-output` tools. They are reused, not rebuilt; `execution-tools` is added to Liz so her receipt is produced by the real host.

## Evidence summary

- `npx vitest run server/direct-coordination.e2e.test.ts -t "runs an identical brief again only with rework"` failed 2/2 before the fix: a correction received a new thread id.
- Live Liz had 55 tasks, 21 correction/continuation-shaped, each a separate thread; Darcy had 5 correction-shaped tasks.
- Live Darcy had composio on with no scopes and browser on by default; live Liz had all 14 skills enabled including browser publishing/design skills.
- Liz published through the LinkedIn MCP in about 31 seconds once given one exact post and "no browser"; the capability was present.
- The newsletter failure thread returned an operations report instead of the deliverable; the user asked what she was doing and Liz admitted the reports were not the deliverable.
- No `validate_handoff`, `check_marketing_brief` or `record_execution_receipt` calls appeared in the four bounded failure threads inspected.
- `personal-project-announcements` was auto-created during the incident and immediately enabled; the review prompt had no role/SOUL context.

These are established observations. The diagnosis distinguishes them from the hypotheses that cheaper models or prompt text alone would change behavior.

## Apply and rollback

`apply.mjs` is dry-run by default. It will:

1. Read both bots and their skills; refuse if either is busy or another bot turn is active.
2. Write an exact before snapshot (souls, model settings, browser, connector scopes, MCP lists, receipt policy, skill enabled states).
3. Install the two reviewed skills, disable the listed skills, patch the role/config fields and souls.
4. Read back every field and verify hashes/scopes; mark each changed field in a receipt.
5. On any failure, restore the exact before values; a rollback refuses a field that changed after the repair rather than overwriting live drift.

The live API is inside the container, not on the host port. Copy this directory into the app container and run the script there with an explicit URL. Never point the host's port 8799 at this script unless the parent has verified that it is the live app.

```sh
docker cp deploy/marketing-repair-20261024 openmausbot-omb-1:/tmp/marketing-repair-20261024
docker exec -u 0 openmausbot-omb-1 chmod -R a+rX /tmp/marketing-repair-20261024
docker exec openmausbot-omb-1 node /tmp/marketing-repair-20261024/apply.mjs --url http://127.0.0.1:8799 --dry-run
docker exec openmausbot-omb-1 node /tmp/marketing-repair-20261024/apply.mjs --url http://127.0.0.1:8799 --apply
docker exec openmausbot-omb-1 node /tmp/marketing-repair-20261024/apply.mjs --url http://127.0.0.1:8799 --rollback /path/from/apply/output/backup-<timestamp>.json
```

The apply command must wait for both bots to be idle. It does not interrupt a running turn. No live deployment is part of this package until that review.

## Limits

Fixtures prove routing, admission, scope, receipt and time-boundary mechanics. They do not prove real model judgment, business quality, or that a cheaper model behaves better. A multi-step newsletter is admitted as one workflow because the existing skill and platform tool define its steps; a multi-channel batch is not admitted until execution evidence promotes it. Effect checks cover Composio, gated direct MCP servers, browser and computer routes; native shell/network commands are not an authority boundary. A provider write already in flight at the deadline is reconciled rather than blindly retried. A signed artifact receipt is not a provider publication receipt.
