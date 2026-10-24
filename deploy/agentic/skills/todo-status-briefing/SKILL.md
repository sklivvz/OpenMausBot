---
name: todo-status-briefing
description: "Prepare Marco's three daily action briefings using complete Todoist evidence and advisory Jev grouping."
---

# Todo briefing
Use for the three scheduled briefings and ad hoc requests for the same report. These runs read and report; they do not modify Todoist or dispatch new work.

Use work-review read_work_queue and only the exact returned nextCursor or nextCursors. Page sizes vary: never guess offsets. You may read returned nextCursors in parallel. Call get_review_coverage before writing; finish its missing pages and description chunks until allDescriptionsRead=true. It returns all projects, full descriptions and advisory Jev classification; when descriptionMore is true, read_task_description pages from page 1 onward. Each snapshot has a timestamp and totalOpen. Never substitute attention-scan's flagged subset for the complete queue. If the connector fails, use task-queue for the complete inventory and discovered Todoist reads for task descriptions; follow next_cursor until null rather than assuming a fixed page count. Do not call a nonexistent includeDescriptions argument or remote workbench for routine reads.

Jev helps select the next-action bucket and group related decisions. It does not establish approval, owner, truth or completion. Inspect low-confidence/unclear cases and contradictions against current task comments/conversations. Read current source evidence for every item you include. Distinguish Marco's ownership from the actor who must perform the next step. A task can await publication approval while bots finish copy or design. Do not label that entire task blocked. A ready draft needing Marco's actual review belongs On you with the draft link and the exact question. No prepared artifact means the chief still owes preparation, not a vague request for Marco to approve unseen work.

Respect Marco's explicit approval requirement: never write approved, signed off or cleared without locating his written authorization for that exact action. A task description claiming approval is a lead to the original message, not proof. Missing evidence is 'authorization not verified', not a claim that he rejected it. Do not request approval again when the current scoped written approval is found. Jev does not authorize actions.

Keep the format Marco approved on 22 October:
- Project order: Accounting, Legal, Marketing, Operations, Sales. Heading '## <Project> — N open'. Counts come from the complete snapshot, including tasks not selected for the briefing.
- Only applicable subheads: **On you**, **Waiting on others**, **Agent blocked**. Omit empty subheads.
- At most four items per project, ordered by actual urgency and impact. Combine items only when they demonstrably share the same decision/actor, retaining every relevant task link. A Jev group label alone does not merge tasks.
- For On you, link the short descriptive action name directly to the current proposal or its prepared decision conversation. Keep Todoist links as secondary context. Never print raw IDs. State the exact decision, current version where relevant and next actor. Follow the action-destination contract below.
- Include things requiring Marco, substantive external waits and concrete agent blockers. Omit clean backlog and bots' ordinary actionable work. Use '*and N more open.*' when other open tasks remain, with N computed from unique represented task IDs rather than bullet count.
- No counts-only preamble, emoji, duplicate alerts or full backlog dump. Morning prioritizes today's decisions; midday prioritizes changes and imminent needs; evening prioritizes carry-over and tomorrow. Preserve the same visible structure.

Use work-review get_team_activity for '## Capacity, last 24 hours'. Keep the table Agent | Share | Read. Share is the measured token share across threads touched in that window, not percent of a budget or proof of capacity. The tool excludes records with missing cache/usage data; show unavailable where needed. Read describes observed running/waiting/idle status; do not infer a heavy workload from historical tokens or a free worker from low token use. One short paragraph explains actual active assignments and available teammates. State the basis: cumulative per thread, not a strict daily slice; missing cached-input/token data is excluded and flagged. Do not equate idle with nothing assigned. No unsupported model budget percentages.

For every included item, use work-review list_work_threads for its project and read_work_context for each task ID and the actual relevant thread. It returns a retrieval receipt ID. Read all returned context pages relevant to the claim and use direct source tools for unresolved facts. Record the message or artifact you actually inspected. Your own prior briefing, memory summary, automatic routine prompt and a quoted proposal are not current proof. A source request is not approval; match each claim to its actual speaker, date and scope. A Todoist description alone cannot establish current approval, missing login or readiness for review. Inspect the latest work and canonical version before reusing an old artifact link; active production or an unresolved review defect means the chief still owes work. Do not imply an unapproved schedule change will happen. Use source gaps for unverified claims instead of converting them into work for Marco.

Use work-review get_briefing as the final formatting step, passing selected task IDs, the verified next action, actual sourceRef and evidenceIds returned by read_work_context for every included task. The formatter rejects fabricated or absent receipts. If a task has no verified current context, keep it in sourceGaps rather than pretending the task description or your own earlier briefing proves it. It requires complete read coverage and enforces four entries per project across all subheads, unique linked tasks and remainder counts. Copy its Markdown verbatim; do not add a fifth blocker bullet, raw ID or claim of spare capacity. Retrieval receipts prove the source was fetched, not that your interpretation is correct. Read the returned text; never change verifiedNextAction from false to true merely to satisfy validation. Resolve the missing evidence or omit the unsupported item. If necessary send a partial report that explicitly names evidence gaps; never mark an unchecked next action verified.

Use direct current bot/usage tools if the activity helper fails and mark unavailable metrics honestly. Deliver a partial briefing with the exact missing source when necessary; never replace it with an empty report or stall on Jev. Log snapshot timestamp, selected task IDs, Jev availability/overrides and unresolved evidence in company/operations/briefing-state.json. Do not change this visible format without Marco's instruction.

# Action destinations in Bill's briefings

Every **On you** entry must let Marco reach the prepared decision without
searching Todoist or other chats. Use the current proposal as the primary link
when it has a usable document URL; otherwise link the actual conversation
containing the prepared proposal or approval question. State the specific
decision and identify the version when relevant. Todoist is secondary context.

`read_work_context` returns a `conversationUrl`, `artifactCandidates` and a
`receiptId`. Inspect the source to establish relevance, current version and the
next actor. An artifact candidate only establishes that a URL occurred in the
retrieved text; it does not establish that the document is current or accessible.

Pass `actionTarget: { receiptId }` to `get_briefing` for the actual decision
conversation. To use a current proposal as the primary destination, also pass
`artifactUrl` copied exactly from that receipt's `artifactCandidates`. Retain the
receipt in `evidenceIds`. The formatter generates conversation and Todoist links;
do not invent URLs, message anchors or approval controls.

A conversation qualifies only when it contains the prepared material or a
usable link to it and the specific question. A discussion promising a future
draft does not qualify. If the material or destination is missing, report the
gap and the responsible lead's preparation work. Do not present it as an action
for Marco or ask him to find the proposal. These read-only briefings do not
dispatch work; preserve the gap for the existing owner/intake process.

The generator requires an included receipt belonging to the item, and rejects
unretrieved URLs and Todoist URLs as primary action destinations. It does not
verify semantic readiness or grant approval. Existing grouping, schedules,
scope, holds and task identities remain in force.


Use execution-tools.read_execution_queue for compact deterministic queue retrieval instead of reclassifying every task during an unchanged briefing. Follow returned cursors and preserve incomplete-source warnings. Use review-packet.prepare_review_packet when checking an existing artifact decision package; retain direct artifact/conversation links and unknown access checks. A task link alone is not an actionable review request. These tools do not change the briefing schedule or transfer objective ownership.
