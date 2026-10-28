# TinyURL deterministic connector

Fifteen stdio MCP tools cover the official authenticated TinyURL v2.4.2 surface
for CRUD, archive state, analytics, raw analytics logs, expiration and bulk
requests. Every tool maps to one fixed `https://api.tinyurl.com` path and a
validated JSON body or query. No caller-supplied host, method, endpoint or
arbitrary path is accepted. There is no browser, model, anonymous request or
fallback route.

## Install

Run `node deploy/tinyurl/build.mjs` to produce `deploy/local/tinyurl-mcp.cjs`.
Register the absolute Node executable with that file as its argument and set
`TINYURL_CONFIG_FILE` to an absolute, private (0600), host-managed copy of
`config.example.json`.

The JSON config names two absolute paths:

- `tokenFile`: regular file, mode 0600, containing the TinyURL API token (raw, or
  `{"token":"..."}`). The token is sent only as `Authorization: Bearer ...` to
  the fixed `https://api.tinyurl.com` origin.
- `stateDir`: real private directory (0700) holding durable operation records,
  mutation barriers and bulk state.
- `timeoutMs`: optional request deadline, 100-4000 ms; default and maximum is
  4000 ms.

`tinyurl_status` reads only and creates nothing; it also reports
`mutationBarrierCount` and `bulkBarrierPresent` so operators can see whether an
ambiguous write needs reconciliation. The MCP transport accepts at most 64 KiB
per request and queues at most 32 requests.

## Tools and permissions

| Tool | Official endpoint | TinyURL token permission |
| --- | --- | --- |
| `tinyurl_create` | `POST /create` | Create TinyURL |
| `tinyurl_read` | `GET /alias/{domain}/{alias}` | Read TinyURL |
| `tinyurl_update` | `PATCH /update` | Update TinyURL |
| `tinyurl_change_destination` | `PATCH /change` | Update TinyURL |
| `tinyurl_delete` | `DELETE /alias/{domain}/{alias}` | Delete TinyURL |
| `tinyurl_archive` | `PATCH /archive` | Archive TinyURL |
| `tinyurl_set_expiration` | `PATCH /update` | Update TinyURL |
| `tinyurl_analytics_report` | `GET /analytics/timeline`, `/general`, `/popularity/weekday`, `/popularity/hour`, `/sources/top`, `/languages/top`, `/location/{region}` | Analytics |
| `tinyurl_analytics_raw_logs` | `GET /analytics/raw/json` | Analytics |
| `tinyurl_analytics_status` | `PATCH /analytics/status` | Update TinyURL / analytics settings |
| `tinyurl_analytics_sharing` | `PATCH /analytics/sharing` | Update TinyURL / analytics settings |
| `tinyurl_bulk_create` | `POST /bulk` | Bulk Requests |
| `tinyurl_bulk_status` | `GET /bulk/{bulkRequestId}/status` | Bulk Requests |
| `tinyurl_bulk_report` | `GET /bulk/{bulkRequestId}/report` | Bulk Requests |
| `tinyurl_status` | none | none |

Permissions are configured on the TinyURL API token; the connector does not
request or broaden them. Features such as analytics, expiration, archive and
bulk remain subject to the account plan and token permissions.

## Contract

All operations are bound to the fixed `tinyurl.com` domain. `alias` is always the
bare alias (1-30 letters, digits, `_` or `-`); `domain` may be supplied only as
`tinyurl.com`. Analytics alias scope is sent as the documented
`tinyurl.com/{alias}` query value. The connector never accepts a full URL as an
alias.

Provider responses are read with a 4 MiB byte ceiling. List and report outputs
are explicitly capped, and oversized bodies fail as `response_too_large`; they
are never copied into errors or logs.

### CRUD and expiration

`tinyurl_create` accepts `url` (required, absolute http/https, sent byte-for-byte
including query), `domain` (optional; only `tinyurl.com`), `alias` (optional) and
`expires_at` (optional ISO 8601 date-time, ISO 8601 duration or `null`). The
operation key includes the URL, domain, alias and expiry, so a different expiry
is never served from an old create receipt.

`tinyurl_read` returns the verified destination and documented alias fields,
including `archived`, `tags`, `expiresAt`, `createdAt` and analytics settings,
with tag output capped.

`tinyurl_update` accepts `new_alias`, `new_stats`, `new_tags`, `new_expires_at`
and `new_description` only; it never accepts a destination URL. When an expiry
is changed, the connector verifies the returned `expires_at` or performs one
read-only alias lookup to confirm it. A duration expiry is accepted when the
provider returns a future absolute expiry.

`tinyurl_set_expiration` sends exactly `domain`, `alias` and `new_expires_at` to
`PATCH /update`, using the same verification. Use `null` to clear expiration.

`tinyurl_change_destination` sends exactly `domain`, `alias` and `url` to
`PATCH /change` and verifies the exact new URL.

`tinyurl_delete` sends `DELETE /alias/{domain}/{alias}` (the OpenAPI v2.4.2
delete operation; there is no `/delete` endpoint).

### Archive

The vendor `PATCH /archive` body contains only `domain` and `alias`; the endpoint
toggles archive state. `tinyurl_archive` makes that explicit:

- `action: "toggle"` reads the current state, sends exactly one toggle and
  verifies the state flipped.
- `action: "archive"` or `"unarchive"` reads first and sends the toggle only
  when a change is needed, so repeats are idempotent.

There is no documented desired-state field to send, so the connector never
invents one. A missing `archived` in the write response triggers one read-only
verification lookup.

### Analytics reports and sharing

