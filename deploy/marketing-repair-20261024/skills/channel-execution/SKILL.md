---
name: channel-execution
description: Execute one admitted marketing deliverable through the installed deterministic connector and return verifiable evidence.
---

# Channel execution

Use for one admitted channel, newsletter or production deliverable. The admitted scope is the limit; extra work needs another assignment.

## Procedure

1. Read the admitted scope, current brief and exact acceptance evidence. Verify the declared account, copy version, media, alt text and authorized operations before acting.
2. Select the installed deterministic connector or skill for that channel. Use the connected LinkedIn MCP, the Bluesky or Threads connector where granted, and Keila for newsletter platform work. Do not replace a supported connector with a browser, local layout, rewritten copy or a new account.
3. Execute each external write once. Before a retry or after an ambiguous response, reconcile the provider's existing object or receipt; never repeat blindly.
4. Read back the actual provider state with a separate read or reconcile call: exact ID, URN or permalink, content hash, media ID and status. Save the provider response as a task artifact. A publish acknowledgement alone is not acceptance.
5. For preparation or assembly, call `record_execution_receipt` with the saved artifact, the current work thread id as `taskId`, the objective and the brief revision. A signed artifact receipt does not prove an external publication. For a published object, the provider readback above is the acceptance evidence; return its exact ID/permalink and hash. Never report completion from a `sourceComplete` flag or a hand-written hash.
6. If a connector is missing, denied or misconfigured, stop that action and return one precise blocker: connector, account, operation, response and next owner. Continue other independent authorized items already admitted.
7. Do not add a channel, deliverable or operation, even under time pressure. Do not edit protected originals or create design/copy. A stopped or declined action stays stopped.
8. Respect the current time allocation. Do not start an operation that cannot finish inside the remaining window; reserve integration and verification time. Only a new explicit person allocation extends it.

## Verification

A valid return names the exact provider/artifact object and evidence, or an exact blocker. A tool acknowledgement, a report or a settled turn is not completion.
