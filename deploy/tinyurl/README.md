# TinyURL deterministic connector

One stdio MCP tool, `tinyurl_create`, creates a TinyURL short link through the
authenticated official API (`POST https://api.tinyurl.com/create`). A read-only
`tinyurl_status` reports configuration presence. No browser, model, anonymous
request or fallback route is used.

## Install

Run `node deploy/tinyurl/build.mjs` to produce `deploy/local/tinyurl-mcp.cjs`.
Register the absolute Node executable with that file as its argument and set
`TINYURL_CONFIG_FILE` to an absolute, private (0600), host-managed copy of
`config.example.json`.

The JSON config names two absolute paths:

- `tokenFile`: regular file, mode 0600, containing the TinyURL API token (raw, or
  `{"token":"..."}`). The token is sent only as `Authorization: Bearer ...` to
  the fixed `https://api.tinyurl.com/create` origin.
- `stateDir`: real private directory (0700) holding durable operation records.
- `timeoutMs`: optional request deadline, 100-4000 ms; default and maximum is
  4000 ms.

`tinyurl_status` reads only and creates nothing.

## Contract

`tinyurl_create` accepts `url` (required, absolute http/https, sent byte-for-byte
including query), `domain` (optional; only `tinyurl.com`), and `alias` (optional;
1-64 letters, digits, `_` or `-`). The response is verified so `data.url` exactly
matches the supplied destination and `data.tiny_url` matches `data.alias` on
`tinyurl.com`.

The operation key is SHA-256 over the exact URL, fixed domain and alias. A
successful record is reused on repeat. Within one process, identical calls share
one request; across processes an atomic exclusive pending receipt ensures only
one request is sent and the other waits briefly for its verified result. A
timeout, network failure, 5xx/3xx response, or unreadable/ambiguous API response
is recorded as `write_outcome_unknown` and is not retried automatically. A 4xx
response is an explicit `api_rejected` failure and is not cached. Cached records
that do not match the exact operation, destination, alias or short-link shape
fail `cache_mismatch` rather than returning a wrong destination.

Provider response bodies are never copied into errors or logs. Official API
reference: <https://tinyurl.com/blog/how-use-try-it-out-tinyurl/>.

There is no reconciliation call because `GET /alias/{domain}/{alias}` was not
verified for this deployment; an ambiguous alias outcome is reported honestly as
unknown. There is no anonymous fallback.

## Trust boundary

The host must prevent bots and callers from writing the config, token file,
connector code or state directory. Mode bits alone do not isolate processes that
share an OS user; mount configuration read-only or run the connector under a
separate identity.