`tinyurl_analytics_report` requires `report` and `from`. `report` is a fixed enum:
`timeline`, `general`, `weekday`, `hour`, `top_sources`, `top_languages` or
`location`. `to`, `alias`, `domain` and `tag` are optional; `interval` is valid
only for `timeline`; `region` (`world` or a two-letter ISO country code) is valid
only for `location`. The connector rejects parameters that the selected vendor
endpoint does not accept.

Timeline output is capped at 1000 points; other report datasets at 100 rows and
nested browser/OS/device children at 100 each. Weekday and hour reports must
contain exactly 7 and 24 integers. Every report returns a `bounded` summary with
`returned`, `total` and `truncated`.

`tinyurl_analytics_raw_logs` calls `GET /analytics/raw/json` with the documented
`from`, `to`, `alias` and `tag` filters. The provider has no pagination
parameters, so `offset` (0-50000) and `limit` (1-1000, default 100) bound the
returned page locally. The response includes `total`, `returned`, `hasMore` and
`nextOffset`. A provider response with more than 50000 rows is refused as
`response_too_large`; narrow the date range. Raw log fields are projected to the
documented schema.

`tinyurl_analytics_status` and `tinyurl_analytics_sharing` send exactly
`domain`, `alias` and `enabled` or `public` to their fixed endpoint. If the
response omits the setting, one read-only alias lookup verifies it.

### Bulk requests

`tinyurl_bulk_create` accepts 1-100 typed items. Each item is one of the six
documented variants:

- `create`: `url` required; `domain`, `alias`, `tags`, `expires_at`,
  `description` optional.
- `update`: `alias` required; at least one of `new_alias`, `new_stats`,
  `new_tags`, `new_expires_at`, `new_description`.
- `change`: `alias` and `url`.
- `delete`, `archive`, `unarchive`: `alias`.
- Every item may carry up to 20 string, number or boolean `metadata` values.

Fields are checked against the selected variant, so an unknown field or a
missing required field is rejected before any request. `domain` is fixed to
`tinyurl.com`; `new_domain` is not accepted.

Bulk is the only write surface with a process-wide crash barrier:

1. The connector serializes bulk submissions with a private filesystem lock.
2. It writes `bulk/barrier.json` with the canonical payload hash before sending
   `POST /bulk`, and writes per-alias mutation barriers for every known affected
   alias.
3. A verified success records `bulk/receipts/{payloadHash}.json` with the
   returned `bulkRequestId`, then clears the barriers.
4. A timeout, network failure, unreadable response, 5xx or crash leaves the
   barrier. Every later bulk submission is refused with
   `write_outcome_unknown`; creates and mutations for the known affected aliases
   are also refused by their per-alias barriers.
5. If the provider accepted the batch but the process crashed before clearing the
   barrier, the durable receipt lets the next identical call recover the stored
   `bulkRequestId` with `reused: true` and clear the barrier.
6. An exact repeat of a verified payload returns the stored receipt without a
   second `POST /bulk`.

To recover a genuinely ambiguous bulk write, the operator must reconcile the
batch in the TinyURL account (there is no documented bulk list endpoint), then
remove the private `bulk/barrier.json` and the corresponding
`mutations/*.json` alias barriers. Do not remove them merely to retry blindly.
A successful batch remains subject to asynchronous processing; use
`tinyurl_bulk_status` and `tinyurl_bulk_report`.

`tinyurl_bulk_status` requires a positive integer `bulkRequestId`.
`tinyurl_bulk_report` requires the same and accepts `offset` (0-100000) and
`limit` (1-500, default 100). Report rows are projected to the documented fields
and the response discloses `total`, `returned`, `hasMore` and `nextOffset`.

### Mutation barriers and create receipts

Before any archive, expiration, analytics-setting or alias mutation is sent, a
durable `pending` barrier is written for each exact affected alias. It is cleared
only after a verified success or a definite 4xx/provider rejection, and is
preserved on timeout, network failure, unreadable success, crash or any other
ambiguous outcome. No create or mutation writes to that alias until an operator
independently reconciles it and removes the private `mutations/*.json` marker.

Before any update, rename, destination change, archive, analytics toggle,
expiration change or bulk item touches an alias (both aliases on a rename), every
successful create receipt for that alias is marked `stale`. A later create
removes the stale receipt and performs a fresh provider write, so a dead,
archived or redirected link is never replayed from durable state. Exact-alias
filesystem locks serialize create and mutation operations within and across
processes. A create with an explicit alias refuses to run while its barrier
exists. A create without an alias compares the generated alias against durable
mutation events and withholds its link if a concurrent mutation touched that
alias.

The create operation key is SHA-256 over the exact URL, fixed domain, alias and
expiry. A successful record is reused on repeat. Within one process, identical
calls share one request; across processes an atomic exclusive pending receipt
ensures only one request is sent and the other waits briefly for its verified
result. A timeout, network failure, 5xx/3xx response, or unreadable/ambiguous API
response is recorded as `write_outcome_unknown` and is not retried
automatically. A 4xx response is an explicit `api_rejected` failure and is not
cached. Cached records that do not match the exact operation, destination,
alias, expiry or short-link shape fail `cache_mismatch` rather than returning a
wrong destination.

Provider response bodies are never copied into errors or logs. Official API
reference: [TinyURL OpenAPI v2.4.2](https://tinyurl.com/openapi/v2.json).

## Trust boundary

The host must prevent bots and callers from writing the config, token file,
connector code or state directory. Mode bits alone do not isolate processes that
share an OS user; mount configuration read-only or run the connector under a
separate identity.
