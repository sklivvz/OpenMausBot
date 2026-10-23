# Threads connector verification — 2026-10-23

No live accounts, browser sessions or external posts were used.

The synthetic HTTP suite exercises exact text/image/alt submission and read-back,
local preparation, missing/expired credentials, wrong account, disabled writes,
absent/changed/expired host grants, changed artifacts, image URL content drift,
root-escaping symlinks, conservative content bounds, interrupted creation and
publication, failed read-back, mismatched published text, processing/expired
containers and concurrent operation locks. A fresh connector reuses durable
receipts without duplicate writes. The stdio subprocess check performs real
JSON-RPC initialization, discovery and a structured missing-config call.

The actual OpenMausBot fixture was launched using:

```sh
node --experimental-strip-types scripts/control-omb.ts launch
```

It printed URL `http://127.0.0.1:20203`, child PID `27681`, temporary data directory
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verify-data-qYid9i`,
and persistent log
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792787099926-27662.log`.

Only that fixture's API was used to register `threads-fixture` through
`POST /api/mcp/servers` with the absolute Node executable, built bundle and a
nonexistent synthetic config path. `POST /api/mcp/servers/threads-fixture/test`
returned `ok: true` and all five expected tool names. Registration remained
disabled by the app, as expected for a new server.

A disposable bot `ee0fa74d-1577-44f7-a83b-b169d1c0a01c` was created with
`mcpServers: ["threads-fixture"]` and `toolScope.allow` containing exactly those
five `mcp:threads-fixture:threads_*` selectors. `GET /api/bots?messages=0` matched
both saved selections. The private JSON evidence is in the task worktree's
`.omb-scratch/threads-app-probe.json`. The launcher was interrupted with Ctrl-C,
which stopped its exact child and cleaned its temporary data.

This establishes stdio compatibility, real registry discovery and per-bot
selection persistence. It does not establish a live-model turn, deployed
credentials, production account grants, approval UI integration, scheduling,
provider acceptance, link preview appearance or final image bytes. Those remain
separate deployment/account qualification work.
