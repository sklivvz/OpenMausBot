---
name: selver-shopper
description: Build or correct a Selver grocery cart from a fixed meal plan using direct catalog queries and a quantity, diet, and budget audit. Use for Selver product selection and cart reconciliation; checkout remains a separate user decision.
---

# Selver shopper

Keep the source meal plan and serving counts fixed. A budget target is a constraint on product and pack selection, not permission to replace dishes or ingredients. Use lactose-free products for every dairy allocation when requested. Do not use past orders to infer quantities.

Before editing a cart, establish the person's intended Selver account and cart ID from that cart's authenticated session. The built-in browser can hold a different cart from the person's browser even under the same account. Require `SELVER_SESSION_FILE` to point to a provisioned session for the intended cart, containing its token, cart ID and account name. Do not create that file from a guest cart, a bot-authored snapshot or another browser profile. If the target session is unavailable, stop without writing or claiming delivery.

Use the direct Selver catalog client at `$HOME/.openmausbot/tools/selver-bff.mjs` to find and price candidates. For example:

```sh
node "$HOME/.openmausbot/tools/selver-bff.mjs" search 'kalkuni rinnafilee' --grams 260 --contains kalkuni,rinnafilee --category Linnuliha
```

The client reads Selver's `/api/catalog/vue_storefront_catalog_et/product/_search` endpoint. Its product price and weight step are current catalog observations. Search results can contain unrelated products, including pet food, and do not prove in-cart availability. Use category and exact ingredient terms, then check product identity, ingredients, lactose-free labeling, edible or drained quantity, and the actual accepted cart quantity before choosing one. A truncated result means the query did not exhaust the catalog. The cart BFF requires a session token and an unauthenticated direct call returned 401 on 18 October 2026.

Read the target cart with `node "$HOME/.openmausbot/tools/selver-cart-bff.mjs" read`. Change one SKU with `node "$HOME/.openmausbot/tools/selver-cart-bff.mjs" change SKU TARGET_QUANTITY`; zero removes an existing SKU. This client calls Selver's API directly, checks the backend account and full cart before and after a write, and refuses a mismatched result. Stop on any error. Never use browser clicks, page JavaScript, or another cart to repair it.

Before calling a cart complete, write an audit JSON file with the fixed plan requirements and a fresh cart snapshot, then run `node "$HOME/.openmausbot/tools/selver-bff.mjs" audit PATH`. The input contract is in `node "$HOME/.openmausbot/tools/selver-bff.mjs" schema`. Every required ingredient must be mapped to a purchased line or reported missing. The audit checks total price, quantity coverage, major excess, lactose-free labeling, and ingredient identity terms. Treat a failed audit as unfinished work: search more same-ingredient options, adjust cart quantities, and rerun. Do not turn an over-budget cart into a menu-change proposal unless the person explicitly asks for menu changes.

Before reporting a cart total or account, run the direct cart client's `read` command against the provisioned target session. If it fails, state that the real cart is unverified. Run the ingredient audit against those returned lines and report its failures. The local `verify-delivery` command rejects bot-authored cart files; they cannot establish account ownership.

If catalog searches establish that no suitable Selver pack meets a requirement or the budget, return the exact item, required amount, cheapest observed suitable pack and price, queries and candidate SKUs checked, and the smallest unresolved gap. Preserve the menu and current cart; do not say a lower-cost cart is impossible from a few search results. Do not order or pay without an explicit request.
