# Working on the fork's trunk

`main` tracks `fork/main` and holds the integrated product, including custom
runtime and deployment work. `origin/main` is the upstream reference. Push only
to `fork` for normal development. Source integration does not deploy Docker.

## Small changes and concurrent agents

Start from current `fork/main`. Use a short-lived branch in a separate worktree
when another agent is working, when integrating upstream, or when the change
needs isolated verification. Aim to integrate a coherent, verified change in
the same working session. Long-running work should land in safe increments.

```sh
git fetch fork
git worktree add -b task/short-description ../omb-short-description fork/main
```

Commit the task's files, reconcile with the latest trunk, and verify the exact
result before integration. One integration owner advances `main`; agents must
not concurrently change the shared checkout or index. A merge commit is allowed
when it preserves existing shared history. Never force-push the trunk.

Before a trunk push, the installed hook runs lint, type checking and locale
checks. Run the relevant isolated workflow fixtures as well; the hook does not
run those. Do not skip the hook. Use the pinned package manager from
`package.json`; if it is not installed, `npm exec --package=pnpm@10.33.0 -- pnpm`
provides that version without changing repository dependencies.

Remove a task branch only after confirming its work is in trunk and its
worktree owner has finished. Preserve unfinished commits on named branches,
with a handoff describing remaining work. Avoid detached or stashed-only work.

## Upstream integration

Fetch both remotes. Merge `origin/main` into a short-lived branch based on the
latest trunk, preserve custom behavior, resolve conflicts, and run isolated
fixtures. Bring the tested result into `main` and push to `fork/main`. Do not
reset the fork trunk to upstream. Upstream branches mirrored in the fork are
not automatically unfinished local work and must not all be merged or deleted.

## Local deployment tools

After installing dependencies, run `pnpm build:local-tools` before building the
local Docker images or starting the observer. The generated detector, review,
calendar-audit and observer bundles are ignored; their sources and build scripts
are versioned. `deploy/local/Dockerfile.runtime-tools` includes the restored
runtime utilities. Deployment remains an explicit, separately verified action.

Keep `.env`, credentials, live databases and `.omb-scratch` evidence out of Git.
Version source, tests, configuration templates and operational documentation.
