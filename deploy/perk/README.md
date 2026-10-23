# Scoped Perk travel connector

This stdio MCP wraps the official Perk MCP with a travel-only allowlist. It retrieves exact authenticated argument schemas, validates every call, bounds result pages, and journals preparation requests so an interrupted search cannot be silently replayed. It performs no model calls or browser actions.

## Current qualification

Public primary documentation was reviewed on 2026-10-23:

- [MCP tools reference](https://developers.perk.com/docs/perk-mcp-tools-reference) supplies the exact operation names and behaviors.
- [Security and data handling](https://developers.perk.com/docs/perk-mcp-security-and-data-handling) states that searches can create draft trips, checkout remains human, and the server cannot pay, modify or cancel confirmed bookings.
- [Authentication](https://developers.perk.com/docs/authenticate-with-the-perk-mcp-server) describes OAuth authorization-code/PKCE, dynamic client registration, role/plan restrictions, and one-hour access tokens.
- [Rate limits and errors](https://developers.perk.com/docs/rate-limits-and-errors-in-perk-mcp) describes throttling and human-readable tool errors without a stable error-code catalog.

Unauthenticated `initialize` at `https://mcp.perk.com/api/mcp/mcp` returned HTTP 401 with `resource_metadata="https://mcp.perk.com/.well-known/oauth-protected-resource/api/mcp/mcp"`. Public docs do not supply argument JSON schemas. No authenticated schema, account entitlement, actual travel result or checkout link has been qualified. Tests use explicitly synthetic schemas and responses; they do not establish live Perk compatibility. The wrapper refuses unknown tools and unsupported schemas instead of inventing parameters.

## Tools

| Tool | Outcome |
| --- | --- |
| `perk_status` | Authenticate and discover travel capabilities; no travel search. |
| `perk_contract` | Return the exact current input schema, hash and effect class for one operation. |
| `perk_read` | One validated trip, policy, identity, place or existing-search lookup. |
| `perk_prepare` | One validated search, rate retrieval/selection or deeplink preparation, with durable operation ID. |
| `perk_result` | Page stored evidence without another Perk request. |

Expense tools, invoice tools, approval tools, organization user search and inferred-nationality visa checks are deliberately outside this connector's scope. `hotels_start_hotel_search` always creates a new trip according to Perk; it is never classified as read-only. Rate starts, inbound train searches and deeplink generation are conservatively classified as preparation too.

## Host setup

Build with `node deploy/perk/build.mjs`; the default output is `deploy/local/perk-mcp.cjs`. An optional first argument overrides the output path.

Copy `config.example.json` into a host-private directory outside repository, workspace artifacts and returned evidence. Use absolute paths, config/token file mode 0600, evidence directory mode 0700. Register the stdio command as an absolute Node executable plus the absolute built bundle path. Set only `PERK_CONNECTOR_CONFIG=/absolute/private/config.json` in its MCP environment; never place bearer tokens in arguments, configuration supplied to bots, or logs.

The standalone private token file is JSON:

```json
{"access":"OAUTH_ACCESS_TOKEN","expiresAt":1792792800000}
```

`expiresAt` is Unix epoch milliseconds and must be more than 30 seconds in the future. The file is reread for every request. This module does not implement OAuth enrollment or independently refresh a native app's shared tokens. `PerkConnector(config, {credentialProvider})` and `serve({configPath, credentialProvider})` accept a host-owned async zero-argument provider returning the same shape. The app OAuth manager must own enrollment and refresh. Do not race separate refresh writers. Use one account per evidence directory and keep that account binding stable.

Set `allowDrafts:true` only when travel preparation is authorized for this deployment. The default false still allows authenticated identity, policy and existing-trip discovery. `sourceRef` records the originating request; it is audit context, not an approval token. No wrapper tool purchases or approves expenses.

The native broad Perk MCP registration used for OAuth should remain disabled/unselected for bots; expose only this connector. Required account scopes include `user:read`, `trip:read`, and `trips:write` for preparation; policy lookup additionally needs `my-travel-policy:read`. OAuth client redirect acceptance, scopes, account role and plan qualification remain installation work.

## Execution semantics

Every request has one 25-second provider budget including initialization/discovery, followed by at most two seconds for session cleanup. Remote bodies are limited to 2 MiB, individual argument schemas to 24 KiB, catalogs to eight pages, and result pages to 6,000-character evidence fragments with an explicit next offset. HTTPS requests target the fixed official endpoint and disallow redirects. No automatic provider retries occur. A caller may retry safe reads after a suitable delay; an unknown preparation must be reconciled first.

`perk_prepare` writes and fsyncs a private `pending` receipt before dispatch. Concurrent or restarted calls with the same operation ID return that receipt, never redispatch; changed arguments or source references conflict. IDs are unique within the account evidence directory. Transport failures and tool-level preparation errors become `unknown` because vendor errors do not prove the absence of a draft. A process crash may leave `pending`; its meaning is also uncertain. Neither state expires into automatic retry.

`provider_returned` records an upstream reply, not verified prices, a confirmed reservation or a successful business outcome. Provider output is preserved exactly in private evidence; agents must extract facts and returned URLs, never synthesize checkout links. The connector cannot yet normalize live offer schemas because those schemas require authenticated qualification. Receipt deletion permits reuse, so do not delete receipts for operations still subject to retry or reconciliation.

Structured blockers include `auth_missing`, `auth_expired`, `auth_required`, `account_scope_role_or_plan_denied`, `rate_limited`, `draft_preparation_disabled`, `schema_changed`, `provider_arguments_invalid`, `operation_id_conflict`, and `unsupported_provider_schema`. `perk_result` works without current OAuth and supplies the receipt after interruption.

## Verification

```sh
node --test deploy/perk/connector.test.mjs
node deploy/perk/verify-app.mjs
```

The unit/integration suite uses temporary private directories and synthetic providers. It covers actual RemoteMcpClient serialization, bundled stdio initialization/discovery/auth failure, contract validation, travel-only scope, private files, bounded evidence, token rereads, concurrent and restart replay, unknown outcomes and secret-free errors. `verify-app.mjs` launches the repository's isolated fake-engine app, runs Doctor, registers the built connector and checks its real MCP probe. It does not touch the user's app, browser, credentials or live travel data.

The proposed Gustave skill is `skills/perk-travel-options/SKILL.md`. Installation and bot tool selection are separate from this module. Once OAuth is connected, qualify identity/policy and representative schemas first; run any draft-creating travel acceptance only for an actual authorized request. Preserve its operation IDs and verify exact returned checkout links before declaring the business capability working.
