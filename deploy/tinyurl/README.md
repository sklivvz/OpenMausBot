# TinyURL deterministic connector

Six stdio MCP tools cover the exact-alias CRUD surface of the authenticated
official API: `tinyurl_create` (`POST /create`), `tinyurl_read`
(`GET /alias/{domain}/{alias}`), `tinyurl_update` (`PATCH /update`),
`tinyurl_change_destination` (`PATCH /change`) and `tinyurl_delete`
(`DELETE /alias/{domain}/{alias}`), plus read-only `tinyurl_status`. No browser,
model, anonymous request or fallback route is used.

## Install

Run `node deploy/tinyurl/build.mjs` to produce `deploy/local/tinyurl-mcp.cjs`.
Register the absolute Node executable with that file as its argument and set
`TINYURL_CONFIG_FILE` to an absolute, private (0600), host-managed copy of
`config.example.json`.

The JSON config names two absolute paths:

- `tokenFile`: regular file, mode 0600, containing the TinyURL API token (raw, or
  `{"token":"..."}`). The token is sent only as `Authorization: Bearer ...` to
  the fixed `https://api.tinyurl.com` origin.
- `stateDir`: real private directory (0700) holding durable operation records.
- `timeoutMs`: optional request deadline, 100-4000 ms; default and maximum is
  4000 ms.

`tinyurl_status` reads only and creates nothing.

## Contract

All operations are bound to the fixed `tinyurl.com` domain and one exact alias.
No caller-supplied host, path or endpoint is accepted, so `tinyurl_read`,
`tinyurl_update`, `tinyurl_change_destination` and `tinyurl_delete` cannot reach
listing, bulk, analytics or arbitrary provider endpoints.

`tinyurl_read` returns the verified destination and documented alias fields.
`tinyurl_update` accepts `new_alias`, `new_stats`, `new_tags`, `new_expires_at`
and `new_description` only; it never accepts a destination URL. A rename sends
the documented `domain`, `alias` and `new_alias` payload to `PATCH /update`.
`tinyurl_change_destination` sends exactly `domain`, `alias` and `url` to
`PATCH /change` and verifies that the response confirms the exact new URL.
`tinyurl_delete` sends `DELETE /alias/{domain}/{alias}` (the OpenAPI v2.4.2
delete operation; there is no `/delete` endpoint).

`tinyurl_create` accepts `url` (required, absolute http/https, sent byte-for-byte
including query), `domain` (optional; only `tinyurl.com`), and `alias` (optional;
1-30 letters, digits, `_` or `-`). The response is verified so `data.url` exactly
matches the supplied destination and `data.tiny_url` matches `data.alias` on
`tinyurl.com`.

The operation key is SHA-256 over the exact URL, fixed domain and alias. Before
any update, rename, destination change or delete proceeds, every successful
create receipt for the affected alias (and both aliases on a rename) is marked
`stale`; a later create removes the stale receipt and performs a fresh provider
write, so a dead or redirected link is never replayed from durable state.
Exact-alias filesystem locks serialize create and mutation operations within and
across processes. Before a mutation is sent, a durable `pending` barrier is
written for each exact affected alias; it is cleared only after a verified
success or a definite 4xx/provider rejection, and is preserved on timeout,
network failure, unreadable success, crash or any other ambiguous outcome. No
create or mutation writes to that alias until an operator independently
reconciles it and removes the private `mutations/*.json` marker. A create with an
explicit alias refuses to run while the barrier exists. A create without an
alias compares the generated alias against durable mutation events and withholds
its link if a concurrent mutation touched that alias.

The create operation key is SHA-256 over the exact URL, fixed domain and alias. A
successful record is reused on repeat. Within one process, identical calls share
one request; across processes an atomic exclusive pending receipt ensures only
one request is sent and the other waits briefly for its verified result. A
timeout, network failure, 5xx/3xx response, or unreadable/ambiguous API response
is recorded as `write_outcome_unknown` and is not retried automatically. A 4xx
response is an explicit `api_rejected` failure and is not cached. Cached records
that do not match the exact operation, destination, alias or short-link shape
fail `cache_mismatch` rather than returning a wrong destination.

Provider response bodies are never copied into errors or logs. Official API
reference: [TinyURL OpenAPI v2.4.2](https://tinyurl.com/openapi/v2.json).

`tinyurl_read` uses `GET /alias/{domain}/{alias}` for operator reconciliation,
but the connector never retries a write automatically. An ambiguous write
outcome is reported honestly as `write_outcome_unknown`. There is no anonymous
fallback.

## Trust boundary

The host must prevent bots and callers from writing the config, token file,
connector code or state directory. Mode bits alone do not isolate processes that
share an OS user; mount configuration read-only or run the connector under a
separate identity.
