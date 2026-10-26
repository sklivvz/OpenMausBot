# First useful increment of the agile agentic system

Selected with Marco on 22 October 2026. Reference: [agreed principles](../agentic-architecture.md).

## Business value

Marco gives the orchestrators one objective in their shared room. They work out the contributions, take ownership and start working. Marco can hand work to the team without deciding which bot should do what.

This is the selected increment. A sales target or a technical foundation was not selected as its substitute. Marco judges whether a proposed increment has business value; the frontier assistant estimates effort. Implementation develops through execution and discovery.

## Learning from the first execution

Independent observability is part of this increment and has lasting value. It should let the frontier examine:

- What objective was actually given, and what happened to its meaning across handoffs?
- Who proposed and took contributions, and who actually began work?
- Which work advanced, stopped, failed, waited or required human intervention?
- What evidence supports step acceptance and the business outcome?
- Did delegation follow the intended responsibilities?
- What might become a reusable skill, and what still needs discovery?

These are review questions, not a requirement that agents produce trustworthy telemetry. The system captures its own execution evidence. Unknown answers remain unknown.

## Current implementation scope

The existing Coordination room now contains only the six business leads, with Donna as default coordinator. Its [working agreement](../../deploy/agentic/leadership-room.md) calls for contribution offers before dispatch: relevant leads propose outcomes, the coordinator reconciles them, and the offered work is dispatched with acceptance criteria. The existing runtime records those requests and their ownership, deduplicates identical requests and routes results. Semantic agreement and good decomposition remain reasoning responsibilities; a prompt is not a mechanical guarantee of either.

Room leads can address their specialists outside the room through direct work threads. Direct assignments have separate histories. A recognized computer/browser-control blocker becomes a persisted dependency; admission checks it before starting another provider turn. A child's pending input card wakes its lead once with the existing card and thread references. The child retains its assignment and the lead remains responsible. These repairs cover known runtime conditions, not every business blocker.

## Evidence and next learning opportunity

The fixture sends one unaddressed objective to the room, follows a contribution offer, dispatches the offered work, routes it to a specialist outside the room, verifies a concrete fixture artifact and returns the result to the lead. Observation remains independent of agent reporting and leaves business success unverified. The fixture uses scripted providers: it proves the machinery, not the judgment or quality of live models.

Deployment and verification are recorded in [the release receipt](../verification/agentic-minimal-20261023.md). That release did not establish continuing live launch ownership, so the earlier completion claim was too broad. Marco authorized completing the handoff the following morning. The [live follow-through receipt](../verification/launch-ownership-20261023.md) records the existing launch objective, cross-team access correction, scheduled continuity and observed execution. No synthetic objective was sent to the user's bots. Use the execution evidence to decide what needs improving. There is no committed technical roadmap beyond this increment.
