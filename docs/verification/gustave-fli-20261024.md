# Gustave Fli installation, 24 October 2026

Installed the reviewed `punitarani/fli` commit
`881aee5ff4321e81ea2157cb44be94ce6a21dc1b` in a persistent Python 3.11 venv,
with hashed locked dependencies and the narrow adapter in `deploy/fli`.
The live app discovered exactly `find_airports`, `search_flights`, and
`search_dates`; only Gustave selected the new `fli-research` server. His prior
server selection and model were preserved. He was idle during installation.

Installed and enabled `fli-flight-research`; updated `travel-fulfilment` and
SOUL to use flight research before browser discovery while preserving explicit
Perk requests, existing booking channels and the separate purchase boundary.
Source, skill, SOUL and selection were read back. The deployment token was
revoked. No bot was interrupted or sent a synthetic task.

## Verification

- Upstream MCP/core suite: 367 offline passes; 18 live cases deselected.
- Adapter: five tests passed for unsupported constraints, date bounds,
  evidence/error preservation, concurrent calls and lock recovery.
- Isolated real-app fixture: MCP discovery, explicit bot selection, enabled
  skill installation and exact readback. Final log:
  `/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792863733967-72753.log`.
  The fixture closed cleanly.
- Read-only Docker MCP canary: Tallinn airport resolved to TLL; a TLL–HEL
  nonstop search for 10 November 2026 returned six EUR results with itinerary
  links at 17:40:25 UTC. No user browser, account or booking was involved.

This proves installation and one current search, not future upstream
availability or complete fare coverage. Unsupported baggage, basic-economy and
emissions filters are rejected. Booking-options transport is not exposed.
No booking or payment was made.

## Receipt

Installed at `2026-10-24T17:41:37.464Z`.

Adapter SHA-256: `250831667768c3c5b04bb5666224e9c2b56533fbfd7523ca09fe8ae0b74d5666`.

- fli-flight-research: `10d6106141bbc5d5605e89c29aa9453bc94bca112be4af63b35e824754aef54a`; enabled.
- travel-fulfilment: `79ddf7daa36a24b87a0170dddb067c17510dc945697407839649f1de0bd5e66c`; enabled.

Runtime release and private rollback are under
`/data/.openmausbot/providers/fli/releases/881aee5ff432-v1`.
The source integration is separate from the unchanged app Docker image.
