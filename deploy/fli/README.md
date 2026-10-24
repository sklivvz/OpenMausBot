# Gustave flight research

Reviewed upstream: `punitarani/fli`, commit
`881aee5ff4321e81ea2157cb44be94ce6a21dc1b`, package `flights` 0.10.0,
MIT. `upstream.json` records source and build hashes; `requirements.lock` pins
and hashes the MCP runtime dependency set exported from that commit's lock.
The upstream license is retained in `LICENSE.upstream.txt`.

## Integration

`research.py` exposes only `find_airports`, `search_flights`, and `search_dates`
over stdio. It uses the pinned upstream request models and executors. Those are
private library interfaces: review this adapter and rerun its checks before
upgrading the source revision.

The adapter rejects unsupported baggage/basic-economy/emissions filters instead
of silently dropping them; uses explicit EUR searches; labels an unknown
response currency XXX instead of assigning it EUR; returns six results; bounds
a date sweep to seven days and a round trip to five outbound candidates (three
by default); permits one active search per MCP process and three provider worker
threads; and sets a 15-second per-request timeout. Upstream has its own retries,
so that is not a 15-second whole-search deadline. Multiple MCP processes do not
share the in-process lock. Provider price, itinerary links, errors and retryable
status are preserved with observation time and known fare limitations.

No booking or payment operation is exposed. The upstream `get_booking_options`
transport is currently unavailable and is deliberately absent. Multi-city
through-ticket search and complete child/infant fare coverage are not established.
The current transport fetches Google's public search page, not a browser or an
authenticated airline API. Provider changes can break it.

The supplied skill replaces upstream's installation/Claude Desktop tutorial with
Gustave's research workflow. `travel-fulfilment` removes the old Nicobar name and
routes flight discovery to this MCP while retaining explicit booking channels,
Donna's coordination and the existing purchase boundary.

## Installation

Use an isolated venv at an absolute persistent release path. Do not change the
app's system Python, browser, model, schedules or other bots' tool selections.
Build the wheel from the pinned source using `uv build --wheel`; verify it
against `upstream.json`. Create the venv with the container's Python, install
`requirements.lock` using `uv pip install --require-hashes`, then install the
reviewed wheel with `--no-deps`. Plain `pip install flights` lacks the optional
MCP dependencies required by the upstream entrypoint.

Register `fli-research` with the absolute venv Python as `command` and the
absolute `research.py` path as its sole argument. Use stdio and an 8000 result
budget. The creation endpoint saves new registrations disabled: explicitly PATCH
`/api/mcp/servers/fli-research` with `{ "enabled": true }` and read back
`enabled:true`. Select it only in Gustave's explicit `mcpServers` selection. Install the
two skills through the app's skill-template lifecycle and apply the exact
`gustave-routing.json` replacement after checking the current SOUL. Preserve
existing model, tools and task state. Read back all changes while the bot is idle.

The live release path is
`/data/.openmausbot/providers/fli/releases/881aee5ff432-v1`.
It includes the venv, adapter, dependency lock, wheel, upstream metadata, skill
and private deployment/rollback receipts. It survives app-container replacement
on the existing data volume and uses `/usr/bin/python3` from that runtime.
A future image changing its Python ABI requires rebuilding the venv.

## Verification

With the pinned dependencies installed in an isolated interpreter:

```sh
/path/to/venv/bin/python -m unittest discover -s deploy/fli -p 'test_*.py'
FLI_VERIFY_PYTHON=/path/to/venv/bin/python node --experimental-strip-types deploy/fli/verify-app.mjs
```

The five adapter tests cover filter rejection, query bounds, evidence/error
preservation and concurrency/error recovery. The app fixture verifies exact MCP
discovery, bot selection, skill import and readback without live business data.
The upstream MCP/core suite passed 367 offline tests (18 live cases deselected).

A separate unauthenticated read-only MCP probe in Docker on 24 October 2026
resolved Tallinn to TLL and returned six nonstop TLL–HEL results for 10 November
2026, all labelled EUR, with per-itinerary links. It did not use a browser,
change a cart, create a trip or reserve/buy a ticket. This qualifies that sampled
search and runtime path, not all airports, dates, fare terms or future provider
availability. Deployment is recorded in `docs/verification/gustave-fli-20261024.md`.

Rollback removes Gustave's fli skill and MCP selection, restores the saved travel
skill and SOUL only after reconciling subsequent changes, removes the new MCP
registration, and then removes this release when no process uses it. The paired
installation token is revoked after deployment; no provider credential exists.
