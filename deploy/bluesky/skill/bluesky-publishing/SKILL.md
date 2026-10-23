---
name: bluesky-publishing
description: Prepare and publish one approved Bluesky text/image update through the Bluesky MCP, with exact copy, media, links and verified publication evidence. Use for Bluesky only.
---

Keep each Bluesky delivery a separate operation. Use the assigned post ID as its stable operation ID across retries.

1. Obtain the exact approved copy, image files and alt text. Do not rewrite approved material. For each HTTPS link provide its explicit start/end offsets in the original text (UTF-16, end exclusive); the connector computes UTF-8 facets. Obtain SHA-256 hashes of the supplied image bytes. Replies, mentions, video and link-preview cards are not supported by this connector; report this specific gap to the lead rather than substituting content.
2. Call `bluesky_prepare_post`. Show the returned exact preview and content hash through the existing approval route. Preparation does not publish. The trusted host must issue the exact operation/content/account grant from actual approval; a caller flag or pasted approval reference is insufficient.
3. Call `bluesky_publish_post` using the prepared operation ID and hash after the grant is available. The tool checks authentication, approved content, media, state and record identity.
4. Report success only for `status: verified`, with URI, CID and permalink. An unresolved or blocked response is unfinished. Relay its exact code and next action to the lead. Authentication/approval requests must reach the user's conversation, not remain hidden in a delegation chat.
5. After interruption or ambiguous publication call `bluesky_reconcile_post` with the same ID/hash. Do not create another ID, retry through the browser, overwrite a record, or declare publication from a write acknowledgement alone.

There is no browser step in this workflow. Do not combine unqualified social channels into this operation. The lead retains campaign planning and content approval; this skill executes the approved Bluesky delivery.
