---
name: tinyurl-create
description: Create one exact TinyURL short link directly through the local authenticated tinyurl_create tool. Use for an exact destination URL that must be shortened, with no browser or delegation.
---

Call `tinyurl_create` directly with the exact approved destination URL. Include
`alias` only when the requester supplied that exact alias; never invent one.
`domain` is fixed to `tinyurl.com` and need not be sent. Do not alter, normalize
or re-encode the URL or its query string.

There is no browser step, no shell/curl request, no delegation and no extraneous
reasoning. One `tinyurl_create` call performs the operation. Report only the
returned verified destination and `tinyUrl`.

If the result is `write_outcome_unknown`, do not retry and do not create a new
alias. Relay the exact code and next action to the lead; the write may have
succeeded. For `cache_mismatch`, `api_rejected`, `credentials_unavailable` or
`configuration_unavailable`, report the exact blocked response instead of
claiming a short link or substituting another route. `tinyurl_status` is
read-only and may be used to check configuration presence before the call.
