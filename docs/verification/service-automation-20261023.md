# Service automation review

## Source and independent verification

Seven explicitly assigned workstreams returned committed work. The integration
branch is `task/travel-social-connectors`; implementation and runtime adoption
are separate statuses.

| Workstream | Reviewed result | Qualification limit |
| --- | --- | --- |
| Perk | Five scoped MCP tools; exact authenticated schema discovery; durable draft receipts; native OAuth credential adapter | Real enrollment, schemas, scopes and account eligibility remain unqualified |
| Threads | Five MCP tools for exact text/single-image preparation, container creation, publication and reconciliation | OAuth, immutable image hosting and isolated trusted grant writer required; writes disabled |
| Bluesky | Four MCP tools; exact facets/media; stable record identity and readback | Account credentials/PDS and isolated trusted grant writer required; writes disabled |
| Web Summit | Offline saved-export normalization, stable-ID deduplication and exact prospect matching | No live collection, raw HTML parser or proof of complete attendance |
| Slush | Offline saved-list normalization and meeting-evidence reconciliation | Full directory provider schema unavailable; explicit local observation schema only |
| Selver | Fixed-spec preview, serial exact cart changes and durable recovery without implicit cart merge | Live session/stable account identity and trusted mutation authority unqualified; updates disabled |
| Bolt Food | Historical grocery/takeaway browser flow and failure inventory | Current authenticated UI/customer BFF contracts unavailable; discovery only |

Root reviewed the implementation files, reran 66 JavaScript tests and 25 Python
tests, and checked lint/build. The JavaScript count includes six native OAuth
adapter tests, one exercising the real native OAuth manager with a synthetic
token endpoint. No live provider or business write was used as a test.

Independent review identified and fixed unbounded/unprotected Threads host
configuration loading and blocked results lacking MCP `isError`. Source changes
also connect Perk's injectable credentials to the native app store, keeping
refresh writes in the existing manager. That adapter's local probe authority and
real Perk enrollment still require deployment qualification.

The root integration fixture launched a disposable real app, registered all three
MCP bundles, discovered 14 tools, persisted explicit server selection and a
restricted tool scope, then stopped its fixture. Evidence log:
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792788363814-30528.log`.
This verifies registration/discovery/selection, not authenticated business effects.

A subsequent fixture additionally installed both offline invocation skills via
the real skill-template API and verified exact text, enabled state and empty
warnings. It stopped cleanly; log:
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792788693627-31216.log`.

Reproduce:

```sh
node scripts/build-local-tools.mjs
node --test deploy/perk/connector.test.mjs deploy/threads/connector.test.mjs deploy/bluesky/bridge.test.mjs deploy/connector-auth/native-mcp.test.mjs deploy/selver/selver.test.mjs
python3 -m unittest discover -s deploy/websummit -p 'test_*.py'
python3 -m unittest discover -s deploy/slush -p 'test_*.py'
node deploy/connector-auth/verify-app.mjs
```

## Runtime boundaries

Nothing in source integration authorizes a trip purchase, post, cart mutation or
order. A bot-supplied approval flag or reference is not a trusted grant. Social
publication needs an approval authority isolated from bot shell access; private
files owned by the same unrestricted UID are insufficient. Those integrations
are pending, not implied by passing connector tests.

Offline Web Summit and Slush invocation skills are supplied for Blake. Deployment
must copy their referenced utilities, docs and examples before installing them,
use the app skill API, verify enabled/checksum state and wait for idle rather
than interrupting an active bot. No skill should advertise a missing executable.
Selver and social write capabilities must remain disabled until their stated
qualification requirements are met.

## Observed deployment

At 20:52:41 UTC on 23 October 2026, the live deployment receipt verified six
utility/document/example hashes from source `a6e888601`, and installed Blake's
`websummit-directory-reconciliation` and `slush-evidence-reconciliation` skills.
Both were read back enabled with exact text and no warnings. The first attempt
found Blake busy and deferred installation; the following idle check succeeded.
The temporary paired maintenance session was revoked after each attempt.

Files are at
`/data/.openmausbot/providers/directory-tools/releases/a6e888601`, with `current`
pointing to that release. The private receipt is
`/data/.openmausbot/providers/directory-tools/rollout-a6e888601.json`.
Removing the two newly added skills and that release reverses this deployment;
existing browser skills were not replaced. No business list was changed, no
outreach sent, and no bot or Docker process interrupted. Installed capability is
not evidence that Blake has used it successfully on a subsequent task.

Perk, Threads, Bluesky and Selver remain source implementations with passing
synthetic verification. Their authenticated runtime rollout and trusted write
authority integration are pending. Bolt's documentation is integrated; no Bolt
connector or current authenticated browser walkthrough is claimed.

Both remotes were fetched. The automation source was pushed to `fork/main` with
lint, typecheck and locale hooks passing. The fetched `origin/main` changes were
not merged as part of this connector increment, and the running app server was
not rebuilt or replaced.
