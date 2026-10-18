---
name: selver-shopper
description: Build or correct a Selver grocery cart from a fixed meal plan using direct catalog queries and a quantity, diet, and budget audit. Use for Selver product selection and cart reconciliation; checkout remains a separate user decision.
---

# Selver shopper

Keep the source meal plan and serving counts fixed. A budget target is a constraint on product and pack selection, not permission to replace dishes or ingredients. Use lactose-free products for every dairy allocation when requested. Do not use past orders to infer quantities.

Use the direct Selver catalog client at `$HOME/.openmausbot/tools/selver-bff.mjs` to find and price candidates. For example:

```sh
node "$HOME/.openmausbot/tools/selver-bff.mjs" search 'kalkuni rinnafilee' --grams 260 --contains kalkuni,rinnafilee --category Linnuliha
```

The client reads Selver's `/api/catalog/vue_storefront_catalog_et/product/_search` endpoint. Its product price and weight step are current catalog observations. Search results can contain unrelated products, including pet food, and do not prove in-cart availability. Use category and exact ingredient terms, then check product identity, ingredients, lactose-free labeling, edible or drained quantity, and the actual accepted cart quantity before choosing one. A truncated result means the query did not exhaust the catalog. For cart changes, use the existing browser session; read the resulting cart back after every batch. The cart BFF requires a session token and an unauthenticated direct call returned 401 on 18 October 2026.

Before calling a cart complete, write an audit JSON file with the fixed plan requirements and a fresh cart snapshot, then run `node "$HOME/.openmausbot/tools/selver-bff.mjs" audit PATH`. The input contract is in `node "$HOME/.openmausbot/tools/selver-bff.mjs" schema`. Every required ingredient must be mapped to a purchased line or reported missing. The audit checks total price, quantity coverage, major excess, lactose-free labeling, and ingredient identity terms. Treat a failed audit as unfinished work: search more same-ingredient options, adjust cart quantities, and rerun. Do not turn an over-budget cart into a menu-change proposal unless the person explicitly asks for menu changes.

If catalog searches establish that no suitable Selver pack meets a requirement or the budget, return the exact item, required amount, cheapest observed suitable pack and price, queries and candidate SKUs checked, and the smallest unresolved gap. Preserve the menu and current cart; do not say a lower-cost cart is impossible from a few search results. Do not order or pay without an explicit request.
