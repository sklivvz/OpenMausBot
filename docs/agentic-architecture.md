# Agile agentic architecture

Agreed principles with Marco, 22 October 2026. The implementation emerges through execution, discovery and learning. This reference records responsibilities and working agreements, not a fixed technical blueprint or a completed deployment. The [first useful increment](plans/2026-10-22-agentic-first-increment.md) records the selected business value and current evidence.

## Purpose

Marco sets business objectives such as running a product launch or selling the product. The system owns their decomposition, execution, verification and recovery. It develops reusable capabilities through repeated execution so that progressively larger objectives require less supervision.

Correctness has two requirements: achieve the intended outcome and follow the architecture. A campaign completed by the frontier assistant manually doing the team's work fails the architectural requirement. Likewise, a correctly routed sequence of agent turns without the requested outcome fails the business requirement.

## Six layers

| Layer | Responsibility | Intended model allocation |
| --- | --- | --- |
| 1. Deterministic code | Reliable atomic operations, validation, persistence, scheduling, ownership, retries and result verification | JavaScript, Python and other suitable code, exposed through utilities or MCP tools |
| 2. Classifier | Narrow probabilistic judgments with defined categories, structured output and an uncertain result | Jev |
| 3. Executor | Orchestrate lower-level operations through skills to achieve a small, concrete objective | Haiku, Luna, DeepSeek |
| 4. Thinker | Handle discovery and ambiguity; develop approaches and turn them into executable work | Sonnet, Terra, DeepSeek Pro |
| 5. Orchestrator | Own a business objective, coordinate contributions, manage dependencies and evaluate business results | Opus, Sol, Grok |
| 6. Frontier | Maintain the architecture, examine execution evidence, improve skills, build capabilities and repair systemic failures | Fable, Astra |

These allocations express the agreed routing policy. Installed model identifiers, capabilities and availability must be verified before configuration. Layer membership is an explicit role, not something inferred from a model's name.

The frontier layer's objective is making the system work. It builds and repairs the machinery and evaluates its behaviour. The business orchestrators retain ownership of campaigns, sales and other user objectives.

## Leadership and self organisation

The shared team is the team of **orchestrators**. Darcy, Blake and the other configured business leads participate in its planning, scrum and retrospective. Thinkers, executors, Jev and deterministic tools do not join those ceremonies. Their work is represented through the responsible orchestrator. The frontier layer observes the team's evidence and handles system improvements without taking over a business contribution.

When a new objective arrives:

1. Its desired outcome, constraints, existing authority, deadline and evidence of success are made explicit. Ordinary implementation choices remain with the team.
2. Each orchestrator considers whether it can contribute. Relevant leads propose an outcome they can own, its dependencies and the capability they will use. Others may state that they have no relevant contribution.
3. Leads take ownership of accepted contributions. Deterministic ownership records prevent duplicate claims and conflicting commitments.
4. One lead owns overall coherence and integration. It reconciles overlapping proposals and uncovered needs with the team. A capability gap becomes an explicit system requirement.
5. Each lead decomposes its contribution and coordinates its own thinkers and executors. Existing delegation can dispatch this lower-level work; those workers are not required to join leadership planning or bid for business objectives.

Self organisation does not mean unattended gaps. The overall owner remains responsible for detecting missing contributions, unresolved dependencies and work that has stopped producing results.

## Outcome contracts

An objective retains its original business meaning throughout execution. Contributions and small deliverables link back to it. Each has an owner, acceptance criteria, evidence requirements, dependencies and a next action or explicit waiting condition.

Track these separately:

- **Execution state:** claimed, running, waiting, interrupted or settled.
- **Deliverable state:** proposed, submitted, accepted, rejected or withdrawn.
- **Business outcome:** active, observing results, achieved, unmet, blocked or stopped.

A completed turn does not close a deliverable. An accepted deliverable does not establish the parent business outcome. Publishing a campaign proves delivery; registration or sales evidence is needed to assess its effect. Unknown results remain unknown.

Evidence includes exact artifact versions, operation receipts, external record identifiers, verification results and the source of material user decisions. New corrections invalidate affected versions and dependent claims of readiness. Existing scoped authorization persists; changes outside that scope require a new decision.

## Deterministic capabilities

Atomic operations have typed inputs and outputs, explicit preconditions, persistent operation identities, bounded failure handling and observable results. An MCP supplies an interface; the implementation and tests supply mechanical reliability.

External systems can fail ambiguously. If a write may have succeeded before the response was lost, recover by reconciling its identity and result. Do not blindly repeat it. Record unresolved outcomes explicitly when the provider cannot establish whether the action occurred.

