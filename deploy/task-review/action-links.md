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
