# Execution tools host

One stdio MCP host joins the deterministic execution modules:

- `read_execution_queue` and `read_execution_context`: read-only Positron Tasks
  queue, conversation and assignment retrieval.
- `validate_handoff`: structured handoff checks and native call preparation.
- `track_existing_assignments`: native assignment reconciliation without dispatch.
- `record_execution_receipt`: independently observed, authenticated evidence.

Bots record task progress through their own Positron Tasks MCP; this host writes
no task records.

There are no model calls. Tool availability does not prove that bots call the
right tool or that their business objectives are achieved.

## Configuration

Register an absolute Node command and bundled script argument. Set only
`EXECUTION_TOOLS_CONFIG_FILE` to an absolute private host configuration file.
The host never accepts backend URLs, credentials or a signing key in tool input.
It never generates keys. Provision a persistent random signing key of at least
32 bytes before deployment; the signing key file must be mode 0600 (or more
restrictive). Do not place it, the task credential file or private
evidence/receipt directories beneath any allowed artifact root.

```json
{
  "appUrl": "http://127.0.0.1:8799",
  "tasksOrigin": "http://positron-mcp:8080",
  "tasksConfigFile": "/data/.openmausbot/config.json",
  "tasksServer": "positron-tasks-bill-lumbergh",
  "evidenceDir": "/data/.openmausbot/providers/execution-tools/queue-evidence",
  "receiptDir": "/data/.openmausbot/providers/execution-tools/execution-receipts",
  "signingKeyFile": "/data/.openmausbot/providers/execution-tools/signing-key",
  "artifactRoots": ["/data/.openmausbot/task-workspaces/EXISTING_BOT_ID"],
  "allowedProjects": ["EXISTING_DEPARTMENT_ID"]
}
```

The app URL and the three task-source settings default to the values shown.
Other paths and project scope are required. Root paths must exist. Evidence and
execution receipts must be separate directories. The key remains outside caller
artifact access, but this is not a security boundary against an actor that can
read host files or replace the host program.

The queue reads `GET /api/v1/tasks` and `GET /api/v1/tasks/{id}` from Positron
Tasks with the bearer credential of the named `mcpServers` entry in
`tasksConfigFile`. That entry's URL must have the same origin as `tasksOrigin`.
The credential is never accepted from tool input. A missing or mismatched entry
makes the queue a source failure; handoff validation, tracking and receipt
recording still work. A wrong or missing signing key prevents evidence-backed
execution rather than inventing a successful receipt.

Configured project scope (Positron Tasks department IDs) is checked before
recording an execution receipt. These IDs constrain the host's capability;
they do not prove which bot made the call. Caller-supplied `botId`, task/objective
association and source version remain context, not independently authenticated
caller identity or semantic relevance.

## Evidence sequence

1. Record an actual baseline artifact or assignment observation with an existing
   task/objective/project identity. A first artifact snapshot remains unverified.
2. After genuine work, record a new operation identity. Changed artifact bytes or
   active native assignment state can support `in_progress`; returned prose,
   stopped work and baseline-only evidence cannot.
3. Cite the receipt when updating the task through Positron Tasks.

Artifact changes prove activity only. Stops, incomplete sources, receipt
tampering and changed source bytes cannot become verified progress through
this host.

Native job reads use fixed routes, bounded response bodies, timeouts and disabled
redirects. The module validators check completeness and stable readback. Existing
queue pages and full private evidence retain their explicit coverage limits.
Receipt results are compact summaries; full immutable records remain private.
No source assignment, artifact, approval, task record or external message is
mutated by the host.

## Build and verification

```sh
node deploy/execution-tools/build.mjs /absolute/output/execution-tools-mcp.cjs
node --experimental-strip-types --test deploy/execution-tools/host.test.ts
```

The default build output is `deploy/local/execution-tools-mcp.cjs`.

The fixture tests run real loopback HTTP Positron Tasks, job and conversation
sources with temporary artifacts, credentials and receipts. They cover baseline
and changed artifacts, authenticated receipts, stopped assignments, invalid keys,
forbidden caller flags, project bounds, rejected Todoist-era settings and the
credential sent to the task source. A bundled stdio process exposes the five
tools and runs a queue read through the same fixture.

These tests establish the composed module and actual MCP framing, not live app
selection, source deployment, bot adoption or business outcomes.