Jev handles defined uncertain decisions inside otherwise deterministic workflows. Code validates its output and chooses among permitted branches. An uncertain or unavailable classification escalates to the appropriate reasoning layer. A classification does not itself establish a fact, grant authority or prove task completion.

Role boundaries belong in tool permissions and interfaces as well as skills. Orchestrators should use business and coordination capabilities. Executors should receive the operations required by their workflow. Discovery access can be explicitly granted to the layer investigating a missing capability, and the resulting procedure should return to a reusable lower-level interface.

## Learning through repeated execution

Learning is an explicit feedback process, not an assumption that model weights change during use:

**Execute → retain evidence → compare runs → identify patterns and exceptions → improve a skill → evaluate further runs → automate stable portions → monitor regressions.**

Bots create and refine their own skills as experience accumulates. A learned skill states its purpose, applicable conditions, required operations, completion criteria, known exceptions and supporting executions. Skill versions are recorded with the work that used them.

The frontier layer reviews and fine-tunes those skills, removes contradictions and checks architectural fit. Repetition creates an automation candidate. Promotion requires evidence that the relevant behaviour is understood, executable tests for the contract and exceptions, and evaluation on cases beyond those used to derive the procedure. A single successful run is insufficient evidence of general reliability.

Typical progressions include:

- Browser discovery → repeatable sequence of discrete browser actions → direct BFF calls → full automation. Each transition follows evidence from repeated execution; the browser sequence is already a reusable capability before direct calls are established.
- Complex pattern discovery → repeatable executor procedure → code with narrowly scoped Jev classifications.
- Unfamiliar failure diagnosis → recovery skill → tested deterministic recovery.

Automation preserves uncertain decisions at the appropriate layer. As lower-level capabilities become reliable tools, agents can orchestrate larger units of work. Role changes and new orchestrators follow demonstrated capability; they do not occur merely because a job has been renamed.

### Task size follows demonstrated capability

An orchestrator sizes delegated work to the recipient's available, demonstrated skills. When a requested workflow combines unfamiliar operations, the orchestrator owns the overall objective and separates the learning into smaller concrete outcomes. Each outcome has its own verification and blocker state. The user does not have to perform this decomposition.

As those skills become available and reliable through repeated execution, the orchestrator can delegate their composition as one larger task. Writing or enabling a skill file alone does not establish readiness; execution evidence does. This is how the useful level of abstraction grows.

## Self healing

Self healing restores execution and preserves the objective, current user decisions and completed work.

Once a blocker is identified, its handling has a deterministic outcome. The runtime preserves the objective, owner, completed work, evidence and resume point; selects an established bounded recovery or routes a help request to the responsible higher layer; and records the explicit waiting condition. Resolution must be verified before the same work resumes. A required personal action becomes a narrowly scoped dependency, with objective ownership retained by the team.

Recognizing or diagnosing an unfamiliar blocker may require Jev or a reasoning agent. Uncertain classification has an explicit escalation route. Once the blocker is recognized, the state transition and delivery of the help request belong to code. The workflow must not depend on an agent remembering to escalate or inventing what to do next. Missing resolver configuration is itself a visible system defect. The passive observer does not implement these transitions. The runtime now persists computer/browser dependencies and wakes a waiting lead once for a child's input card; arbitrary business blockers and semantic verification still require further discovery.

1. Code detects known conditions and performs tested, bounded recovery.
2. Jev classifies ambiguous cases only where a defined recovery decision needs it.
3. Executors use established recovery procedures.
4. Thinkers diagnose unfamiliar failures; orchestrators adapt plans and resolve business dependencies.
5. The frontier layer investigates systemic defects, develops a repair, tests it and updates the shared capability.

A repair is verified both at the capability level and by the interrupted workflow's correct continuation. Stops remain stops. Recovery does not duplicate effects or silently widen authority. Exhausted recovery remains visible with evidence and a responsible owner.

Record recoveries alongside ordinary executions. Recurring successful recoveries can move down the hierarchy through the same learning process.

## Leadership scrum

At a configurable cadence, all orchestrators in the leadership room answer:

1. What outcomes have I achieved since the last scrum?
2. What outcomes will I achieve before the next scrum?
3. What is blocking me?

Achievements cite acceptance or business evidence. Planned outcomes become recorded commitments. Blockers identify an affected outcome, a concrete dependency and the next resolving action. Leads report lower-level failures through their effect on those commitments.

Use the meeting to resolve coordination issues and expose drift. Keep repeated unchanged status in the record. A lead with no new achievement reports that accurately; it does not substitute tool counts, drafts or activity for a business result. Timebox the meeting and keep implementation discussion in the relevant work thread.

