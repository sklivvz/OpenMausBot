# Business-state reconciliation and continuation repair

Marco approved repairing business-state consistency, portfolio continuation and
basic tools in that order on 23 October 2026.

## Publication state

Liz reconciled the existing C08 issue, without browser or publishing actions.
The register, shared calendar, execution receipt and existing Todoist task now
record the already-sent campaign. The original deadlines, other rows and C35
hold remain. Maintenance checked the three resulting file hashes against the
returned receipt and inspected the retained Todoist readback. Delivery,
engagement and business success remain distinct from dispatch.

The calendar audit now separates sent records, publication claims with missing
receipts and explicit holds from actionable due work. Missing evidence does not
turn an already-reported publication into a new send. All rows remain visible.
Five isolated calendar tests cover the classifications and source validation.

## Continuation

Finance's checkpoint pointed to a successful turn's digest. A later passive UI
card advanced the leaf. Reconciliation inspected only the suffix, lost the
originating request and terminal evidence, and refused further continuation.
It now follows the anchor's explicit requestMessageId through the same ancestry
before checking terminal success. New user inputs, live dependencies, failed
turns, rewinds and operator stops still block automatic replay.

PMO had an exact retry of a large controller request. The retry lacked the relay
flag, so reconciliation treated its unchanged source snapshot as a new oversized
user instruction. A proven exact replacement is now excluded from new user
instructions; actual subsequent steering is preserved. Changed retries remain
refused.

The reconciliation, controller and isolated guarded-runtime suite passed 26
checks. The runtime fixture also checks reconciliation from a real terminal
message after the final turn. Read-only replay of captured Finance and PMO
conversations returns ready; the stopped Marketing conversation remains refused.
Marketing recovery uses a fresh coordination task rather than replaying the
stopped newsletter conversation. Explicit artifact and publication holds remain
part of the recovery brief.

Business outcomes require live evidence after deployment; fixture success is
not a claim of improved judgment or business completion.

## Basic execution tools

The live image lacked Python and ripgrep. The runtime-tools image now includes
Python 3.11.2, the `python` alias and ripgrep 13.0.0. The standard local Dockerfile
includes these packages for future builds. The Docker build context now includes
both newsletter utilities; its old allowlist omitted them.

The pre-replacement container diff also found Design and copy-detector MCP
executables installed outside the original image. The runtime-tools Dockerfile
now retains both. Design matched the deployed checksum; the rebuilt detector
matched the deployed code after excluding generated dependency-path comments.
The sandbox fixture additionally checks that both executables are present.

Codex 0.163.0 failed ordinary sandboxed reads because Docker's default seccomp
profile denied its nested namespaces. The reviewed local profile derives from a
pinned Moby default and adds only the calls needed by the nested sandbox. See
`deploy/local/seccomp/README.md` for provenance and the precise added rules.
It preserves bot approval modes and the inner filesystem/network restrictions.
No host capability is added, and seccomp is not disabled.

The actual replacement image was tested with no live volume, credentials or
network. `deploy/local/verify-sandbox.sh` verifies available utilities, real Codex
workspace read/write, denied writes to an otherwise writable outside directory,
and denied sandbox network access. On this installed CLI the observed command
is `codex sandbox -- COMMAND`; the documented extra `linux` argument was treated
as an executable name. The legacy Landlock switch was also rejected by this
version's socket-isolation requirement. Neither alternative was deployed.

```sh
docker run --rm -i --network none -e OMB_SANDBOX_FIXTURE=1 \
  --security-opt seccomp=deploy/local/seccomp/codex-nested.json \
  --user 0:0 --entrypoint /bin/sh \
  openmausbot-local:runtime-tools-20261023 -s < deploy/local/verify-sandbox.sh
node --experimental-strip-types --test deploy/task-review/bridge.test.ts
```

Ten work-review checks pass. A rejected missing conversation now returns current,
scoped candidates instead of leaving the caller to repeat the stale ID. The two
observed failing IDs also returned HTTP 404 from the application; they were not
valid conversations denied by the bridge.

