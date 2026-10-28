---
name: tinyurl-bulk
description: Submit, inspect status and page through reports for one typed TinyURL bulk request through the local authenticated TinyURL tools. Use for an approved batch of exact tinyurl.com operations, with no browser or delegation.
---

Use `tinyurl_bulk_create` only with an approved, explicit list of 1-100 items.
Each item must be one typed variant: `create` (`url` required; optional `alias`,
`tags`, `expires_at`, `description`), `update` (`alias` plus at least one
`new_*` field), `change` (`alias` plus `url`), or `delete`/`archive`/`unarchive`
(`alias`). All domains are fixed to `tinyurl.com`. Do not invent aliases, URLs or
metadata.

Bulk writes are not transactional and may be processed asynchronously. The
connector checkpoints a durable barrier before sending, so an exact repeat of a
verified payload returns the stored `bulkRequestId` instead of creating a second
batch. On a timeout, network failure or unreadable response the connector returns
`write_outcome_unknown`: never resubmit, never remove barriers without operator
reconciliation, and never create replacement aliases. Report the exact code and
next action.

Use `tinyurl_bulk_status` with the returned `bulkRequestId` to poll. Use
`tinyurl_bulk_report` with `offset` and `limit` (1-500, default 100); follow
`hasMore`/`nextOffset` and report `failed` rows with their `comment`. Token
permission: Bulk Requests.
