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
node --experimental-strip-types --test deploy/task-review/bridge.test.ts
pnpm exec vitest run src/components/ThreadRefs.test.ts src/components/ChatMarkdown.test.ts src/lib/thread-refs.test.ts
```

The bridge fixtures check source coverage, receipt ownership, direct proposal
links, generated conversation links, missing and fabricated destinations,
unread-page URLs and unchanged Todoist context links. Renderer fixtures check
internal conversation link routing. These checks do not prove the relevance,
readiness or accessibility of a live proposal selected by Bill.