Portfolio admission is temporarily held during runtime replacement, allowing
active app turns and teammate returns to settle. The original paused flags are
recorded so only maintenance-created holds are removed afterward. The app is
recreated only after the live inventory reports no busy or waiting-for-teammate
work. Existing settings, data volumes, credentials and Ask/Auto/Full policies are
preserved; the prior image and profile remain available for rollback.

The prior routine `completed` label still represents execution settlement, not
verified business success. Successful sandbox qualification does not establish
that a later travel check or briefing achieves its business outcome. Review
those actual scheduled runs separately; do not create synthetic live tasks.

## Observed continuation before runtime replacement

Finance and Legal reconciled to ready, PMO continued to cycle 2, and Marketing
continued in its new thread at cycle 4. Marketing delegated bounded contributions
to Liz, Chandler, Blake and Luis. Legal delegated source assessment to Vinny,
who returned a persisted source matrix. These are execution and artifact
observations, not acceptance of the parent business objectives. The independent
observer remained healthy and caught up. The personal portfolio retained its
explicit stopped state.

## Deployment receipt

The session resumed after a separate DeepSeek-model deployment had replaced the
app image. Its explicit Compose image override initially took precedence over
the environment setting. The initial Compose success did not deploy the repair:
live verification still found missing Python and ripgrep. The repair was rebuilt
on that newer image, preserving its application-server SHA-256
`6c9ba97292d34f014484cfd755f9a8e305ed9a884ca246bfa82ad9a15ff91b33`.
The combined image passed the isolated sandbox fixture again before deployment.

At 17:46:30 UTC on 23 October, the idle app was replaced with
`openmausbot-local:runtime-tools-deepseek-20261023`, image
`sha256:feab9726fe4b2304237b138a02f0e2363da380e9ed46d0fe82135e4e3293f0ec`.
Both API and Docker health checks passed. The actual container has Python,
ripgrep, Design, copy-detector, newsletter and review tools. Its seccomp profile
matches the qualified profile. Before/after comparison preserved all 15 bots'
models, approval settings and task records, together with every data mount.

At 17:46:54 UTC, all six maintenance-created admission holds were removed after
checking their original contents. The personal portfolio remained stopped.
Private deployment receipts and the prior Compose override are retained in the
maintenance worktree; the prior image remains available. The Compose override
now inherits the image selected by the local environment instead of shadowing it.
The independent DeepSeek source work remains in its owner's worktree; this repair
does not claim that work was committed or merged upstream.

## Provider quota continuation

After admission resumed, Finance and Sales started new cycles. Marketing and
Legal retained failed resumed turns from the Codex account usage limit. The
controller recognized model capacity and some Claude quota messages, but omitted
the standardized Codex quota message and Claude's parenthesized usage detail.
Controllers already in maintenance did not attempt their configured fallback.

Recovery now recognizes these runtime error formats, checks the guarded request's
ownership and failed outcome, and selects the next existing configured fallback.
It preserves the failed turn's artifacts and requires reconciliation of prior
effects. Stops, active turns, pending teammates, successful outcomes and unknown
errors do not trigger fallback. Recovery clears the old reconciliation delay.
Thirty-four controller/reconciliation checks passed, including an isolated live
fixture recovering from maintenance through a real provider error and guarded
continuation. This does not add fallback providers to configurations lacking them
or claim to restore a provider's exhausted account quota.

At 17:53 UTC, the deployed controller selected Marketing's configured Sonnet
fallback and Legal's configured Opus fallback. Both became ready while Finance
and Sales occupied the two execution slots. PMO was ready to correct an incomplete
checkpoint; its next complete portfolio accounting was still unverified.
Personal remained stopped, all maintenance holds were absent, and the source
inventory was fresh. App CPU was approximately 28% and memory 2.9 GiB in this
single sample; this is not a sustained-load qualification.
