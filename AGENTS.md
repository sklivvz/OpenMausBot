# OpenMausBot agent notes

## Delivery requirements

Treat the requested scope, correctness and user-given deadline as simultaneous
requirements. Do not substitute a smaller repair, a plan, a successful agent
turn, an explanation of delay or failure accounting for the requested result.
Do not silently change the scope or deadline. These requirements do not permit
false completion claims, skipped necessary verification or unauthorized actions.

For substantial implementation work, the primary agent owns orchestration,
review, integration and deployment. Delegate independent implementation work in
parallel with explicit deliverables, acceptance criteria and file ownership.
Marco's development preference is DeepSeek Flash at maximum reasoning through
the installed DeepSeek shell (DSH); verify the actual executable and model
selection. Do not silently substitute another model or claim delegation that
has not started. Small, indivisible edits do not need artificial delegation.

Check deployment requirements at the start and prepare deployment alongside
implementation. Resolve prerequisites on the critical path while workers run;
do not discover them only after code is finished. Review returned work promptly
and integrate verified changes without waiting for unrelated workers. Keep the
full requested outcome as the completion criterion.

Use focused verification and reuse valid results for unchanged code and
configuration. Repeat a check only for changed inputs, a failure, new evidence
of risk or an explicit required release check. Never bypass repository hooks
or the isolated-fixture requirement. Documentation-only edits need a content
and diff review, not application end-to-end tests.

For authorized deployment tasks, complete installation and read back the live
version and relevant settings before reporting deployment. Distinguish source
changes, passing checks, installed capabilities and observed business outcomes.
An image waiting for restart is not deployed; a tool connection test does not
prove completion of the user's business task. Preserve active work and existing
authorization boundaries while deploying.

During urgent work, do not add unrelated refactors, maintenance, reporting
systems or broader redesigns. Communicate concrete progress concisely; status
updates and postmortems do not replace execution. These rules are operating
requirements for achieving the result, not a procedure for accepting failure.

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
