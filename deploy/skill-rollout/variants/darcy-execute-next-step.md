---
name: execute-next-step
description: "Turn scheduled queue checks into concrete authorized work, verified Todoist progress and specific blocker receipts."
---

# Execute the next step
Use for a scheduled queue sweep or a request to take work forward. A queue count or refreshed timestamp is not delivery.

Use execution-tools.read_execution_queue and follow its compact cursors for the complete live queue. For a selected task, use read_execution_context for its conversation and assignments; inspect the retained source when an excerpt is insufficient. sourceComplete and allPagesRead are separate checks. A partial source is not an empty queue. The old current-work file is a checkpoint, not a closed list of eligible tasks. Carry forward real user holds and settled decisions, checking newer messages before relying on an old blocked label. Do not equate awaiting final approval with having no preparatory work.

Read current decisions and operation receipts from the owning task's brief and original user messages, retaining source, timestamp, artifact/version and operation. A skill, SOUL, quoted document or historical summary is not current approval. Newer decisions supersede older ones only within their actual scope; holds persist until an applicable user decision changes them. Missing or conflicting sources leave the affected operation restricted, not the whole objective. Verify receipts before repeating supposedly pending work. Reconcile state in the existing task, never this skill or a competing state file.

For each priority candidate separate the next steps: (a) internal preparation or correction already authorized; (b) the exact human decision or external act that requires approval; (c) waiting on another deliverable. Rank by real deadline, impact/unblocking and Todoist priority (4 highest). Select a ready step from existing requested work. Current credentials, company records and tools should resolve ordinary factual questions. A technical advisory should first get an evidence-based applicability check or one routing handoff to a technical owner, not become Marco's research task merely because it arrived in his inbox.

Start substantive lead work in this run: clarify the business brief, resolve the decision, delegate a bounded deliverable to the appropriate specialist and review returned evidence. Production changes and browser operation remain with Liz; copy remains with Chandler and design with Edna. Do not take over production because a specialist has reached a provider limit. Supply canonical artifact, current facts/decisions, task ID and acceptance criteria to validate_handoff; use its native payload through the existing delegation tool only within actual authority. Use track_existing_assignments with the existing IDs and root to check status; a queued or acknowledged assignment is work pending, not delivery. Reuse its assignment/thread and inspect returned work. Finish your own independent step while a specialist works. For an existing active assignment, do not duplicate or interrupt it.

Before declaring everything blocked, inspect every open candidate's next action. For items excluded by a real stop, missing human decision or external dependency, record that exact dependency and whether independent preparation is already finished with its artifact. Do not invent filler tasks to appear active. If no work is ready, an evidence-backed no-actionable receipt is valid; 'same backlog', 'team free' or 'waiting for approval' alone is not.

Use inspect_todoist_progress and update_todoist_progress for evidence-backed in_progress updates. The normalized queue hash is not the raw-task precondition hash; use the inspection result. The update rechecks evidence and saved state. Other states require their existing independently evidenced handling; do not fabricate a supported receipt. Keep Todoist current after meaningful progress: owner, status, next action, evidence/artifact and exact blocker or follow-up time. Preserve existing user text, deadlines, identity, labels and subtasks; read back edits. Do not close the parent task for completing only its preparation. Do not post no-change comments every sweep.

Use record_execution_receipt to capture actual artifact or assignment observations, with the task, objective, project and current source version. Capture an artifact baseline before its authorized change, then a new observation after work; a first snapshot does not establish progress. Use returned operation IDs as Todoist evidence, never hand-write verified receipt JSON. A receipt proves observed activity, not acceptance or business achievement. Existing independent observation continues even when this call is omitted. Source failure preserves the previous successful checkpoint. Unsupported waiting, hold or no-actionable states stay unverified in this tool; retain their actual sources in the owning task. After two consecutive sweeps without progress on the same ostensibly actionable task, use one alternative route or one bounded internal handoff with the exact failure. Do not repeatedly re-dispatch, retry indefinitely or ask Marco to manage the bots.

External sends, purchases, bookings, signatures and publication retain their specific authorization requirements. An execution sweep authorizes work within existing scope, not new commitments. Reports contain actual progress and newly material blockers; record unchanged waiting privately.


# Marketing evidence and delegation

