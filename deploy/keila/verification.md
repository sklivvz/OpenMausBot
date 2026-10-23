# Keila adapter verification — 2026-10-23

## Deterministic fixture

`node --test deploy/keila/bridge.test.mjs`: 13 passing cases. Synthetic campaign
and template mutations go only to a temporary loopback HTTP server and temporary
artifact/receipt directories. Cases cover exact readback, idempotent replay,
lost response, sent/scheduled/unknown/held campaigns, changed source and resource
hashes, unknown slots, forbidden send fields, compact inventory, bounded
pagination, redirect credential isolation, source-preserving template creation,
prior-state receipts, exclusive write locks and disabled writes.

`node deploy/keila/build.mjs`: bundled stdio MCP successfully.
`oxlint --deny-warnings deploy/keila scripts/build-local-tools.mjs`: passed.

## Isolated OpenMaus fixture

Started through `node --experimental-strip-types scripts/control-omb.ts launch`.
The launcher used temporary data and the repository fake engine. Registered the
bundle through `POST /api/mcp/servers` and probed via
`POST /api/mcp/servers/keila-drafts/test`; probe returned exactly:

- `keila_inventory`
- `keila_snapshot`
- `keila_prepare`

Patched the fixture bot's `mcpServers` to `['keila-drafts']`, then reread its record
and confirmed the assignment. Installed newsletter-platform-production through
`POST /api/bots/:id/skill-template`, then confirmed exact text through its skill
GET route. No bot turn or live app mutation was used to verify these mechanics.

## External connection (read-only business data)

Created one separately named, revocable Keila project API key through a separate
HTTP login using the executor's existing saved credential. No user browser was
opened. Authentication and read-only inventory of templates/campaigns/senders
returned HTTP 200. No campaign/template mutation, send, test email, schedule,
delete, subscription change or audience modification occurred.

The key creation form has only a name field: the actual provider scope is the
whole project API, including operations this MCP does not expose. The private
key is stored mode 0600 in the existing backup-excluded `providers` directory.
Its value has not appeared in tool output, source control or model arguments.

This verifies access and schemas, not a real draft upload or rendered visual
quality. No synthetic content was written to the real provider.

## DeepSeek through Codex compatibility

Container Codex CLI 0.163.0 accepted an isolated invocation with command-line
provider overrides, `wire_api="responses"`, `deepseek-flash` and
`model_reasoning_effort="max"`, against `https://api.deepseek.com`. A no-tools
classification prompt completed in 3.7 seconds, exit 0, returning the requested
JSON. Its saved auth/config was unchanged; the provider key was supplied only
through the child process environment and the temporary result file removed.
This is a compatibility check, not an executor quality benchmark.

Reported usage for this harness invocation was 110,389 input, 35 output and 14
reasoning output tokens. That substantial input overhead means a cheaper model
alone is not enough: keep these API operations deterministic and limit executor
context. No inference model is called by the Keila MCP itself.

## Remaining deployment

Root agent reviews/integrates the commit and deploys without interrupting active
bots. Install the bundle, private config and README as the skill's `API.md`;
register/assign MCP to Liz, preserve existing MCP assignments and current skill
corrections, then perform only read-only live smoke checks. The current reusable
master and historical/current held or sent campaign IDs must be in protectedIds.
The first authorized real preparation supplies business validation; do not
manufacture a live campaign just to test the adapter.
