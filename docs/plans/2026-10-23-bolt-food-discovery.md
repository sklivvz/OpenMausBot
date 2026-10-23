# Bolt Food grocery and takeaway discovery

## Result and limits

The existing records are sufficient to specify a bounded browser executor and
deterministic basket/quote checks. They are **not sufficient to implement a
customer API connector**. No customer API request/response contract was recovered
from the inspected Bolt records. The public Bolt API found is a merchant/POS
integration, not an eater checkout API.

Scope: groceries and restaurant meals, including delivery and the separately
selected pickup mode. Dine-out is excluded. This investigation read historical
tool results, current skill metadata and public documentation. It did not control
any browser, sign in, change a cart, submit an order or change bot configuration.
Direct unauthenticated HTTP retrieval of `https://food.bolt.eu/` returned 403;
the web reader returned the JavaScript-required shell. Neither establishes the
current authenticated UI. The recorded UI evidence below is from 16 and 23
October 2026, not a new live walkthrough.

The [machine-readable inventory](2026-10-23-bolt-food-discovery.json) separates
historical tool evidence, historical agent-written instructions, current
configuration and public documentation. Private snapshots remain outside Git.

## What is installed and what was learned

Read-only `/api/bots/:id/skills` inspection found Donna's enabled
`takeout-ordering` and both bots' `browser-task-recovery`. The Dude has
`grocery-plan-reconciliation` and Selver-specific skills. Neither returned
`bolt-food-order` in its current skill inventory.

The original learning thread does retain a substantial `bolt-food-order` skill
creation and subsequent updates. Its steps agree with several independent
recorded browser results. It covers address selection, restaurant/store browsing,
item options, cart, checkout and account recovery. It must not simply be restored
unchanged: it suggests adding/removing test items in a real cart, treats historical
fee thresholds as reusable facts, and has no durable operation or approval gate.
The current takeout skill contains the stronger authority rules but no executable
Bolt mechanics. These are two different missing pieces.