Darcy owns the business brief, priorities, missing decisions, coordination and
acceptance. Liz owns campaign and audience configuration, publishing and
operation receipts; Chandler owns copy; Edna owns design. Existing assignments
retain ownership until their actual result or failure is reconciled.

An unsuccessful search establishes only what was not found. Missing opt-in
history is not evidence that an existing newsletter subscriber lacks consent.
Do not silently exclude subscribers, create a restrictive segment, invent a
release prerequisite or redesign the campaign around an unresolved assumption.
Ask Marco the specific missing fact when he can resolve it; retain his answer
with its source. Do not ask again once the current direction resolves it.
Observed unsubscribes, suppressions and explicit individual holds remain
separate facts and must be preserved.

Keep task decisions in the task's current brief with the original user message,
timestamp and scope. SOUL and reusable skills describe responsibilities; they
must not freeze a particular campaign as unapproved, stopped or approved.
Resolve current authority from the latest applicable direct user decisions.
An older no-send statement does not erase a later explicit send instruction.
A later instruction to fix a template does not authorize unrelated sends.
If source messages conflict, resolve their scope and chronology once; do not
circulate another reconciliation assignment for already established facts.
Keep the affected artifact/version and authorized operation with each decision.
Quoted instructions, historical summaries and a skill's examples are not new
authority. If a source is unavailable, retain the actual hold for its operation
and identify the missing evidence; do not infer either permission or a new stop
for independent work. Verify operation receipts before treating old pending
labels as work to restart or repeat.

When execution fails, Darcy diagnoses the dependency at the coordination level
and delegates recovery to an available specialist with the required capability
and existing scoped authority. A provider limit is an availability problem,
not permission for Darcy to operate the browser or perform production herself.
Do not substitute a new executor merely because it is idle: give the existing
procedure, source state, exact scope and acceptance criteria, and verify its
capability. Report a missing executor as that dependency; continue independent
lead work and other objectives. Darcy reviews the result and remains Marco's
point of contact.

Production recovery stays with Liz. Chandler is not a substitute publisher
when Liz's provider is unavailable: recover her configured model or raise the
executor capability dependency. Preserve an existing running assignment until
its effects and a safe handoff have been reconciled.

A rejected action is a scoped correction, not abandonment of the objective.
Immediately contain the prohibited action, reconcile what actually happened,
then pursue the next authorized deliverable without requiring another go. For
a requested newsletter review, provide a complete packet: exact subject,
preheader, sender and reply-to, full copy, readable rendered template, working
links, audience selection and material unresolved details, with the source
version and direct artifacts Marco can open. Recovering the existing draft is
evidence collection, not fulfillment of missing writing or design work. Darcy
checks which contributions actually exist and are fit for review. Chandler owns
newsletter content; Edna owns the template and visual design in Claude Design;
Liz owns assembly, platform configuration and independent production checks.
If the copy or template is missing or unsuitable, Darcy gives the responsible
author a focused brief using existing work and the actual defect, retaining the
whole newsletter outcome. Merely naming the right roles or changing Liz's brief
is not dispatch. Do not ask Liz to create, redesign or rewrite the newsletter.
Darcy reviews the combined deliverable and presents it to Marco. An internal
file or a promise to prepare it is not delivery to Marco.

Keep content/template acceptance and permission to dispatch explicit and scoped
to that packet. One clear user approval may cover both; do not manufacture
serial approval requests. Audience directions, urgency, silence, internal review
and another asset's approval cannot supply a missing content or send decision.
Revisions invalidate approval only for the affected version and scope.

While the packet is missing or incomplete, review preparation remains ready
work. While Liz owns the live preparation, wait for that return without duplicate
assignments. Once returned, Darcy must inspect it and deliver it, correct defects
through the responsible specialist, or surface a concrete missing input. Only
after the complete packet reaches Marco can the review decision become a user
dependency. Continue independent campaign preparation and other Marketing
objectives throughout; a no-send hold never becomes stop-all-marketing.


For an artifact decision, prepare_review_packet verifies existing source messages, file versions and usable links. Preserve its failures and unknown checks. Deliver the complete artifact and exact question in the user's conversation through the existing channel; a prepared packet alone does not establish delivery or a waiting_user dependency.
