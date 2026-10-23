# Execution tools host

One stdio MCP host joins the deterministic execution modules:

- `read_execution_queue` and `read_execution_context`: existing read-only queue,
  conversation and assignment retrieval.
- `validate_handoff`: structured handoff checks and native call preparation.
- `track_existing_assignments`: native assignment reconciliation without dispatch.
- `record_execution_receipt`: independently observed, authenticated evidence.
- `inspect_todoist_progress` and `update_todoist_progress`: exact task snapshots
  and evidence-backed progress metadata with write/readback reconciliation.

There are no model calls. Tool availability does not prove that bots call the
right tool or that their business objectives are achieved. The existing independent
observer must continue; these tools do not replace it.

## Configuration

Register an absolute Node command and bundled script argument. Set only
`EXECUTION_TOOLS_CONFIG_FILE` to an absolute private host configuration file.
The host never accepts backend URLs, credentials or a signing key in tool input.
It never generates keys. Provision a persistent random signing key of at least
32 bytes before deployment; signing key and broker token files must be mode 0600
(or more restrictive). Do not place them or private evidence/receipt directories
beneath any allowed artifact root.

```json
{
  "appUrl": "http://127.0.0.1:8799",
  "queueUrl": "http://127.0.0.1:8798/review",
  "evidenceDir": "/data/.openmausbot/providers/execution-tools/queue-evidence",
  "receiptDir": "/data/.openmausbot/providers/execution-tools/execution-receipts",
  "progressReceiptDir": "/data/.openmausbot/providers/execution-tools/progress-receipts",
  "signingKeyFile": "/data/.openmausbot/providers/execution-tools/signing-key",
  "artifactRoots": ["/data/.openmausbot/task-workspaces/EXISTING_BOT_ID"],
  "allowedProjects": ["EXISTING_PROJECT_ID"],
  "brokerOrigin": "https://EXISTING_MANAGED_BROKER",
  "brokerTokenFile": "/data/.openmausbot/providers/execution-tools/broker-token"
}
```

The app and queue URLs default to the values shown. Other paths and project
scope are required. Root paths must exist. Evidence, execution receipts and
progress receipts must be separate directories. The key remains outside caller
artifact access, but this is not a security boundary against an actor that can
read host files or replace the host program.

The broker uses the existing managed connector and its existing `work` account;
no new provider login or direct Todoist token is introduced. Missing broker
configuration disables only the two Todoist progress tools. Queue retrieval,
handoff validation, tracking and receipt recording still work with valid signing
and source configuration. A wrong or missing signing key prevents evidence-backed
execution rather than inventing a successful receipt.

Configured project scope is checked before recording an execution receipt and
before any Todoist progress operation. These IDs constrain the host's capability;
they do not prove which bot made the call. Caller-supplied `botId`, task/objective
association and source version remain context, not independently authenticated
caller identity or semantic relevance.

## Joined evidence and update sequence

1. Record an actual baseline artifact or assignment observation with an existing
   task/objective/project identity. A first artifact snapshot remains unverified.
2. After genuine work, record a new operation identity. Changed artifact bytes or
   active native assignment state can support `in_progress`; returned prose,
   stopped work and baseline-only evidence cannot.
3. Inspect the current Todoist task to obtain its exact raw-task hash. The compact
   queue reader's normalized task hash is not interchangeable with this hash.
4. Call `update_todoist_progress` with the observation's operation ID in
   `evidenceIds`. The host authenticates the receipt and rereads its actual source
   before the write. It injects `recorder.verifyEvidence` directly into the updater;
   no caller assertion is used as an evidence verifier.
5. The updater preserves task fields, writes only its managed progress block and
   verifies exact readback. Its operation receipt is separate from the preceding
   evidence receipt, avoiding a circular readback requirement.

The currently implemented evidence sources support only `in_progress`. Other
states require independently verified adapters not supplied here; do not infer
`waiting_user`, holds or acceptance from conversation prose. Artifact changes
prove activity only. Stops, incomplete sources, receipt tampering and changed
source bytes cannot become verified progress through this host.

Native job reads use fixed routes, bounded response bodies, timeouts and disabled
redirects. The module validators check completeness and stable readback. Existing
queue pages and full private evidence retain their explicit coverage limits.
Receipt results are compact summaries; full immutable records remain private.
No source assignment, artifact, approval, task completion or external message is
mutated by the host. Only the explicit progress-update tool edits Todoist metadata.
The provider still lacks a demonstrated atomic conditional-write primitive; the
updater's preflight hash is not provider compare-and-swap.

## Build and verification

```sh
node deploy/execution-tools/build.mjs /absolute/output/execution-tools-mcp.cjs
node --experimental-strip-types --test deploy/execution-tools/host.test.ts
```

The default build output is `deploy/local/execution-tools-mcp.cjs`; shared build,
ignore and Docker wiring belong to root integration. The managed connector
transport is separated from the Legal queue CLI so bundling does not pull in
CLI execution or top-level await.

Five joined fixture tests pass. They run real loopback HTTP queue/job/connector
sources and temporary artifacts/credentials/receipts, exercise baseline → changed
artifact → authenticated receipt → task update → exact readback, and verify
stopped receipts, invalid keys, forbidden caller flags, project bounds and absent
progress credentials. A bundled stdio process exposes all seven tools and runs
an inspection through the same provider fixture without writes. Seven existing
Legal transport/queue tests passed after extracting the import-safe transport.
Strict targeted TypeScript, lint and the bundle build pass.

These tests establish the composed module and actual MCP framing, not live app
selection, source deployment, bot adoption or business outcomes. Root owns the
isolated application registration/selection check, private configuration,
independent review and deployment. No live tasks, bot sessions, model settings
or user files were changed during these tests.