The public [Bolt Food page](https://bolt.eu/en/food/) describes web ordering,
groceries and pickup. The [Bolt Market page](https://bolt.eu/en/food/market/)
describes store selection, product selection and fulfilment tracking. Availability
still depends on the actual destination and branch.

## Recorded browser flow

The table describes observed states and a proposed executor contract. State
transitions need fresh observations; ephemeral `@e...` references are not stable
selectors or provider identifiers.

| Stage | Grocery flow | Restaurant flow | Mechanical check / escalation |
| --- | --- | --- | --- |
| Session | Public storefront can browse while signed out. Adding the first item historically opened phone/SMS sign-in. | Same observed gate. | Bind account and browser session explicitly. A signed-out worker does not prove the lead is signed out. Existing personal sign-in dependency goes to Donna once. |
| Destination | Address suggestion or saved address determines eligible branches, availability and ETA. | Same; delivery and pickup are separate modes. | Verify selected address/pin, intended recipient and mode before searching or quoting. Store private address outside ordinary tool output. |
| Discovery | Store page, categories, in-store search, product details. Bolt Market, Rimi and Selver branches were browsed. | Restaurant page, categories and dish search; unavailable branches can say “Back soon.” | Branch identity, availability and observation timestamp must accompany every candidate. Do not infer a complete catalogue from visible carousel cards. |
| Product suitability | Pack size, number of actual rolls, chilled/fresh storage, explicit lactose-free/Greek claims mattered in the recorded task. | Dish, portion, preparation, dietary constraints, required modifier groups and optional paid extras. | Code handles units, pack counts and hard constraints. Jev may classify evidenced attributes as match/mismatch/uncertain; it cannot infer missing allergen or storage facts. |
| Add/update | Product detail has an Add/Update control and quantity. | Simple items can add directly; other dishes require option selection. | Pin branch/item/options and verify exact quantity delta and unchanged unrelated rows. Relative `+` clicks need a verified baseline; they are not safely retryable after ambiguity. |
| Branch change | “Start a new order?” warned that it would remove the previous branch's order. | The same warning occurred moving restaurant. | Preserve the existing basket. A generic Confirm handler must never accept every modal. Branch replacement needs scoped authority and a before/after manifest. |
| Checkout | Shared one-page checkout and grocery-specific basket entry controls. | Shared checkout with Standard/Priority/Pickup, where supported. | Extract the complete item/options manifest, delivery selection, all fees, discounts, tip, currency, payment choice and final total. Menu price and header subtotal are not payable total. |
| Commit | A recorded click was followed by “Processing order,” then an active-order page and “Preparing your order.” | Recorded order placement uses the same consequential pay control. | Host verifies exact authority immediately before one submission. Persist intent before the call; an ambiguous response enters reconciliation, never automatic repurchase. |
| Fulfilment | Grocery final quantities, substitutions, missing items and refunds require later verification. | Merchant acceptance, delivery/pickup progress and actual receipt are distinct. | Order-created, paid, merchant-accepted and delivered are separate states. User confirmation is evidence with its own source, not a provider status read. |

### Selectors recovered from actual DOM/tool results

These are historical candidates, not a promise of current stability. Each use
must check uniqueness, visibility, enabled state, containing item/branch and the
expected resulting state. Do not depend on generated CSS classes.

| Purpose | Observed selector/test ID | Evidence |
| --- | --- | --- |
| Main basket | `components.MainNavigationMenu.viewBasketButton` | E04, E08 |
| Grocery basket | `screens.Groceries.GroceriesScreen.activeBasketButton` | E08 |
| In-store search | `screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input` | E06 |
| Search-view basket | `screens.Provider.Menu.ProviderMenuStickySearch.viewBasket` | E08 |
| Product Add | `components.ProviderDish.addButton` | E05 |
| Product cards | `components.GridMenuDishBase.button` | E06 |
| Dish-detail close | `screens.Provider.Dish.DishBottomSheet.closeButton` | E06; observed as a DIV, not always a button |
| Basket quantity | `components.CheckoutItem.checkoutItemCounter.minus` and `.text` | E04 |
| Pay control | `screens.OnePageCheckout.confirmSimpleButton`; accessible label includes “Confirm order and pay” and total | E03, E04 |

The original skill also names `.plus`; that is a historical instruction, not an
independently confirmed selector in this investigation. Confirm it on capture.

## Routes versus API contracts

Observed browser navigation shapes are:

```text
https://food.bolt.eu/en/<cityId>-<city>/
https://food.bolt.eu/en/<cityId>-<city>/p/<branchId>-<slug>/
https://food.bolt.eu/en/<cityId>-<city>/p/<branchId>/smc/<categoryId>/
https://food.bolt.eu/en/<cityId>-<city>/checkout/<branchId>/
https://food.bolt.eu/en/<cityId>-<city>/activeOrder/<orderId>/
https://food.bolt.eu/en/profile/details/
https://food.bolt.eu/en/profile/orders/
```

These are page routes, **not customer API endpoints**. Category-route semantics
are inferred from its recorded use in a grocery page and need qualification.
No HTTP method, body schema, authentication mechanism, idempotency key or error
contract for customer catalogue/cart/quote/submit/status was established.

The same old learning thread contains direct `/api/catalog/...` and `/api/cart/...`
calls, but their context is **selver.ee**. They must not be copied into a Bolt
connector. The [public developer page](https://developer.bolt.eu/delivery/main/)
documents merchant menu, stock and order-handling APIs and identifies itself as
deprecated. It is useful evidence of the merchant/customer distinction, not a
route to placing customer orders. Merchant replacement/refund fields do not prove
an eater-facing substitution control exists in this web UI.

## What wastes work and what can become deterministic

In the inspected Donna thread, the grocery window 07:35–08:15 UTC on 23 October
contains **113 browser calls**, including retail comparison; 9 have `tool.ok=false`.
The lunch window 10:10–10:35 contains **113**, with 4 `tool.ok=false`. These are
window counts, not Bolt-only totals, token costs, or all semantic failures.

Observed failure patterns:

- Multiple basket controls exist in different views. One generic text selector
  missed a visible Add button because its label was split across child nodes.
- Search, product detail, replacement confirmation and priority information can
  overlay one another. The browser reported covered controls repeatedly.
- A selector valid in one state was absent in the next. The close target could be
  a DIV; assuming `role=button` failed.
- An open operation timed out ambiguously; the next evaluation was blocked while
  the earlier operation remained busy. Restarting would discard state.
- Reusing a top-level `const` name in persistent evaluation produced a redeclaration
  error. A bounded helper can avoid this interpreter mistake entirely.
- A worker viewing an existing order was signed out and saw “No orders,” while
  the lead's earlier authenticated evidence showed an order. “No orders” in that
  state is not evidence that submission failed.
- The source quote can contain discounts: one observed checkout had subtotal
  €28.00, service €1.99 and displayed delivery €5.39, but payable total €31.38.
  Adding only positive visible rows would produce a wrong total. The full signed
  breakdown and final pay amount must reconcile.

Suggested order of implementation, with business outcomes for Marco to accept:

| Priority | Small outcome | Deterministic work | Remaining reasoning/discovery |
| --- | --- | --- | --- |
| 1 | A proposed grocery basket or meal cannot silently change when approved. | Normalize a complete checkout snapshot; integer-minor-unit arithmetic; item/options/fees/destination fingerprint; expiry and change detection; exact human decision linkage. | Prove snapshot completeness across both UI flows; capture discounts and priority charges correctly. |
| 2 | Preparing a basket stops wasting turns on the same popup. | Typed state detector and bounded transition helper for search/detail/basket/known modal; no blind clicks; explicit unknown state and recovery receipt. | Fixture corpus plus later read-only fresh UI qualification; unknown modal goes to discovery, not generic Confirm. |
| 3 | Compare complete eligible baskets without repeatedly rereading pages. | Persist branch/item observations, freshness, pack/unit arithmetic, missing requirements and ETA eligibility; cache immutable attributes separately from volatile prices/stock. | Jev for narrow evidence-backed suitability; price-only candidates cannot fill missing diet/freshness requirements. |
| 4 | One approved basket is submitted once and its outcome is tracked. | Protected commit service; durable intent/receipt/lock; order-history reconciliation; bounded status checks; no retry after unknown write. | Customer submit/status contract and session ownership are still unqualified. Checkout remains unavailable until those are proven. |
| 5 | Remove browser cost for established operations. | Replace each qualified browser primitive with a narrow BFF client/MCP, retaining the same contracts and tests. | Capture the actual customer network requests during later authorized usage; do not invent endpoints. |

This ranking is a proposal, not authorization to implement all five or operate
the user's account. The selected task was discovery.

## Purchase authority and exact quote contract

Donna's installed takeout policy already says that urgency, a budget ceiling,
silence and preparation requests do not authorize an arbitrary meal. The user's
reported wrong, unapproved, disproportionately expensive lunch is the regression
case. This investigation does not claim a forensic cause for that particular
incident from a different order's trace.

A proposed local contract should contain:

- Immutable operation ID, objective/request reference, account/session binding,
  observation timestamp and source evidence identifiers.
- Branch ID, item IDs, exact names, quantities, modifier IDs/choices, portions,
  unit/pack quantities and requirement-to-item mapping. Missing IDs or option
  coverage means `incomplete`, not approval-ready.
- Private destination reference and verified address/pin fingerprint, fulfilment
  mode, selected delivery tier, courier notes and payment-method reference.
- Currency, integer-minor-unit item subtotal, every signed adjustment/discount,
  fees, tip, deposit if present, and authoritative payable total. Unknown fee
  composition is explicit; a selector reading only the pay label is insufficient.
- Current ETA/window with explicit source timezone, availability and quote expiry.
- Exact approval source and subject hash, allowed substitution policy if any,
  plus a revocation/stop generation checked immediately before submit.

`approved: true`, an agent-written file or a quoted message supplied by a tool
caller is not a grant. A host-owned approval record must bind the user decision
to the exact manifest. Same-UID file permissions do not stop a bot with shell
access from forging that record; the commit service needs a real process/identity
boundary, with bot tools unable to call checkout outside it.

Before committing, re-read account, cart and total, compare the approved manifest
and inspect newer corrections. An out-of-scope change returns `approval_stale`
with the concrete diff. A missing login returns one session-specific dependency.
A pending or ambiguous submission returns `reconcile_required`, preserving
ownership. Successful payment alone does not establish correct fulfilment.

The [pricing support page](https://bolt.eu/en/support/articles/360007249339/)
confirms separate delivery, small-order and service charges. The historical
€1.20 item/€12.81 checkout demonstrates why no old free-delivery threshold or
menu-price assumption belongs in code. Current quote evidence must decide.

## Remaining discovery and qualification

1. **Session and protocol capture:** obtain a dedicated automation session through
   the supported user sign-in flow when that work is authorized. Do not attach to
   the user's browser or extract tokens from its profile. Record redacted
   request/response schemas and operation effects for public catalogue, account,
   cart, quote, order lookup and eventual submit. Current direct HTTP returned 403;
   do not bypass that response. No new sign-in is requested by this report.
2. **Grocery cases:** weighted items, deposits, quantity limits, stock changes,
   substitutions/refund preferences, multiple identical products with differing
   options, branch switching and partial fulfilment. Existing records do not
   establish these contracts.
3. **Restaurant cases:** required min/max modifiers, conflicting choices, notes,
   allergies, closed venue, pickup, scheduled delivery and unavailable items.
   [Scheduling support](https://bolt.eu/en/support/articles/360007268239/) describes
   an option, but its availability in this account's web flow is unverified.
4. **Payment and recovery:** 3DS/bank redirect, expired session, quote changes,
   provider errors, request timeout before/after acceptance, duplicate detection
   and trustworthy final status. No duplicate-safe customer API capability is
   currently established. Never qualify these by creating synthetic live orders.
5. **Verification:** test the parser/guard/state machine against synthetic and
   redacted captured fixtures first, including old approval/new basket, later
   stop, discounted delivery, stale session and unknown-write cases. Only then
   qualify read operations in an authorized dedicated session. Actual writes
   belong to genuinely requested, approved purchases with immediate evidence.

Cancellation is not a compensating transaction the system may rely on. Public
support is market/state-dependent; the [Polish support article](https://bolt.eu/en-pl/support/articles/4405062492690/)
limits in-app cancellation by order state and describes restrictions on changes.
It is not proof of cancellation availability in Tallinn or for a specific order.
This work did not attempt cancellation or contact a merchant/courier/support.

## Delivery accounting

- **Completed:** existing skill/config inspection, recorded grocery and restaurant
  flow analysis, selector and route inventory, failure patterns, deterministic
  slice proposals, exact-approval boundary and qualification checklist.
- **Blocked by unavailable evidence/access:** current authenticated UI and customer
  network contracts, not the entire discovery investigation.
- **Pending:** root review and choice of a business increment.
- **Not attempted:** browser control, live catalogue API calls, carts, checkout,
  cancellations, bot changes, production implementation or deployment.

This is documentation-only. No server or conversation behavior was changed, so
no application-mutation fixture is claimed. Evidence references and the JSON
inventory were checked locally; they do not qualify a live connector.
