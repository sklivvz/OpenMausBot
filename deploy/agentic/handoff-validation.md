# Structured handoff preparation

`validateHandoff` and `handoffToolDefinition` in `handoff-validation.ts` provide
the deterministic part of supplying a specialist with the current task,
canonical sources, decisions and acceptance evidence. The capability is generic
across teams and makes no model, network, filesystem or dispatch calls. It adds
no task database. The exported tool is named `validate_handoff`.

The input uses existing task/objective and bot identities. References can be
absolute HTTP(S) URLs, the app's supported thread links, normalized absolute
file paths, or `record:system/id` identifiers. Their syntax is checked; existence,
access and content are not. Reference files are never opened by this validator.

```json
{
  "task": {
    "id": "positron-task-id",
    "objectiveId": "existing-business-objective-id",
    "reference": "record:positron-tasks/positron-task-id",
    "revision": "brief-v3"
  },
  "assignment": {
    "botId": "existing-specialist-id",
    "objectiveId": "existing-business-objective-id",
    "briefRevision": "brief-v3",
    "contribution": "Review the supplied contract against the requested clauses.",
    "operations": ["review"]
  },
  "artifactMode": "existing",
  "artifacts": [{
    "id": "contract-id",
    "reference": "/absolute/task/Contract draft.docx",
    "version": "content-sha256",
    "currentVersion": "content-sha256"
  }],
  "facts": [],
  "decisions": [{
    "statement": "Review only; preserve the original.",
    "reference": "record:message/current-user-decision"
  }],
  "acceptanceCriteria": [{
    "criterion": "Return findings against the requested clauses.",
    "evidenceRequired": "Clause references and proposed changes in a separate response."
  }],
  "scope": {
    "permittedOperations": ["review"],
    "heldOperations": ["edit", "sign"],
    "decisionReferences": ["record:message/current-user-decision"]
  }
}
```

`artifactMode: new` permits a new-output task without inventing an existing
artifact. Existing source materials can still be included. Facts and decisions
are explicit arrays; an empty array is rendered as no supplied information,
not evidence that no facts or decisions exist. Version labels are opaque source
identities: prefer a source hash or provider revision from the retrieval path.
An absent `currentVersion` produces `checks.sourceCurrency: unknown`; equal
versions mean only that the supplied values matched, not that the tool fetched
the latest source.

Missing or malformed input returns `needs_information`. Conflicting objective,
brief or artifact versions, duplicate artifact identities, missing canonical
sources for existing-artifact work, and requested operations outside the supplied
scope or on hold return `needs_correction`. A hold on publishing does not block
an independently permitted review. The validator does not infer holds or
authorization from prose; the current task records remain authoritative.

A consistent packet returns `structurally_ready` and `nativeCall`, using the
existing `CoordinateBotsCall` fields: `botIds`, `message`, `doneWhen`, `thread`,
`reply`, `rework` and `consult`. The existing agents adapter accepts these names
and maps them to its wire format. The rendered message must fit the native
4,000-character route limit and acceptance text the 1,000-character `done_when`
limit. Oversize packets fail explicitly without truncation. The packet hash
binds normalized input and validator version.

This prepares an initial work handoff. It does not dispatch it, establish route
permission, prove recipient capability, authorize actions, or manage existing
assignments. Before an actual dispatch, the lead/runtime must reuse existing
assignment state where appropriate and apply normal access and authority checks.
`structurally_ready` is not business acceptance or permission to execute.

## Integration and verification

The host can register `handoffToolDefinition` and return
`validateHandoff(arguments)` from its tool handler. Use the existing execution
tool host rather than adding a second task system. This commit does not change
the host registry or live bots; root integration must verify discovery in an
isolated app before deployment.

Run:

```sh
node --experimental-strip-types --test deploy/agentic/handoff-validation.test.ts
```

Eleven isolated tests cover complete and incomplete packets, source/version
conflicts, operation-scoped holds, valid new-output work, supported reference
forms, explicit unknowns, strict bounds and changed-source identity. The native
agents-call adapter accepts the prepared payload against an injected in-memory
harness client and preserves its message and acceptance criteria. No real
delegation or source read occurs. Targeted lint and strict TypeScript checks
pass. These checks do not establish live token savings or semantic adequacy of
the supplied brief and acceptance criteria.
