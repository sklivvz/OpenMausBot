# Bolt Food mechanical browser operations

## Status

Source implementation with synthetic/local verification. This does **not**
establish that a live Bolt order can be prepared or paid successfully. No live
order, cart or personal browser was used for verification.

`agent_browser_bolt` is advertised on both browser engines. The legacy
`agent-browser` path uses its own mounted tools for URL, evaluation, click, fill
and navigation while retaining the same deterministic state machine, operation
IDs, journal and payment authority as the native Chrome path. The built-in
mapping profile comes from recorded 16/23 October 2026 Bolt DOM captures; a host
may load additional reviewed bindings from
`<dataDir>/browser/bolt/dom-bindings.json`. An absent profile now falls back to
that built-in evidence instead of silently withholding the tool.

`agent_browser_bolt` runs bounded browser actions in the existing profile lane,
with the browser control lock, secret protection, current-turn guard and call
deadline. It reads structured state and sends native input on either engine. Bot
arguments contain no selectors or JavaScript.

The built-in mappings support only the subset observed in the captured pages.
Unsupported actions fail before any browser effect. The complete operation
vocabulary remains available for later reviewed mappings.

| Area | Built-in support |
| --- | --- |
| Inspect and navigate | `inspect`; `search_branch` (input-only dispatch); address-header read. `open_branch`, saved addresses and product-sheet opening remain blocked. |
| Configure an item | Blocked until dish-sheet option, quantity and comment mappings are captured. |
| Basket and delivery | `read_basket` returns loading/readiness and `rowsAvailable: false`; row edits remain blocked. `list_fulfilment_options`, `select_fulfilment`, `list_delivery_options`, `select_delivery_option` are supported. |
| Checkout and outcome | Blocked until checkout/order mappings are captured. `request_payment_approval`, `pay` and `read_order` remain the reviewed vocabulary; payment authority is unchanged. `reconcile_operation` is supported. |

## Operation contract

Start with `inspect` or a relevant read. Each mutation takes the returned
`observationRef`, a new `operationId`, and any `targetRef` from that observation.
The browser adapter checks the observed state again immediately before each
effect. Changed quotes, reordered controls, disabled controls, authentication
and unresolved overlays produce explicit errors.

`set_item_options` takes every group, including an empty choice list for a
group with no desired options. Each selection is `{groupRef, choices:
[{choiceRef, quantity}]}`. Required counts, single/multiple selection limits,
availability and counted extras are checked before any click. Quantities use
`quantity` and `expectedQuantity`. A quantity of zero removes a basket line.
Lines with different options or comments remain distinct.

`set_item_comment` accepts `text` and verifies it on the item when its mapping
exists. It does not alter the courier comment. The add operation verifies the
configured item, options, comment and quantity against the basket baseline, and
refuses a product sheet that is editing an existing line. Delivery choices are
read dynamically with their current identifiers, labels, availability, fees and
ETA. A fee that the captured control does not expose is `null`, not free.

Product-card reads preserve the displayed pack price as `per_pack`, the raw sale
description and, only when the card displays one, a sale unit and unit price.
No piece-to-kilogram, edible-yield or per-unit conversion is inferred from text.
`read_basket` returns a `basketState` (`loading`, `ready`, `rowsAvailable:false`)
and never a guessed row set, total or empty cart.

Receipts live under `<dataDir>/browser/bolt/<profile-hash>/receipts.json`, with
private filesystem modes. Intent is flushed before dispatch. An identical
operation ID returns its receipt; changing that request under the same ID is
rejected. A known failure before any browser effect is `not_executed`. An
uncertain or partially completed operation remains `pending` and prevents new
mutations. Call `reconcile_operation` with its original ID; reconciliation only
reads state. Never use a fresh ID to bypass an uncertain add or payment.
A process crash leaves a lock requiring operator reconciliation before removal;
the tool does not infer that an old lock makes a payment safe to retry.

## Payment authority

`request_payment_approval` creates a host-owned card for the exact checkout:
items and option labels, item comments, destination, fulfilment, delivery quote,
courier comment, payment method, fee breakdown and total. Details open by default
in the approval panel. The request expires after ten minutes. Only the host's
authenticated card-answer path can accept it; neither Full Access nor a bot's
`approved: true` argument supplies purchase authority.

After the user accepts the card, the executor reads checkout again and calls
`pay`, passing the card's `approvalRef` as `approvedCheckoutRef`. The tool checks
account, item-price arithmetic, adjustments, total, approval scope and expiry.
It records intent and clicks once. Reuse of an approval after a dispatched
payment is refused, even under another operation ID. Order verification requires
a new accepted order with matching account, branch, destination, configured
lines and total. A timeout is not evidence that payment failed.

These guarantees govern this operation. They do not remove the general browser
tools or create a universal payment firewall. Executors must not fall back to a
generic click/eval when the guarded operation refuses.

## DOM evidence and remaining rollout work

The built-in mappings in `server/browser/bolt/dom.ts` contain only controls
present in the saved discovery records. They support partial inspection; they
do **not** supply complete item, options, basket, delivery or checkout mappings.
Unsupported actions fail before dispatch with `action_bindings_required`.

Additional mappings are host-reviewed data loaded from
`<dataDir>/browser/bolt/dom-bindings.json` and validated by `BINDINGS`. They have a
version, evidence description and a declarative DOM tree. Callers cannot submit
or override mappings through tool arguments. Missing fields and ambiguous
selectors are errors, not guessed values. The synthetic mappings in the browser
test are not a production Bolt profile and must not be installed as one.
The recorded search evidence does not prove that result cards finished refreshing
after the input was filled. `search_branch` therefore returns
`status:"dispatched"`, `verification:"input_only"` and `searchResults:"unknown"`
instead of claiming fresh results. The caller inspects the cards before choosing
one. A disposable, signed-out browser visit to the public Tallinn page remained
on the loading screen after a bounded wait and yielded no additional mappings.

Remaining: capture and qualify dish-sheet options/comments, complete basket
rows, saved-address sheets, checkout breakdowns and order results. Until then,
those actions fail before dispatch and the recorded browser route may be used
for non-payment preparation; payment never falls back to the generic route.
Approval cards are persisted, but this repair does not change approval
continuation. Live purchasing through this tool is not qualified.

## Verification

Run with a dedicated Chrome for Testing binary (the helper creates a new,
temporary profile and removes it afterwards):

```sh
OMB_CDP_CHROME=/absolute/path/to/chrome pnpm exec vitest run \
  server/browser/bolt server/browser/tools.test.ts \
  server/browser/service.test.ts server/browser/engines.test.ts \
  server/browser-runtime.test.ts src/components/ApprovalCard.test.ts
pnpm typecheck
pnpm lint
```

The disposable DOM fixture uses the recorded mapping profile against captured
product/address/fulfilment labels and real radio controls. It proves the legacy
transport contract, search-dispatch semantics, product sale/price evidence,
basket-state read and explicit unsupported-action blockers. It is not a live
Bolt visit and does not establish compatibility with Bolt's current DOM.

The standard isolated app fixture was also launched successfully and its
`doctor` reported no problems. It used only the fake engine and disposable data;
this is an app startup check, not an end-to-end live purchase test.
