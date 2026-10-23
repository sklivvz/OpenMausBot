# Bolt Food mechanical browser operations

## Status

Source implementation, with synthetic verification. This does **not** establish
that a live Bolt order can be prepared or paid successfully. No live order or
cart mutation was used for verification, and no personal browser was accessed.
The implementation uses the native `chrome` browser engine; the legacy
`agent-browser` engine does not expose this tool.
The tool is omitted from discovery until the operator installs a DOM profile,
so the incomplete default mappings add no tool-schema cost to normal bot turns.

`agent_browser_bolt` runs bounded browser actions in the existing profile lane,
with the browser control lock, secret protection, current-turn guard and call
deadline. It reads structured state and sends native CDP input. Bot arguments
contain no selectors or JavaScript.

| Area | Actions |
| --- | --- |
| Inspect and navigate | `inspect`, `read_session`, `list_saved_addresses`, `select_saved_address`, `open_branch`, `search_branch`, `open_product`, `close_product` |
| Configure an item | `read_item_options`, `set_item_options`, `set_product_quantity`, `read_item_comment`, `set_item_comment`, `add_configured_product` |
| Basket and delivery | `open_basket`, `read_basket`, `set_basket_quantity`, `list_fulfilment_options`, `select_fulfilment`, `list_delivery_options`, `select_delivery_option` |
| Checkout and outcome | `read_checkout`, `request_payment_approval`, `pay`, `read_order`, `reconcile_operation` |

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

`set_item_comment` accepts `text` and verifies it on the item. It does not alter
the courier comment. The add operation verifies the configured item, options,
comment and quantity against the basket baseline, and refuses a product sheet
that is editing an existing line. Delivery choices are read dynamically with
their current identifiers, labels, availability, fees and ETA.

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
Search verification requires evidence that results correspond to the requested
query and are no longer loading; an updated input value alone is insufficient.
A disposable, signed-out browser visit to the public Tallinn page also remained
on the loading screen after a bounded wait. It yielded no additional mappings.

Remaining: capture and qualify the missing real-site mappings; verify the entire
approval/continuation flow in an isolated app fixture with those mappings; then
deploy the native server change and route the ordering skills through it.
Approval cards are persisted, but accepting one does not itself enqueue a new
agent turn. Automatic continuation after approval still needs qualification.
Until then, live purchasing through this tool is not ready.

## Verification

Run with a dedicated Chrome for Testing binary (the helper creates a new,
temporary profile and removes it afterwards):

```sh
OMB_CDP_CHROME=/absolute/path/to/chrome pnpm exec vitest run \
  server/browser/bolt server/browser/tools.test.ts \
  server/browser/service.test.ts server/browser/engines.test.ts \
  src/components/ApprovalCard.test.ts
pnpm typecheck
pnpm lint
```

The real browser fixture serves synthetic HTML on loopback and injects that
origin only through a test constructor. Production tools pin
`https://food.bolt.eu`. Tests exercise actual radio and checkbox clicks, quantity
changes, textarea input and four delivery choices. Separate runner and approval
tests cover validation before effects, exact configuration, uncertain outcomes,
restart receipts, duplicate payment, expired/denied/cross-scope approvals and
order evidence. They do not establish compatibility with Bolt's current DOM.

The standard isolated app fixture was also launched successfully and its
`doctor` reported no problems. It used only the fake engine and disposable data;
this is an app startup check, not an end-to-end live purchase test.
