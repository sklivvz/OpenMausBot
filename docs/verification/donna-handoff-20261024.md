# Donna personal handoff repair, 24 October 2026

## Observed failure

Reviewed Donna's existing personal conversation and tool receipts. The lead spent
substantial time on a profile but omitted its source from the specialist handoff.
The handoff named candidate restaurants and dishes rather than letting the
specialist select them. After the user requested a corrected brief for approval,
she promised the brief but did not deliver it before the turn was stopped. A stop
notice first failed because `consult: true` was combined with `reply: none`;
the corrected notice was accepted. A subsequent shareable-link request performed
file reading and tool discovery but produced no link before being stopped.

These observations do not establish that the model voluntarily abandoned the
interrupted turns. The final user stop remains authoritative.

## Configuration correction

The live SOUL and personal-task-ownership skill explicitly assigned takeout work
to Donna herself. Replaced that conflict with specialist execution by The Dude,
while Donna owns the user relationship, current context and review. Handoffs
carry relevant profile facts and source, current user constraints, requested
output and authorization. They leave selection to the specialist unless the user
made the selection. Biographical information is not a food-preference claim.

The corrected skills distinguish recommendation research from checkout, require
an actual draft when the user asks to review one, and distinguish a requested
shareable link from a local path, attachment or tool-discovery result. Stops,
basket-specific payment approval and verification requirements remain in place.
The stale travel-specialist name in Donna's description was corrected to Gustave H.

Sources:

- `deploy/agentic/donna-routing-repair.json`: exact SOUL replacements and description.
- `deploy/agentic/skills/personal-task-ownership/SKILL.md`: ownership and handoff guidance.
- `deploy/agentic/takeout-ordering.md`: recommendation and purchase scope.

## Verification and deployment

Launched the standard isolated fake-engine fixture. Applied the previous profile
and skills to a fixture bot using `control-omb team apply`, then applied the
replacement: one SOUL update and two skill replacements succeeded. No business
request or live meal was used as a test.

Installed the same changes through the running app's administrative API after
checking Donna and all her task threads were idle and that the reviewed source
texts had not changed. Saved private rollback snapshots before installation.
Read back the exact SOUL and skill text, confirmed both skills enabled and no
SOUL drift. Revoked the temporary administrative session afterwards.

Live SOUL SHA-256:
`96348c83c36ccc012063181964bdc8c252ad54fe41399002b0287d193cd265f0`

Enabled skill SHA-256 values:

- personal-task-ownership: `a27a03f6828d49c74e1dfbacd01e64fd2d6f71d52b2eeba8913fb503e832ac70`
- takeout-ordering: `db2652c3bcf5322fab3da0a443a61ad2d5d2f503b3140e90453059db08a48a31`

Donna remained idle. No message was sent to a bot, no task was resumed, no
personal artifact was published, and no browser or order was touched. Her
model remains `codex / gpt-6.1-sol / high`.

This proves configuration installation, not improved model performance or
mechanical enforcement of handoff semantics. The next authorized personal task
needs observation of context transfer, specialist autonomy and actual delivery.
The separate Bolt operation engine remains undeployed and unqualified for live
ordering. A restarting observability container was also observed during this
review; its cause was not investigated as part of this focused correction.