## Leadership retrospective

At a slower configurable cadence, all orchestrators review and discuss:

- What have we done right as a team?
- What could improve?
- What lessons have we learned?

Use evidence across executions, including missed outcomes, user corrections, recovery paths, costs and architectural violations. Allow leads to challenge explanations and distinguish a hypothesis from an established pattern.

The retrospective produces a small improvement backlog. Each selected experiment has an owner, expected effect, affected skill or capability, evaluation cases and a review point. The next retrospective checks whether it helped. System changes route to the frontier layer; business strategy remains with the relevant orchestrators.

## Measures of improvement

Measure business outcomes separately from system reliability:

- Accepted deliverables and achieved business outcomes against the user's criteria.
- Missed commitments and elapsed time without useful outcome progress.
- Correct recoveries, repeated failures and unresolved external effects.
- Human interventions, including frontier execution of business work.
- Reasoning cost, retries and elapsed time per comparable successful workflow.
- Skill reuse, regressions and successful promotion of repeated procedures into code.
- Architectural violations, including a lead repeatedly performing executor mechanics.

Compare similar work and preserve difficult cases. Lower token use is useful only while quality and outcome reliability are maintained. Ceremony attendance, rewritten instructions and increased automation volume are not sufficient measures of success.

## Delivery method

Every increment delivers a concrete business benefit. Marco decides whether a proposal has value; the frontier assistant estimates the effort and makes implementation choices. Technical foundations, schemas, tests and tools support an increment. They are not themselves substitutes for its business value.

Select one useful outcome, execute, observe and adapt. Do not pre-plan the eventual system or require the technical architecture to be settled at each step. The six layers define responsibilities. Services, interfaces, skills and implementation structure develop from what actual work teaches us.

Use isolated fixtures for mutations and failure injection. Production runs perform genuinely requested work under its existing authority; they are never synthetic tests against the user's accounts. Keep source changes, deployment state, fixture results and observed business behaviour distinct.

## Independent observability

The application and deterministic observation code collect execution evidence automatically. Observation must continue when agents omit reports, misstate progress, stop or fail. Agent statements remain claims. Store source identities and timestamps so later reviews can follow an objective through contributions and execution, inspect interventions, and compare repeated attempts.

The reasoning cycle under discussion is objective → revisable steps → execution → step verification → objective verification → achieved, blocked or failed → help from the layer above when necessary. Preserve unknown and waiting states; verification requires evidence appropriate to the objective. An escalation carries attempted work, failed checks and the help needed. These are intended behaviours to develop through actual runs, not claims that the current runtime implements them.

The [independent observer](../deploy/observability/README.md) collects existing runtime events and sampled transcript revisions. It exposes current evidence and gaps without relying on agents to maintain a parallel reporting protocol. It does not decide business success or perform the team's work.

## Example: Liz learns social publishing

Marco identified a current learning case: Liz needs to learn social posting because the required MCP capability is missing. This statement records the user's assessment; it is not a verified inventory of every connected platform.

Marco's root-cause hypothesis for the failed four-channel attempt is that Darcy delegated too large a task for Liz's existing skills. Darcy should retain the overall publishing objective and create four separate tasks: publish on X, Mastodon, Bluesky and Threads. Liz develops and verifies each channel-specific skill through its own work. Only once all four skills are enabled and supported by execution evidence does a single four-channel publishing task become appropriate. The observed abandonment is consistent with this hypothesis; subsequent executions must establish whether the decomposition improves results.

During genuinely authorized publishing work, Liz discovers a workable procedure, obtains help at the appropriate layer when necessary, verifies the resulting post and records a reusable skill. The progression is browser discovery → sequence of discrete browser actions → direct BFF calls → full automation. Preserve the prerequisites, checks and known exceptions at each transition. Observation captures attempts and failures independently. Further executions expose variations and exceptions. The frontier reviews the skill and replaces demonstrated stable operations with API calls or a tested MCP when that becomes justified by evidence. One successful post is not enough to establish a generally reliable publishing capability.

This example does not resume previously stopped production or authorize publication of rejected content.

## Continuous ownership across the whole portfolio

An orchestrator retains all accepted business objectives across turns. A finished
assignment, a blocked campaign or one completed outcome does not suspend the
remaining objectives. Todoist tasks map to business objectives; they do not
automatically define them. The lead reconciles priorities and chooses contributions
within the user’s authority. Deterministic continuation retains objective identity,
source coverage, actual request settlement and explicit dependencies. It shares
capacity across teams and keeps absent progress or broken control paths visible.
See the [portfolio controller verification](verification/objective-portfolios-20261023.md)
for implementation evidence and current limits.
