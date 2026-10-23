# Selver cart reconciliation

This deterministic utility turns an already fixed shopping specification and
selected SKUs into a preview, serial cart changes and a verified receipt. It
preserves unrelated baseline SKUs. Removing an existing SKU requires an explicit
`removeSkus` entry; selected SKUs use absolute target quantities.

It does not choose products, discover a session/cart, merge carts, check out,
pay, book delivery or prove that the shopping specification matches the user's
request. Provider calls are restricted to the existing account, cart pull,
totals, update and delete contracts.

## Entry points and dependencies

Node 22+; standard library only. No MCP or app/server changes.

- `main.mjs`: CLI preview/apply/reconcile.
- `plan.mjs`: fixed input audit, preview and exact final cart verification.
- `client.mjs`: pinned cart adapter over the existing `SelverCartBff`.
- `reconcile.mjs`: durable receipts and serialized execution.
- `../../skills/selver-shopper/scripts/selver-bff.mjs`: requirement/quantity audit.
- `../../skills/selver-shopper/scripts/selver-cart-bff.mjs`: existing provider transport.

Deploy the two dependency files at these relative paths as well. Do not bundle
these unchanged entrypoints: one dependency has top-level await, and both use
`import.meta.url` to guard their standalone CLI. Bundling can change that guard's
meaning. Neither dependency is changed
by this slice. No proposed skill is installed and no production configuration is
enabled by these files.

## Inputs and preview

For a standalone offline preview without host mutation configuration, run:

```sh
node deploy/selver/preview.mjs SPEC BASELINE
```

This entrypoint computes the supplied specification's hash and reports
`authority:not_assessed`. It makes no provider request, reads no session and
does not grant authority for the apply command. Its freshness and mechanical
audit requirements are the same as the configured preview below.

Use the existing audit specification format: `requirements` have `id`, `name`,
`grams`, nonempty `identityTerms`, and optional `lactoseFree`. Selected `cart`
lines have `sku`, `name`, `quantity`, `unitPriceEur`, `unit` (`kg` or `packs`),
`netGramsPerPack` for packs and `for` requirement IDs. Add:

- `account`: exact expected account display name.
- `cartId`: already established account cart ID.
- `sourceSha256`: hash of the fixed source evidence.
- Each selected line: `step` and `catalogEvidenceSha256`.
- Optional `removeSkus`: exact existing SKUs to delete.
- `ceilingEur`: maximum total for the **whole resulting cart**, including preserved
  items and provider-reported fees. Optional `feesEur` affects the selection estimate.

The baseline uses the existing authenticated snapshot shape:
`{signedInAs, cartId, observedAt, totalEur, cart:[{sku, quantity, itemId}]}`.
The library `makePlan(spec, baseline, expectedSpecHash)` validates the fixed spec,
product steps, quantity coverage and observed account/cart, then returns explicit
changes and preserved quantities. Preview requires a snapshot at most two minutes
old. Apply/reconcile can reuse the original baseline for durable recovery; every
execution observes the current cart and requires exact preconditions before writing.

The host computes `digest(spec)` from `plan.mjs` after reviewing the source-to-spec
translation and SKU choices, and pins it in `specHash`. These hashes prevent
accidental input drift; **hashes are not proof of source correctness, catalog
truth or user approval**. The host must retain and verify the referenced evidence.
Product identity checks inherited from the existing audit use name substrings;
they do not establish dietary suitability or resolve ambiguous substitutions.

All CLI JSON inputs must be regular nonsymlink files, <=1 MB, mode0600. The state
directory must be absolute, mode0700 and nonsymlink. Use one durable directory
for all instances sharing a cart; its exclusive lock serializes all operations.

```sh
node deploy/selver/main.mjs preview CONFIG SPEC BASELINE
node deploy/selver/main.mjs apply CONFIG SPEC BASELINE OPERATION_ID
node deploy/selver/main.mjs reconcile CONFIG SPEC BASELINE OPERATION_ID
```

`preview` never contacts Selver or reads session credentials. `apply` requires
host configuration `cartUpdatesEnabled:true`. `reconcile` requires
`cartReadsEnabled:true` and an existing receipt, makes only account/pull/totals
requests, and never starts remaining mutations. Both flags default false in the
example. An operation ID binds to the original exact plan. Repeating it resumes
verified progress rather than recreating earlier changes.

The CLI reads the existing private session format `{token, account}`. It never
accepts caller-provided approval flags and exposes no checkout endpoint. Root
integration must keep configuration, sessions and receipt state inaccessible for
writing by bot shell users: **same-UID mode0600 is not an approval boundary**.
Until trusted authority and stronger identity integration exist, leave updates
disabled. A service wrapper must create plans from validated inputs, rather than
accept arbitrary caller-authored `plan` objects into the trusted library runner.

## Provider and recovery behavior

The existing client's `read()` POSTs `/api/ext/tkg-sales/cart/merge`. This adapter
intentionally does not use that method: it requires a previously connected cart
ID, calls `/api/cart/pull` twice and checks `/api/cart/totals`. Reconnection or cart
ID discovery remains an explicit upstream workflow. The old merge behavior is
not qualified as side-effect-free and is never used for a reconciliation probe.

Requests check the existing account display-name identity before each cart call,
use a 15-second timeout, refuse redirects and cap each response at 1 MB. Display
names are not unique account identifiers. The session and cart must be pinned by
the host; stable account-ID qualification is still needed before unattended rollout.

Before each mutation, the receipt is fsynced with its pending step, and the full
cart is rechecked. Afterward the full quantity map is read and matched, including
unrelated items. Selver has no verified conditional-write/CAS contract here;
a concurrent external change between the check and write remains a race. The
local lock protects only cooperating processes using this directory. A matching
state proves the observed desired state, not which actor caused it.

On a lost response or process interruption, `reconcile` observes the exact next
state. If that state is present, it advances the receipt without repeating the
write. If the state is unchanged or different, the outcome remains `unknown`:
an unchanged snapshot cannot prove the pending request will never arrive. No
automatic reissue, rollback or deletion occurs. The higher layer must resolve
provider evidence before a fresh operation is authorized.

An interrupted process leaves `reconciliation.lock`. The operator must establish
that its recorded PID is no longer running and no request remains active before
removing only that lock. The next action is reconciliation with the original
operation ID, not a new apply operation. Locks are never stolen by age alone.

Final receipt `achieved` means exact selected/preserved SKU quantities observed,
the fixed-spec estimate passed its mechanical audit, and the fresh provider total
is within the full-cart ceiling. It does not mean an order was placed, individual
prices were verified against catalog evidence or the user's overall shopping
objective was achieved. `conflict`, `read_failed`, `budget_failed`, `unknown` and
`verification_failed` retain progress and require the responsible higher layer.
Reconcile can return `ready_to_resume`; apply then continues under unchanged authority.
The utility does not automatically route these states to an orchestrator.

## Verification

```sh
node --test deploy/selver/selver.test.mjs
./node_modules/.bin/oxlint deploy/selver/*.mjs
```

The 17 tests cover pure preview/intent validation, preserved items, exact serial
application, restart/replay, response loss before and after effects, persisted
pending state before mutation, account/precondition failure, locks, budgets,
response bounds/redaction and actual CLI invocation. A synthetic fetch fixture
runs the actual BFF transport and proves that no merge request occurs. Tests use
temporary directories and fake accounts only. No production browser, session,
cart, API, app or bot was touched. Live service contracts and runtime adoption
remain unqualified; these results are not evidence of a completed shopping task.
