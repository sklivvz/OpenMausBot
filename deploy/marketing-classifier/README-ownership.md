# Marketing contribution ownership

`classify_marketing_ownership` recommends the specialist for one contribution.
It does not dispatch work, edit a brief, alter holds, grant authority or establish
acceptance. `createOwnershipClassifier` and `ownershipToolDefinition` are exported
for the MCP host; host registration and live bot adoption are separate work.

Pass exactly one of:

```json
{"operations":["write_copy","design","assemble"],"briefRevision":"brief-v3"}
```

```json
{"request":"Install the supplied designer HTML in the saved draft; keep its copy unchanged.","briefRevision":"brief-v3"}
```

Known operation identifiers map deterministically: copy to Chandler, design to
Edna, assembly/configuration/scheduling/publication to Liz, and coordination or
strategic review to Darcy. Multiple distinct roles return separate contributions
and `split_required`. A bare `review` identifier is rejected: its subject must be
known, or supplied as natural language. Supplied operation IDs are caller
interpretation, not verification of the original request.

A natural-language request uses one Jev call with two choice questions: contribution
category and supporting source line. Text is bounded to 4,000 characters and 32
nonempty lines; oversize inputs are rejected without truncation. Source quotations
and UTF-16 offsets come from the input. Role selection needs probability >=0.85,
margin >=0.3 and source selection probability >=0.8. These thresholds are
uncalibrated decision policy, not measured classification accuracy.

Mixed natural-language requests return `split_required` to Darcy without assigning
the whole task to one specialist. Ambiguous evidence returns `uncertain`, unrelated
work returns `outside_scope`, and unavailable/malformed Jev returns `unavailable`.
None of those outcomes dispatches work. Classifying a send as Liz's work does not
make that send approved. Design requests do not acquire copy-review prerequisites.

Exact normalized request plus brief revision is the result identity. The process
reuses up to 128 results; reused results retain their original check time and
report zero new model calls/tokens. Changed text or revision requires another
classification. Unavailable results are not cached. Cache is process-local, not
a new durable task database. Existing known operations need no classifier call.

## Verification

```sh
node --experimental-strip-types --test deploy/marketing-classifier/ownership.test.ts
```

Eleven isolated contract tests cover deterministic role separation, unchanged
approval scope, source evidence, ambiguity, mixed tasks, missing configuration,
provider errors, malformed output, strict bounds, exact cache reuse and changed
revision invalidation. TypeScript strict checking and targeted lint passed.

A bounded real Jev evaluation on 23 October 2026 used eight synthetic requests:
design without copy review, existing-template installation, copy revision,
coordination, mixed deliverables, ambiguous review, legal work and layout review
with approved copy. All eight selected the expected category; mixed/ambiguous/
unrelated work returned decomposition/uncertainty/outside-scope. Reported input
usage was 7,138 tokens total. This is a smoke evaluation, not held-out accuracy or
measured production savings. Private raw evidence is in the task worktree's
`.omb-scratch/ownership-live-eval.jsonl`. No live task, artifact or bot was changed.
