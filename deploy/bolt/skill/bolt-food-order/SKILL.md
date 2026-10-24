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

Read this procedure before using the browser. Use `agent_browser_bolt` when it
is exposed and supports the needed action. Otherwise follow the recorded browser
sequence below with the bot's mounted browser tools. This is an existing browser
procedure, not permission to rediscover the entire site or use the user's desktop.
Do not claim the mechanical tool exists merely because this skill describes it.

## Mechanical operation route

Start with `inspect` or the relevant read. Use the returned `observationRef` and
`targetRef`, never invented selectors or IDs. Give each mutation a stable
`operationId`; preserve it through interruption. A `pending` or unknown result
requires `reconcile_operation` with that ID before another mutation. Do not use
another route to bypass an unresolved effect.

- Session and destination: `read_session`, `list_saved_addresses`,
  `select_saved_address`.
- Menu: `open_branch`, `search_branch`, `open_product`, `close_product`.
- Item: `read_item_options`, `set_item_options`, `set_product_quantity`,
  `read_item_comment`, `set_item_comment`, `add_configured_product`.
- Basket: `open_basket`, `read_basket`, `set_basket_quantity`.
- Fulfilment: `list_fulfilment_options`, `select_fulfilment`,
  `list_delivery_options`, `select_delivery_option`.
- Checkout: `read_checkout`, `request_payment_approval`, `pay`, `read_order`.

For option groups supply every group with `{groupRef, choices:[{choiceRef,
quantity}]}`, including empty lists for unselected optional groups. Respect
single/multiple choice limits and counted extras. Quantity setters include
`expectedQuantity`; zero removes the selected basket line. Item comments are
separate from courier instructions. Read available delivery choices dynamically;
never assume a fixed number, position, price or ETA. Payment requires the host's
accepted exact-checkout card and `approvedCheckoutRef`, followed by fresh checkout
comparison. A bot-authored approval assertion is not the card.

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
6. **Add.** Record the basket baseline. Use the sheet's
   `components.ProviderDish.addButton` once; confirm the resulting line, options,
   item comment and quantity. In edit mode the action may be Update: do not treat
   it as adding another item. Close the sheet using its observed close control;
   the recorded ID is `screens.Provider.Dish.DishBottomSheet.closeButton`.
7. **Basket.** Open `components.MainNavigationMenu.viewBasketButton`, or the
   grocery control `screens.Groceries.GroceriesScreen.activeBasketButton`, or the
   search control `screens.Provider.Menu.ProviderMenuStickySearch.viewBasket`.
   Inspect actual rows. Scope minus/plus to the matching row; the recorded minus
   ID is `components.CheckoutItem.checkoutItemCounter.minus`, quantity `.text`.
   Discover the current plus control rather than assuming symmetry. Verify each
   absolute target quantity; keep rows with different options/comments distinct.
8. **Fulfilment and delivery.** Read all currently offered choices, including
   unavailable ones. Select delivery versus pickup only within the request.
   Then list available delivery tiers with exact fee and ETA. There may be one
   to four choices; choose by current labels, never ordinal position. Do not
   add priority delivery without authority. Verify the selected option and total.
9. **Checkout.** Read every item, option, comment, destination, fulfilment,
   delivery tier/ETA, courier instruction, payment method, subtotal, adjustments
   and total. Fees and discounts must come from checkout, not inferred sums.
   Give Donna this exact basket and total for the user decision. A menu-price
   approval, budget ceiling or urgency does not approve an arbitrary paid basket.
10. **Pay and reconcile.** Check the latest user decision and fresh checkout.
    Only explicit authority for this basket permits the observed confirm/pay
    control (`screens.OnePageCheckout.confirmSimpleButton`, accessible text
    includes Confirm order and pay plus total). Submit once. A timeout or lost
    response means inspect the active order/history, never click again blindly.
    Verify order reference, restaurant, items, paid total and arrival/status.
    Report an unresolved result honestly and retain the operation evidence.

STOP cancels pending purchase authority. Changes outside an explicit substitution
policy require a new decision. Do not place a replacement order to repair a bad
one. No test items, test payments, automatic basket clearing, fabricated orders
or hidden page handlers. On a browser stall use browser-task-recovery once,
preserving the basket and resume point; escalate the concrete remaining blocker
through Donna instead of repeating navigation or abandoning independent work.
