# Legal queue

This local service exposes four MCP tools for Todoist project
`6hjrcrRM8XH9hVJQ`, using the existing managed connector's `work` account:

- `legal_queue_snapshot`: collect all upstream pages, then return five tasks
  per response. Continue with `nextCursor` until `complete` is true.
- `legal_queue_progress`: preserve original instructions and deadlines; require
  a fresh `expectedUpdatedAt`, owner, state, next action and evidence.
- `legal_queue_add`: require a source and scope; check source/title duplicates.
- `legal_queue_complete`: require acceptance and evidence; reject recurring
  tasks and tasks with open children, then verify the task is no longer open.

Every mutation reads back its result. A timeout does not establish failure:
read current state before retrying. Todoist does not expose a compare-and-swap
write through this connector; timestamp checks and readback reduce conflicting
writes but cannot eliminate a concurrent external update during the write.

The service listens on container loopback `127.0.0.1:8797`, sharing Caddy's
network namespace. No host port or Caddy route is published. Browser origins
are rejected. Connector credentials stay in the service environment. There is
no arbitrary tool, project, account, email or shell execution endpoint.

The MCP URL is `http://127.0.0.1:8797/mcp`. The command client uses `/queue`
when connector credentials are absent. Both interfaces share the same checks.
Verified service writes are logged in `/state/queue-events.jsonl` on the
`legal-queue-state` Docker volume. The command client can also use the managed
connector directly in an administrative environment; those receipts are saved
beside the command file.

## Installation

The local Compose override includes `compose.legal-queue.yaml`. Initialize the
state volume once, then start only this service:

```sh
docker compose run --rm --no-deps --user 0:0 --cap-add CHOWN --entrypoint node legal-queue -e 'require("node:fs").chownSync("/state",1001,1001)'
docker compose up -d --no-deps legal-queue
```

The running service has all capabilities dropped, a read-only filesystem and
restart enabled. Only its receipt volume is writable. Application restarts
are unnecessary. The service source is a read-only bind mount.

Register the MCP URL as `legal-queue` through OpenMaus's MCP settings and enable
it for Luis. The scoped command client remains usable in an existing bot
session before its MCP tool list refreshes. Luis's queue skill documents both
interfaces. No broker token needs to be copied into bot files or shell grants.

## Verification

```sh
node --experimental-strip-types --test deploy/legal-queue/queue.test.mjs deploy/legal-queue/server.test.mjs
```

Tests use synthetic tasks and an isolated HTTP server. They exercise OpenMaus's
actual MCP client, a credential-free command client, pagination, scope checks,
preserved history/dates, stale-write refusal, deduplication, completion checks
and browser-origin rejection. They do not evaluate legal reasoning.

The team deployment's private configuration backup, isolated application
fixture and receipts are in `.omb-scratch/legal-repair-20261021`. Restoring
configuration does not undo real Todoist progress or document work. To remove
this integration, restore Luis's prior skill/profile configuration, unregister
`legal-queue`, then stop the service. Preserve the receipt volume for audit.
