---
name: tinyurl-manage
description: Read, update metadata or alias, change destination, or delete one exact TinyURL alias through the local authenticated TinyURL CRUD tools. Use for an existing short link, with no browser or delegation.
---

Use this skill only for an existing exact `tinyurl.com` alias supplied by the
requester. Never invent, normalize or guess an alias. There is no browser step,
shell/curl request, delegation or arbitrary endpoint.

- `tinyurl_read` with `alias` reads the exact link.
- `tinyurl_update` with `alias` and one or more of `new_alias`, `new_stats`,
  `new_tags`, `new_expires_at`, `new_description` updates metadata or renames.
  It never changes the destination.
- `tinyurl_change_destination` with `alias` and the exact `url` changes where the
  link points. Preserve the URL and query byte-for-byte.
- `tinyurl_archive` with `alias` and `action: "toggle"`, `"archive"` or
  `"unarchive"` changes archive state. The vendor endpoint toggles; archive and
  unarchive read first and skip the write when already in the requested state.
- `tinyurl_set_expiration` with `alias` and `new_expires_at` sets or clears
  expiration (`null` clears it). `tinyurl_update` also accepts `new_expires_at`.
- `tinyurl_delete` with `alias` permanently deletes the exact link.

Do not retry `write_outcome_unknown`, and do not create a replacement alias to
work around it. Relay the exact code and next action; the mutation may have
applied. After a successful update or delete, a later `tinyurl_create` is safe:
the connector invalidates stale create receipts before reporting success.
Report only the returned verified fields.
