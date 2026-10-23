# Jev copy preflight

`detect_slop` is a stdio MCP tool for one complete marketing asset. It uses the existing direct Jev connection in `~/.openmausbot/config.json`; credentials are read at call time and never returned. The caller supplies the exact draft, brief, channel, source facts and any approved reference. It does not retrieve sources, rewrite files or publish.

The seven checks cover choppy rhythm, generic copy, inflated language, formulaic rhetoric, awkward language, regional idioms and claims unsupported by the supplied facts. Each category has a defect probability and a separately selected source passage. Quotes and UTF-16 offsets come from the original draft, never generated text. The receipt includes SHA-256 hashes of the draft and full review input. An edit invalidates the draft receipt.

`needs_revision` requires a defect probability of at least 0.8 and a located passage with probability at least 0.6. `needs_review` includes ambiguous or unlocalized signals. `no_flags` is not editorial sign-off. Probabilities are uncalibrated model estimates. Missing source facts are explicitly not assessed; authentication, timeout and malformed-result failures return `unavailable`, never a pass. Requests exceeding the limits are rejected without truncation. One strongest passage per category is returned, not an exhaustive list of occurrences.

Build with `node deploy/slop-detector/build.mjs`. The local Dockerfile installs the generated `deploy/local/slop-detector-mcp.cjs` as `/usr/local/bin/slop-detector-mcp`. Register that absolute command with empty args/env as `slop-detector`, enable it, and select it for the intended bots through the app. Existing approval modes remain authoritative. The supplied skills place the check before editorial handoff and keep marketing strategy and design ownership separate.

Verification on 22 October 2026: six deterministic contract/failure tests and an isolated app fixture covering MCP discovery, profile/skill persistence, selection and guarded handoffs. Real Jev 1.14.0 review of recorded Mastodon v3 and v4 drafts flagged their rhythm/phrasing; v5 returned no flags. These three examples establish initial behavior, not general detection accuracy. Session evidence is in `.omb-scratch/slop-detector-20261022/`.

## Mechanical checks and reusable reviews

Version 2 adds `check_marketing_brief`, a zero-model structural check. It accepts
`objective`, `audience`, `deliverable`, `kind` (`collateral`, `editorial`, or
`campaign`), `owner`, `revision`, `sourceReferences`, `acceptanceCriteria`,
`authorizedOperations`, `holds`, and `assignment`. An assignment has `owner`,
`role`, `operation`, and `briefRevision`. Operations are `review`, `write_copy`,
`design`, `assemble`, and `publish`; production owns assembly/publishing, copy
owns writing and design owns design. A review can use any specialist role.
The tool returns missing fields, wrong specialist roles, stale versions and
scope/hold conflicts. `structurally_ready` does not establish source authority,
acceptance or business suitability. A publishing hold does not block separately
authorized preparation.

`detect_slop` also accepts:

```json
{
  "constraints": {
    "forbiddenPhrases": ["—"],
    "maxCharacters": 500,
    "preserveExactly": ["Exact user-authored sentence."],
    "requiredUrls": ["https://example.org/event"]
  },
  "reviewScope": {
    "assetId": "existing-assignment-id:channel-asset",
    "briefRevision": "current-source-backed-revision"
  }
}
```

All constraints are explicit caller-supplied task requirements, not a generic
blacklist. Phrase matching is case-insensitive with word boundaries; protected
text and URLs are exact. Length counts Unicode code points, not platform-specific
weighted URL/grapheme counts. Duplicate long paragraphs are uncertain findings,
not automatic deletion instructions. Mechanical failures return all bounded
findings before any Jev call. A protected-text conflict returns to the owner.
Neither tool edits content or grants permission to publish.

Successful semantic results are reused only for the identical full input and
detector version. Results and their exact evaluated input persist with mode 0600
in `~/.openmausbot/slop-receipts` (override `SLOP_RECEIPTS_DIR`). They contain
private business copy and source context. Reuse expires after seven days; expired
files remain available as evidence until normal operator retention removes them.
No credentials are stored. Shared filesystem locks prevent two MCP processes from
paying for the same review simultaneously. Lock wait is bounded to 30 seconds;
a crashed process's lock becomes reclaimable after 90 seconds. Unavailable
responses are not cached or treated as passes.

With `reviewScope`, code permits at most two successful semantic checks per asset
and brief revision during that seven-day window, then returns `needs_editor`.
Unchanged receipts remain reusable after the limit. A real user/source correction
can establish a new brief revision; changing the draft alone cannot. Legacy calls
without a scope remain supported and have no cross-revision cap. This is a tool
workflow bound, not an authorization boundary: callers still supply the identity
and constraints, and the app does not force every handoff through this tool.

A cache hit retains the original `checkedAt` and historical `inputTokens`, while
`inputTokensThisCall` is zero. The receipt includes a compact `findingSummary` for
bounded transcripts, full structured findings, and a repair contract preserving
specified text/URLs and requiring facts/meaning to remain intact. The tool does
not automatically launch a repair model or change model assignments. The writer
can hand the bounded repair to an existing permitted executor and remains
responsible for meaning. An uncertain result escalates once instead of cycling
scores. Passage choices reference the single supplied passage list instead of
repeating full passage text in each of seven question option sets.

Run `pnpm exec vitest run --config deploy/slop-detector/vitest.config.ts` and
`node deploy/slop-detector/build.mjs`. See [verification](verification.md) for the
isolated integration and adoption evidence, including its limitations.
