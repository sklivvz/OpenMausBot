# OpenMausBot agent notes

## Agent system architecture

For changes to bot roles, skills, tools, orchestration or autonomous execution,
read [the agreed agile agentic architecture](docs/agentic-architecture.md) and
[the first useful increment](docs/plans/2026-10-22-agentic-first-increment.md).
Keep architectural compliance and verified business outcomes separate from
successful agent turns. Shared planning, scrum and retrospectives belong to
orchestrators; lower-level agents report through their lead. Marco chooses the
business value of each increment. Implementation emerges from execution and
learning; observation must not depend on agents reporting accurately.

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

## Comments

Write a comment only for what the code cannot say:

- a license or attribution notice;
- a fact forced by something outside this code (a vendor, CLI, OS, browser,
  Electron or protocol behaviour), with its version when it has one;
- the doc comment of a public contract: the wire types in `shared/`, the
  driver interface, the preload bridge, `config.json` fields people edit;
- a link to an upstream issue;
- a security invariant or a known open risk.

Do not narrate what the next line does, restate a name, record history ("used
to", "no longer", PR or issue numbers, plan or slice names: git has it), point
at other files, draw banners or leave commented-out code. When our own code
needs a paragraph to explain a surprise, change the code instead: a better
name, a type, an extracted function, one shared helper. A rule ("never X",
"must match Y") belongs in a type, a test or a lint rule. Never suppress a lint
rule that guards correctness; fix the code.

More specific `AGENTS.md` files override this note within their directories.

## Fork maintenance

Keep this fork current with both remotes: `origin` is the upstream project and
`fork` is the user's repository. Fetch both before maintenance work, preserve
local edits and fork commits, and integrate upstream on an isolated branch when
histories diverge. Verify conflicts using the isolated fixtures before pushing.
`main`, tracking `fork/main`, is the development trunk and contains our custom
work. `origin/main` is the upstream reference, not the push destination. Integrate
upstream into the trunk through an isolated short-lived branch, verify, then
fast-forward the local trunk to the tested result. Never reset the trunk to
upstream or force-push to resolve drift. Report source synchronization separately
from the version actually deployed.

## Trunk-based development

Keep changes small and integrate verified work into `main` promptly. Concurrent
agents use separate worktrees and short-lived branches starting from current
`fork/main`; they do not share a dirty index or switch another agent's branch.
Commit work before handing it off. Reconcile with the latest trunk before
integration and run the required checks without bypassing hooks. Preserve
unfinished work on a named branch; do not leave it only in a detached checkout
or stash. Delete a task branch only after its work is integrated and its
worktree owner has finished. See [the workflow](docs/trunk-development.md).
