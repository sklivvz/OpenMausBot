# Work review

The read-only MCP indexes the Todoist queue, retrieves work conversations,
obtains advisory Jev classifications and renders Bill's action briefing.
See [action destinations](action-links.md) for the decision-link contract.

Build with `node deploy/task-review/build.mjs`. The local Compose override
mounts the resulting `deploy/local/work-review-mcp.cjs` read-only at
`/usr/local/bin/work-review-mcp`, so container recreation preserves the built
version. Build before starting Compose. Runtime images also include this tool
through `deploy/local/Dockerfile.runtime-tools`.

Verify using isolated synthetic sources:

```sh
node --experimental-strip-types --test deploy/task-review/bridge.test.ts deploy/task-review/attention.test.ts
pnpm exec vitest run src/components/ThreadRefs.test.ts src/components/ChatMarkdown.test.ts src/lib/thread-refs.test.ts
```

The bridge fixtures check source coverage, receipt ownership, direct proposal
links, generated conversation links, missing and fabricated destinations,
unread-page URLs and unchanged Todoist context links. Renderer fixtures check
internal conversation link routing. These checks do not prove the relevance,
readiness or accessibility of a live proposal selected by Bill.

## Fixed intake scan

`read_attention_scan` replaces the shell scan route for Bill's unattended intake.
The first call collects every fixed source page in code; subsequent returned
cursors read the stable cached snapshot. `allPagesRead` describes report coverage,
while `complete` and the source statuses describe upstream coverage. A partial
source does not advance its last complete baseline. The tool accepts no arbitrary
query, command or mutation.

The attention tests launch an isolated HTTP collector and verify paging, changed
page rejection, preserved source failures and the bounded input schema.
Live tool discovery verifies deployment separately from a model's actual use.

On 23 October, the resumed real intake run `3ab1bf76-cac8-42d1-b8b7-e9b4147ad941`
used the MCP in Auto mode on Sol. Its transcript
`fded4127-01ac-4070-af3e-3b2a52b3c63b` contains successful read calls for pages
1–11, each with `complete:true`, and no permission cards. Bill saved a baseline
and dispatched internal handoffs. These observations qualify this deployed
provider/path, not every fallback provider or the correctness of all triage.
The optional exact MCP grant was not installed: the app required an idle window,
and this native read path succeeded without it. The routine schedule was retained.
