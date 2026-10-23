# Marketing automation integration — 23 October 2026

The integration combines Keila draft preparation, deterministic copy and brief
checks, and the work-kind and contribution-ownership classifiers. The marketing
MCP exposes `detect_slop`, `check_marketing_brief`, `classify_marketing_work` and
`classify_marketing_ownership`. The Keila MCP exposes inventory, snapshot and
preparation only. Classification cannot grant authority or dispatch work.

The integration owner independently reviewed the source and reran 13 Keila
tests, 18 copy/brief tests, 11 ownership tests and 11 work-kind tests. All passed.
Repository lint, type checking and locale checks passed. The ownership tool's
top-level input schema was explicitly marked as an object for MCP compatibility.

An isolated application launched through `scripts/control-omb.ts launch` at
`http://127.0.0.1:21934` discovered all four marketing tools and the Keila tools.
The fixture persisted and reread bot MCP selection. The copy, marketing brief
and newsletter skill texts were installed and read back exactly. Two distinct
MCP processes using a shared temporary receipt directory and a synthetic Jev
endpoint made one semantic request for concurrent identical inputs; changed
copy consumed the second permitted check and a third revision was deferred to
the editor. Synthetic work-kind and deterministic ownership calls also passed.

Evidence is retained privately in the integration worktree's
`.omb-scratch/fixture-evidence.json` and `.omb-scratch/verify-combined.mjs`.
Launcher log:
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792781361148-19132.log`.

These checks establish implementation and integration behavior under fixtures.
They do not establish live adoption, copy quality, business acceptance or token
savings. The observed 35 historical detector calls had distinct inputs, so
exact cache reuse is not a demonstrated saving on that sample. Deployment and
the first genuinely authorized production use require separate evidence.
