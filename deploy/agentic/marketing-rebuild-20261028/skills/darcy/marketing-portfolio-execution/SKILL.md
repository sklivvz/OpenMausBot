---
name: marketing-portfolio-execution
description: Operate the marketing objective portfolio, Positron Tasks, calendar and announcement procedures without losing learned domain knowledge.
---

# Marketing portfolio execution

Use for portfolio review, Positron Tasks progression, calendar work, announcements, events or a scheduled marketing run. This is the consolidated procedure; the SOUL remains the role boundary.

## Portfolio and Positron Tasks

Keep all accepted objectives, not only the current launch or link. The portfolio includes launch, evergreen collateral, editorial, channel/calendar, customer proof, events, acquisition and measurement. A blocked objective never suspends the others.

Use the installed Positron Tasks MCP:

- `get_organization` for the Marketing department id and current membership.
- `list_tasks` filtered to the Marketing department, `limit` up to 200, increasing `offset` until `total` is read. Check `eligible` and `reviewable` separately.
- `get_task` and `get_task_history` for the selected task; read its conversation and assignments. Use `get_source_project`/`get_source_work` when an excerpt is insufficient.
- `update_task_progress` only after claim/responsibility checks; record the direct artifact link, achieved contribution, next actor and actual blocker. Read the update back.
- Do not claim another bot's task or duplicate an existing assignment. A task record maps to an objective; it is not the objective itself.

## Calendar

Run the read-only `/usr/local/bin/marketing-calendar-audit` first when available. It takes no arguments and inventories the current publication register. Treat its state labels as claims to verify, not completed preparation.

Map every relevant row by stable row key: exact slot/time zone, copy version, preparation remaining, reviewer, publisher, approval source and next action. Preserve the source register and history; update current fields rather than appending contradictory histories. Distinguish drafted, internally reviewed, approved, ready, hold, scheduled, published and missed. Scheduling is not publication. Record exact platform parameters and a provider readback or receipt.

For Liz calendar work, the current sheet/register source and authorised rows must be in the assignment. She owns the mechanical update; Darcy owns priority, review and acceptance.

## Announcements and release packets

An announcement needs an audience, message, visual brief and production owner. A written/text-only channel may not need a new image when the user chose that channel or supplied the asset; do not invent a visual requirement. A release packet contains the exact reviewed copy, inspected final asset when required, alt text, destination/UTMs, channel/account, proposed slot, publisher, scoped approval source and next action.

Approved template and approved copy are immutable. Do not silently redesign, rewrite or "improve" them. Corrections change only the observed defect and preserve prior approvals outside that scope.

## Events and review links

For an event programme, recover the current brief, event timezone, platform and existing programme. Separate a bounded correction from a rebuild; preserve unaffected segments and released time. Keep platform configuration with the production owner and copy/design with their owners.

Use the review-packet tool to format the exact decision message, artifact versions and usable links. Include assembled-output evidence where relevant and retain failed/unknown checks. The packet does not send or approve anything.

## Acceptance

Keep execution state, deliverable state and business outcome separate. A settled turn, a report or a tool acknowledgement is not acceptance. A provider object, saved artifact or validated receipt supports the step; only observed business evidence supports the outcome. Unknown stays unknown.
