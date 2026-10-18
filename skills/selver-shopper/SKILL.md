---
name: selver-shopper
description: Build or correct a Selver grocery cart from a fixed meal plan using direct catalog queries and a quantity, diet, and budget audit. Use for Selver product selection and cart reconciliation; checkout remains a separate user decision.
---

# Selver shopper

Keep the source meal plan and serving counts fixed. A budget target is a constraint on product and pack selection, not permission to replace dishes or ingredients. Use lactose-free products for every dairy allocation when requested. Do not use past orders to infer quantities.

Before editing a cart, establish which Selver account and browser cart the person expects to receive. Require both Selver's `user/isLoggedIn` getter and a user token in the active browser, as well as the expected account label. The label alone can remain visible after authentication expires. A guest cart or a different browser profile is a separate draft, even if its contents persist after reload. Do not call that cart the person's cart, quote its total as the person's current total, or claim delivery. Stop writes to the separate cart and report the mismatch. A catalog search has no cart or account identity. Before signing in from a guest session, inspect and save its cart: Selver may merge it into the account cart during sign-in. Never start sign-in while the guest cart contains items. If every guest item was added by this bot for this task, save its SKU and quantity snapshot and empty that guest cart before signing in. Otherwise, stop and report that login would risk merging someone else's items. After sign-in, verify the account cart before editing it.

Use the direct Selver catalog client at `$HOME/.openmausbot/tools/selver-bff.mjs` to find and price candidates. For example:

```sh
node "$HOME/.openmausbot/tools/selver-bff.mjs" search 'kalkuni rinnafilee' --grams 260 --contains kalkuni,rinnafilee --category Linnuliha
```

The client reads Selver's `/api/catalog/vue_storefront_catalog_et/product/_search` endpoint. Its product price and weight step are current catalog observations. Search results can contain unrelated products, including pet food, and do not prove in-cart availability. Use category and exact ingredient terms, then check product identity, ingredients, lactose-free labeling, edible or drained quantity, and the actual accepted cart quantity before choosing one. A truncated result means the query did not exhaust the catalog. The cart BFF requires a session token and an unauthenticated direct call returned 401 on 18 October 2026.

Cart button clicks and immediate Vuex reads can report an optimistic quantity before Selver saves it. Never batch quantity clicks or infer persistence from the page before reload. For each cart change, save a signed-in cart snapshot with `signedInAs`, `observedAt`, and every SKU and `quantity`. For an existing SKU, run `node "$HOME/.openmausbot/tools/selver-bff.mjs" cart-set-script BEFORE_JSON SKU TARGET_QUANTITY`. For a new SKU, open its product page and run `node "$HOME/.openmausbot/tools/selver-bff.mjs" cart-add-script BEFORE_JSON SKU QUANTITY`. Execute the generated script once with `agent_browser_eval` and require `serverActionResolved: true`. Reload the same signed-in cart, capture a new snapshot, and run `node "$HOME/.openmausbot/tools/selver-bff.mjs" verify-cart-change BEFORE_JSON AFTER_JSON SKU TARGET_QUANTITY`. Proceed to the next change only when that command exits successfully. Stop on any mismatch; do not repair it by guessing more clicks.

Before calling a cart complete, write an audit JSON file with the fixed plan requirements and a fresh cart snapshot, then run `node "$HOME/.openmausbot/tools/selver-bff.mjs" audit PATH`. The input contract is in `node "$HOME/.openmausbot/tools/selver-bff.mjs" schema`. Every required ingredient must be mapped to a purchased line or reported missing. The audit checks total price, quantity coverage, major excess, lactose-free labeling, and ingredient identity terms. Treat a failed audit as unfinished work: search more same-ingredient options, adjust cart quantities, and rerun. Do not turn an over-budget cart into a menu-change proposal unless the person explicitly asks for menu changes.

Before reporting any cart total or account, use `agent_browser_selver_cart` in the browser that holds the cart. This server tool checks Selver's authenticated account state, compares the displayed cart with two persisted cart pulls, and returns the account, lines and total. If it fails, state that the real cart is unverified. Run the ingredient audit against those returned lines and report its failures. The local `verify-delivery` command rejects bot-authored cart files; they cannot establish account ownership.

If catalog searches establish that no suitable Selver pack meets a requirement or the budget, return the exact item, required amount, cheapest observed suitable pack and price, queries and candidate SKUs checked, and the smallest unresolved gap. Preserve the menu and current cart; do not say a lower-cost cart is impossible from a few search results. Do not order or pay without an explicit request.
