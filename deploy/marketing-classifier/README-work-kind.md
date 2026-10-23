# Marketing work-kind classification

`createWorkKindClassifier` exposes `classify_marketing_work` for responsibility
2 of the marketing deliverable brief: distinguish reusable collateral, editorial
content and campaign planning/execution. It makes one bounded Jev request with
two questions: kind and supporting source passage. Source text appears once in
the request, not in every choice option.

The classification concerns the requested deliverable. A deck needed before a
launch remains collateral; an article about a launch remains editorial. Planning
or executing the coordinated promotional initiative is campaign work. A bundle
containing separate kinds returns `needs_decomposition`; insufficient evidence
returns `needs_clarification`. Those outcomes go to the lead, not automatically
to the user. No default campaign label is used.

Inputs are the exact request, optional context and source references. The tool
does not retrieve references. Output includes an input-and-rules hash, the
selected original passage with UTF-16 offsets, distribution, recorded provider
input tokens and an explicit next action. A classified result requires top
probability at least 0.85, margin at least 0.25 and evidence probability at least
0.7. These are conservative starting thresholds, not measured accuracy. Jev's
[confidence documentation](https://docs.typesafe.ai/confidence) distinguishes
probability from confidence; the implementation labels its measures literally.

No result grants permission, changes a hold, chooses an owner, approves copy or
invents launch prerequisites. Changes to request, context, source references or
classifier rules change the input hash. Keep authority and explicit user
decisions in their existing records. A classified kind can populate the existing
`check_marketing_brief` kind field; unresolved results cannot.

## Verification and integration

Run `pnpm exec vitest run --config deploy/marketing-classifier/work-kind.vitest.config.ts` for
isolated transport, grounding, scope-identity and failure contracts.
`work-kind-cases.ts` contains independently labelled synthetic evaluation cases;
unit fixtures validate transport/control logic, not semantic model accuracy.
Measure classification accuracy and tokens on those cases and real corrections
before enabling automatic routing. No measured token savings are claimed.

On 23 October 2026, a read-only evaluation against the configured Jev endpoint
returned the expected category on all 10 synthetic cases in
`work-kind-cases.ts`: three collateral, three editorial, two campaign, one mixed
and one uncertain. The mixed request returned
`needs_decomposition`, and the underspecified request returned
`needs_clarification`. Recorded input usage was 8,825 tokens across 10 calls.
This is a small prompt-development check, not an independent accuracy benchmark
or proof of savings on live work. No bot task or external content was changed.

The module exports `createWorkKindClassifier`, `workKindToolDefinition` and the
input schema. Root integration should register the tool in the marketing MCP,
then verify discovery and a synthetic call through an isolated OpenMaus fixture.
This commit does not register or deploy it, modify live briefs, or alter bots.

Exact copy-review receipt reuse remains deterministic and belongs to the
existing copy preflight work. It is not this classifier's responsibility.
