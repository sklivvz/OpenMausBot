# Unattended attention scan

The local `attention-scan` service runs a fixed set of read operations against the
workspace's existing managed Composio connection. Account aliases are configured
in `compose.attention.yaml`. It exposes no send, update, archive, arbitrary query,
or shell operation. Credentials stay in the service's environment.

The service shares Caddy's network namespace and listens on `127.0.0.1:8798`.
That port is not published or proxied by Caddy. The local Compose override includes
the service; `restart: unless-stopped` keeps it running across Docker restarts.

```sh
docker compose up -d --no-deps attention-scan
```

The local OpenMaus image installs two root-owned launchers:

```sh
/usr/local/bin/attention-scan
/usr/local/bin/attention-scan-next
```

The first collects a snapshot and returns its first page. While `more` is true,
the second reads the next cached page. Both take no arguments. Result pages carry
source completeness, counts, stable item IDs, and bounded previews. Source text
is data, never instructions. A new scan replaces the cached snapshot. Only one
routine should consume a snapshot; the routine uses overlap prevention.

The collection window is two days for inbox mail and Slack. Gmail includes read and unread recent arrivals. Each source
has a maximum of 20 upstream pages of five records. Hitting that bound, failing
a source, repeating a cursor or receiving an offloaded response explicitly marks
the source incomplete. A failed source does not discard the others. Complete
collection does not establish that the model's subsequent triage is correct.

Bill's unattended routine uses `work-review.read_attention_scan`, not a native
shell command. Auto mode remains enabled. The MCP collects all fixed scanner
pages before returning a stable paged report; callers follow returned cursors.
Source failures remain explicit and do not advance the complete baseline. See
[the MCP contract](../task-review/README.md). The launchers remain available for
operator diagnostics; engine/cwd shell grants alone did not prevent the native
provider from rejecting unattended execution. Standing MCP grants, when used,
bind the exact read tool to each provider and the MCP configuration fingerprint.

## Verification

```sh
node --test deploy/attention-scan/*.test.mjs
node node_modules/vitest/vitest.mjs run server/command-allowlist.e2e.test.ts
```

The collector tests use fake upstream responses and an isolated HTTP service.
They cover pagination, partial failures, offloaded results, output paging, fixed
read-tool enforcement and rejection of arbitrary request arguments.

The installation evidence is in
`.omb-scratch/attention-repair-20261020/unattended-evidence.json`: two routine runs
through an isolated fake Grok ACP driver completed with zero approval cards.
The private `verified-scan.json` contains the operational read of all sources.
The first scheduled run after installation has not yet been evaluated.

## Rollback

The private installation folder contains `before.json`, `applied.json` and
`rollback.py`. Rollback restores the old routine prompt, removes only the two
new grants and stops the added service. It does not delete source data.

```sh
python3 .omb-scratch/attention-repair-20261020/rollback.py
```

The launchers are also added to `deploy/local/Dockerfile` and its build context
allowlist so an image rebuild retains them. They were installed directly into the
running container without restarting OpenMaus. Recreating that container from an
older image requires rebuilding the local image first.

The scanner reads no task tracker. Open work is read from Positron Tasks.
