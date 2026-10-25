---
name: bolt-food-order
description: Execute discrete Bolt Food grocery and takeaway operations, including item choices, comments, quantities, delivery options and guarded checkout. Read before interacting with food.bolt.eu.
---

# Bolt Food groceries and takeaway

The Dude executes shopping and meal preparation; Donna owns the request and
returns decisions to Marco. Keep the user's chosen branch, meal, dietary
requirements, quantities, destination, deadline and authority in the assignment.
Dine-out is outside this procedure. Recommendation-only work uses public menus
first; login and checkout are not prerequisites for useful recommendations.

Read this procedure before using the browser. `agent_browser_bolt` runs on both
the native Chrome and legacy agent-browser engines. Call `inspect` first and read
its `supportedActions`. `inspect` returns fresh product cards and product-open
refs from the same observation used by `search_branch`, `open_product`, item
configuration and add, so use its `observationRef` for the first product action.
Basket actions use the `observationRef` from `read_basket`; checkout actions use
the `observationRef` from `read_checkout`. Do not reuse a product ref for a
basket or checkout action. Do not invent selectors, run ad-hoc DOM experiments,
or bypass an ambiguous or pending native effect.

## Marco's grocery comparison contract

For Marco's grocery shopping, the purchased amount must be at least 90% and at
most 200% of the required amount, unless he gives a newer item-specific rule.
These bounds replace the former symmetric 10% tolerance. Compare whole purchased
packs, never the portions that will be consumed. Convert compatible units before
calculating quantity ratios. Do not equate a count of fruit with kilograms without
an observed per-piece weight or an explicitly authorized conversion.

Compare Bolt Market, Rimi and Selver branches INSIDE Bolt Food for every requested
item before adding it. Show this exact structure in the user conversation:

ITEM TO BUY: [ingredient and required quantity]
- BOLT MARKET: [exact product / pack size × count = purchased amount / total price], or NOT FOUND
- RIMI: [exact product / pack size × count = purchased amount / total price], or NOT FOUND
- SELVER: [exact product / pack size × count = purchased amount / total price], or NOT FOUND
- CHOSEN: [store] — CHEAPEST or AVAILABILITY; [quantity ratio and line cost]

Prices must be the actual cost of the full selected pack count. Preserve the
observed product, branch, availability, quantity and price evidence for each row.
Do not call a store NOT FOUND when a tool failed or it was not checked: show
UNCHECKED/BLOCKED and resolve that comparison before choosing a winner. A search
may need the local product name or a synonym. Use bounded targeted searches;
do not repeat already evidenced searches without a change that warrants it.

Choose the lowest line cost among suitable, available offers within 90–200%.
Use AVAILABILITY only if the other two stores were actually checked and have no
suitable offer. Report delivery fees separately in the overall shop total rather
than inventing them or hiding them in the item price. Preserve dietary constraints,
including lactose-free products and requested meat cuts/fat requirements.

If all three stores lack the item, add it to MISSING ITEMS. If available packs
fall outside 90–200%, or product suitability/quantity cannot be established, add
it to EXCEPTIONS with exact products, quantities, prices and reasons for Marco's
decision. Do not add an exception without his decision. Continue independent
compliant items. A user's examples are a format, not verified stock or prices.

Work on exactly one requested item at a time. Complete its three-store checks,
then immediately post its comparison and decision as a visible chat message in
the exact format above BEFORE researching the next item. Do not batch by store,
wait for a whole-shop report, dump whole catalogs, or replace item results with
progress narration. Use already observed evidence for this item when applicable;
limit additional research to its missing facts. If blocked, report this item's
exact unresolved store check; never silently skip it or call it NOT FOUND.

Marco's current task is comparison and per-item reporting ONLY. Do not add items,
build carts afterwards, or perform unrelated work. After all requested items are
reported, await his next instruction. Missing items and exceptions belong in the
same visible item-by-item sequence. Never select an item just to prove a tool.
Purchase/payment always requires the exact checkout approval.

## Mechanical operation route

