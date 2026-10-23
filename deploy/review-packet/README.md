# Actionable review packets

`prepare_review_packet` replaces repeated link assembly, file/version checking
and missing-deliverable checks with code. It reads an existing decision message
and its artifacts, then produces a compact packet with the exact question,
supported links, artifact versions/hashes and explicit evidence gaps. It makes
no model calls and sends no messages. It neither edits artifacts nor changes a
task, approval or publication state.

## Contract

The input identifies the task, brief revision, exact decision question, source
message, required artifact identities and each artifact's expected version/hash.
Sources contain `botId`, `threadId` and `messageId`. The tool verifies ownership
against `/api/bots?messages=0`, retrieves each exact message through the supported
`around` query, and requires the decision question to occur in the stored text.
It does not interpret whether the question is a sensible business decision.

Artifact targets are either:

- `{ "kind": "message_file", "path": "proposal.pdf" }`: read the existing
  message-scoped file endpoint and compare SHA-256 of the returned bytes. This
  endpoint uses POST for a read, enforces message references and workspace roots,
  and changes no stored data. The packet links the source conversation where
  the app already provides the file, rather than inventing a generic file URL.
- `{ "kind": "external", "url": "https://native-provider/..." }`: require
  the exact HTTPS URL in the source text. Todoist, credentials, unsafe schemes
  and unobserved destinations fail. This tool does not fetch external URLs;
  access and native version identity remain unknown. A retrieved link alone
  never proves that the user can open it.

The decision message must contain each artifact or its exact source-conversation
or native link. A folder path, task link, promise to create a file, or missing
question cannot become mechanical readiness. App conversation links use the
existing `threadRefUrl`; there is no invented message anchor or approval button.

Optional `verificationReceipts` accept the assembled-output verifier v1 schema.
Artifact identity, version and both hashes must match. Failures and unknown
rendering/reachability checks survive into the packet. Receipt provenance is
caller-supplied; matching a hash does not authenticate the supplied receipt.

## Results and scope

- `incomplete`: at least one mechanical failure.
- `needs_review`: no mechanical failure, but evidence remains unknown.
- `mechanically_ready`: the supplied contract's checks passed. This is not
  semantic completeness, editorial acceptance or publication approval.

The output retains usable links and formatted Markdown even when a destination
or external artifact remains unknown. It does not hide links behind an approval
flow. `canMarkWaitingUser` is always false: this tool does not perform delivery,
verify every user-access constraint, or enforce the runtime state transition.
The state owner must establish actual delivery and any remaining checks before
setting a user dependency. Root integration must consume this result; a tool
definition alone cannot prevent a bot from making an unsupported status claim.

The app's `bot.threadId` is the currently selected conversation, not independent
proof that a human received work. The host can provide known user-facing
destinations from the actual request context through `reviewDestinations`.
Otherwise the destination check stays unknown. This does not require a new user
approval. Stored evidence is re-read each invocation, and packet receipts carry
a 30-minute expiry. `packetFreshness` rejects expired/future/overlong receipts;
callers must also invalidate receipts when artifact or brief versions change.

## Installation

Build with `node deploy/review-packet/build.mjs`. The generated bundle is
`deploy/local/review-packet-mcp.cjs`. Install it with an absolute MCP command and
set `REVIEW_PACKET_APP_URL` to the existing app origin when different from
`http://127.0.0.1:8799`. The app reserves the `OMB_` environment prefix, so the
MCP uses its own prefix.

Optional `REVIEW_PACKET_DESTINATIONS_FILE` points to a host-maintained JSON array
of `{ "botId": "...", "threadId": "..." }`. This provides destination
provenance only; it grants no editing/sending authority. Consumers embedding
`createReviewPacket` can supply destinations directly from the genuine request.

Root owns shared build/Docker registration, the generated-bundle ignore entry and live deployment. This branch
changes only `deploy/review-packet`; it does not alter existing bot selections,
skills, server routes or deployment files.

## Verification — 23 October 2026

Ten isolated tests pass:

```sh
pnpm exec vitest run --config deploy/review-packet/vitest.config.ts
```

Tests cover exact file bytes, absent required artifacts, duplicate identities,
missing questions, changed versions, inaccessible files, wrong conversation
ownership, unestablished user destinations, missing delivery links, unsafe/task
URLs, external access uncertainty, assembled receipt mismatch/unknown checks,
and expired receipts. Strict targeted TypeScript, lint and bundle build pass.

A real isolated app launched through `control-omb launch` at
`http://127.0.0.1:20334` generated a fake-engine decision message linking a
synthetic workspace file. The verifier fetched that exact message and downloaded
the file through the real message-file route. Exact bytes returned
`mechanically_ready` with configured destination evidence; missing destination
evidence returned `needs_review`; the wrong expected hash returned `incomplete`.
The real MCP registration/probe exposed only `prepare_review_packet`, and bot
selection readback matched. The fixture used no user files or live accounts.

Private evidence is `.omb-scratch/verification.json`; the fixture log is
`openmausbot-verification-evidence/server-1792781694060-20812.log` in the system
temporary directory. Live user visibility and actual decision delivery are not
proven by these synthetic checks. No live token savings are claimed.
