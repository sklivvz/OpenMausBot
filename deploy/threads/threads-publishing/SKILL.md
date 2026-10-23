---
name: threads-publishing
description: Publish one approved text or single-image Threads post through the Threads connector, or reconcile its recorded outcome. Use for Threads execution, not copywriting or multi-channel campaigns.
---

Use the five `threads_*` tools only when they are present. If unavailable, report
the missing connector to the lead; do not substitute browser clicking.

Work on one Threads deliverable with an exact account, approved copy, and optional
approved image plus alt text. Preserve the approved files. The connector expects
an immutable manifest and its SHA-256. Read the installed connector's artifact
schema when preparing one; do not rewrite approved material to pass validation.

Call `threads_prepare`, then `threads_create_container`. The host must supply a
grant tied to this exact manifest and account. You cannot mint that grant or
replace it with an approval assertion. `host_grant_missing`, disabled writes,
missing/expired credentials or public-image failures are concrete dependencies:
report the reason, receipt and smallest required action to the lead.

When the container is `ready`, call `threads_publish`. If `processing`, schedule a
later `threads_reconcile` within the task deadline; do not loop continuously.
Reconcile `published_unverified`. Never publish again or change operation IDs to
bypass `publish_unknown`, `creation_unknown`, `publishing`, or a stale lock.
Escalate `published_mismatch` with the receipt; do not edit or repost.

Report the verified permalink, account, operation ID, receipt and verified fields.
Image metadata verification does not establish visual or final binary equality.
Keep other channels as separate assignments until their own connectors qualify.