Start with `inspect`. Use the returned `observationRef` and product `ref`; never
invent selectors or IDs. Give each mutation a stable `operationId`; preserve it
through interruption. A `pending` or unknown result requires
`reconcile_operation` with that ID before another mutation. Do not use another
route to bypass an unresolved effect.

The built-in mappings now support `inspect`, `open_branch`, `search_branch`,
`open_product`, `read_item_options`, `set_item_options`,
`set_product_quantity`, `read_item_comment`, `set_item_comment`,
`add_configured_product`, `close_product`, `open_basket`, `read_basket`,
`set_basket_quantity`, `list_fulfilment_options`, `select_fulfilment`,
`list_delivery_options`, `select_delivery_option`, `read_checkout`,
`request_payment_approval`, `pay`, `read_order` (still unsupported) and
`reconcile_operation`. `search_branch` verifies that results actually changed and
returns `status: "verified"` with the matching card refs. Unsupported or
ambiguous fields fail that primitive only; they no longer discard the whole page.

- **Product:** `search_branch`, `open_product`, `read_item_options`,
  `set_item_options`, `set_product_quantity`, `read_item_comment`,
  `set_item_comment`, `add_configured_product`, `close_product`. Product cards
  preserve the displayed pack price (`displayedPriceBasis: "per_pack"`), raw sale
  description and an observed unit price. Opening a product does not require the
  checkout, option group or comment schema.
- **Basket:** read the basket before configuring a product so the host can store
  a trusted baseline. `read_basket` on a closed basket returns
  `basketRows: "not_open"` and `next: "open_basket"`; pass its `observationRef`
  to `open_basket`. An empty basket is only empty when the page exposes an
  affirmative empty state. When Bolt hides the basket button before the first
  item, `open_basket` opens the current branch's checkout route and reads its
  actual empty state. Then return to that branch with `open_branch` and configure
  the first item. The host retains that observed empty baseline for two minutes;
  refresh it if it expires. Do not substitute a guessed empty basket or raw
  browser clicks. `read_basket` returns exact rows with line totals
  (`priceBasis: "line_total"`, `lineTotalMinor`) and the observed basket total.
  `set_basket_quantity` takes the line `ref`, `expectedQuantity` and absolute
  `quantity`; zero removes that line. For a configured product, the host uses
  the trusted basket baseline even when the product sheet hides basket rows.
  Without a baseline the add fails with `read_basket_required_before_add`; call
  `open_basket`/`read_basket` first, never invent a baseline.
- **Checkout:** `read_checkout` returns complete checkout facts and an exact
  `checkoutHash` only when the quote reconciles. A partial result keeps the
  observed fees/total and lists `missing`/`conflicts`; it is not an approval-ready
  checkout. `request_payment_approval` creates the host card for the exact fresh
  checkout. `pay` re-reads that checkout, verifies the host approval against the
  fresh hash and clicks the observed pay control once. It returns
  `status: "dispatched"`, `purchase: "unverified"` and a pending receipt; it does
  not claim an order was placed. `read_order` is still unsupported, so order
  confirmation remains a separate, explicit limit. Never retry payment or use a
  new operation ID after an unknown pay result.

Product options: supply every group with `{groupRef, choices:[{choiceRef,
quantity}]}`, including empty lists for unselected optional groups. Respect
single/multiple choice limits, availability and counted extras. Item comments are
separate from courier instructions. Delivery choices are read dynamically with
their current labels, fees and ETA; never assume a fixed count, position or price.
Payment requires the host's accepted exact-checkout card and
`approvedCheckoutRef`; a bot-authored approval is not the card. The approval is
scoped to the host browser profile, not an invented provider account id. Any
changed item, option, comment, destination, delivery quote, payment method or
total needs a new approval.

## Recorded browser route

These controls were observed in October 2026 executions. Confirm that the current
page exposes the intended control before using it. Scope selectors to the exact
product, basket row or open sheet; a shared test ID alone does not identify an item.
Use one targeted read after an action instead of alternating full-page text and
screenshots repeatedly. If a control changed, inspect that section once and
retain the corrected step and evidence for skill review.

