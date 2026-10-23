---
name: delivery-commitments
description: Plan a concrete deliverable to finish on time, delegate within scope, check risk early and verify delivery.
---

# Organize work to finish

Use when accepting work, handing it to a specialist, continuing an objective or
recovering a missed commitment. The lead retains the business objective and
chooses the next useful contribution. Planning and progress records support
delivery; they are not the deliverable.

## Make the commitment concrete

Recover current user instructions, source artifacts and existing assignments
first. Record the next usable outcome, accountable owner, authorized operations,
acceptance check, direct task/artifact links, completion time and time zone.
Distinguish the user's deadline from your own delivery estimate. If no deadline
was supplied, choose a realistic estimate without inventing a user requirement
or changing the Todoist due date. Avoid an intake interview when the request
already supplies enough information.

Translate “you have X minutes” from the request's timestamp into a completion
target. Budget preparation, specialist work, integration and verification inside
that time. Give each specialist a concrete return time that leaves the lead time
to inspect and deliver. Check available capabilities before promising; separate
unfamiliar operations into independently verifiable contributions. Reuse a
working procedure; do not rediscover the entire workflow on every run.

For an existing asset, distinguish review, proposed changes and authorized edits.
A review returns findings and recommendations without changing the source.
Internal approval, urgency and a deadline do not create user authority to edit,
redesign, restore, send, publish, buy or book. Preserve explicit stops and the
current version. A changed brief withdraws its obsolete instructions; it does
not authorize parallel editors or another rewrite of accepted material.

## Work backwards from delivery

Choose the smallest sufficient plan and start it. Leads organize; specialists
execute their established roles. Existing contributions retain their owner.
Delegation carries the source version, authorized scope, deliverable, acceptance
check, return time and early check-in point. Do not assign the same work twice
or overload one specialist with several unfamiliar channels in one thread.

Set an early progress check before the delivery target, normally after the first
critical prerequisite or roughly a third of the available time. Inspect actual
artifacts and operation receipts. A running turn, a confident update or a plan
is not progress evidence. Let an active assignment finish its operation; do not
interrupt it because a timer expired or repeatedly poll unchanged work.

If the prerequisite fails or the deliverable is at risk, handle it at that check.
Use an established recovery or route the exact capability failure upwards with
attempts, evidence and resume point. Finish independent preparation. Ask the
user only for a missing decision they own, with the material and direct link
needed to decide. Offer a truthful revised estimate when needed; retain the
original commitment and reason for the miss. Do not silently reduce requested
scope, lower acceptance standards or move a user deadline.

## Deliver and retain evidence

Review the returned contribution against the brief and requested medium. Correct
specific observed defects through its owner. Stop revising once the acceptance
check passes; personal stylistic preferences are not defects. Deliver the actual
usable artifact or verified result in the requesting conversation and update
the existing Todoist task with the direct link, achieved contribution, next actor
and actual blocker. Read back the task update. Keep parent objectives open until
their own acceptance conditions are met.

For controller-managed portfolios, put the current contribution in the
objective's optional `delivery` record:

```
{ outcome, owner, scope, acceptance, timingSource, dueAt, checkAt,
  status: "active" | "delivered" | "missed", evidenceRefs: [] }
```

Times are Unix milliseconds; `checkAt` precedes `dueAt`. `timingSource` identifies
the user's message or labels your estimate. `delivered` requires a real artifact
or receipt in `evidenceRefs`; it remains a claim pending business verification.
Write the checkpoint as required by the controller and use `wakeAt` for the
next useful check when all executable work is waiting. Retain past commitments
and revised estimates in the existing task's history. Missing records remain
unknown; do not invent retrospective commitments. This record does not start a
timer that cancels work. The controller observes the last settled checkpoint,
so it is not a live view of an active specialist's progress.

After delivery or a scoped blocker, continue the next authorized contribution
across the portfolio. Record reusable learning in the appropriate skill, with
prerequisites, successful evidence and exceptions. Use the skill review workflow
before relying on edited instructions; changing an imported file can disable it.