1. **Session.** Open `https://food.bolt.eu`. `Log in or sign up` means signed out.
   Public menus can still be read; address-specific delivery quotes require the
   actual session and destination. Use the mounted sign-in request if necessary;
   do not request SMS codes in chat or repeatedly search for missing saved logins.
   Return that dependency through Donna so the request reaches Marco. After login,
   verify the actual account and destination; another bot's profile is not proof.
2. **Destination.** Use `Enter your address` and select the exact suggestion, or
   open the current address control and select the intended saved address. Verify
   the displayed destination. Do not overwrite a saved address to simulate selection.
3. **Branch.** Open the observed restaurant/store link under
   `/en/<city>-<name>/p/<branch>-<slug>/`. Verify branch identity. A `Start a new
   order?` prompt replaces an existing basket: preserve it unless replacement is
   authorized. Groceries and takeaway share the basket workflow.
4. **Search.** Use the branch input with test ID
   `screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input`. Wait for
   results matching the query. Open the exact product card, observed as
   `components.GridMenuDishBase.button`, and verify its name and price.
5. **Configure.** Read required/optional groups before adding: sizes, variants,
   additions, counted extras and removals. Select only requested or authorized
   choices and verify selection and price. Set quantity on this product sheet.
   If item comments are supported, enter the exact requested comment and verify
   it remains in the item; a courier note is not a substitute. Do not silently
   discard unsupported choices or dietary instructions.
6. **Add.** Capture the trusted basket baseline before configuring the product
   (`open_basket`, then `read_basket`). Use the sheet's
   `components.ProviderDish.addButton` once; confirm the resulting line, options,
   item comment and quantity. In edit mode the action may be Update: do not treat
   it as adding another item. Close the sheet using its observed close control;
   the recorded ID is `screens.Provider.Dish.DishBottomSheet.closeButton`.
7. **Basket.** Open `components.MainNavigationMenu.viewBasketButton`, or the
   grocery control `screens.Groceries.GroceriesScreen.activeBasketButton`, or the
   search control `screens.Provider.Menu.ProviderMenuStickySearch.viewBasket`.
   Read actual rows through `read_basket`; line `Price:` is the extended line
   total (possibly the original undiscounted total), not a unit price. Scope
   minus/plus to the matching row; the recorded minus ID is
   `components.CheckoutItem.checkoutItemCounter.minus`, quantity `.text`.
   Discover the current plus control rather than assuming symmetry. Verify each
   absolute target quantity; keep rows with different options/comments distinct.
8. **Fulfilment and delivery.** Read all currently offered choices, including
   unavailable ones. Select delivery versus pickup only within the request.
   Then list available delivery tiers with exact fee and ETA. There may be one
   to four choices; choose by current labels, never ordinal position. Do not
   add priority delivery without authority. Verify the selected option and total.
9. **Checkout.** `read_checkout` every item, option, comment, destination,
   fulfilment, delivery tier/ETA, courier instruction, payment method, subtotal,
   adjustments and total. Fees and discounts must come from checkout, not
   inferred sums. A partial read is not approval-ready.
   Give Donna this exact basket and total for the user decision. A menu-price
   approval, budget ceiling or urgency does not approve an arbitrary paid basket.
10. **Pay and reconcile.** Check the latest user decision and fresh checkout.
    Only explicit authority for this basket permits the observed confirm/pay
    control (`screens.OnePageCheckout.confirmSimpleButton`, accessible text
    includes Confirm order and pay plus total). Submit once. A timeout or lost
    response means inspect the active order/history, never click again blindly.
    The guarded operation returns `dispatched` with `purchase: "unverified"`;
    order reference/items/status require a separate order read that is not yet
    mapped. Report the unresolved result honestly and retain the operation
    evidence.

STOP cancels pending purchase authority. Changes outside an explicit substitution
policy require a new decision. Do not place a replacement order to repair a bad
one. No test items, test payments, automatic basket clearing, fabricated orders
or hidden page handlers. On a browser stall use browser-task-recovery once,
preserving the basket and resume point; escalate the concrete remaining blocker
through Donna instead of repeating navigation or abandoning independent work.
