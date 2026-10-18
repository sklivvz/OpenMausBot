---
name: selver-shopper
description: Build or correct a Selver grocery cart from a fixed meal plan using direct catalog queries and a quantity, diet, and budget audit. Use for Selver product selection and cart reconciliation; checkout remains a separate user decision.
---

# Selver shopper

Keep the source meal plan and serving counts fixed. A budget target is a constraint on product and pack selection, not permission to replace dishes or ingredients. Use lactose-free products for every dairy allocation when requested. Do not use past orders to infer quantities.

To connect the account, call `agent_browser_selver_connect` in The Dude's browser. It verifies the signed-in account with Selver and returns `sessionFile` without exposing the token. Set `SELVER_SESSION_FILE` to that path for cart commands. The cart client verifies the token with Selver before every cart API request. If it reports an expired or signed-out session, stop cart requests and start Selver sign-in yourself: on `www.selver.ee`, choose `LOGI SISSE E-SELVERISSE`, then `LOGI SISSE ERAKLIENDINA`. On the Partnerkaart page, select Smart-ID, fill `Personal number` with the personal number the person already supplied for this account, and click `Sisene`. Wait for the person to approve on their phone, then call `agent_browser_selver_connect` until it verifies the authenticated account. The person does not need to interact with the browser or press Done. Do not call `request_sign_in` merely for Smart-ID phone approval. If the browser shows a failure or approval times out, report that specific state and retry sign-in when appropriate; never proceed with cart requests until connected. Do not write or claim delivery until authenticated. The direct cart client obtains the account cart ID from Selver's account-cart endpoint; do not supply or guess a cart ID. Do not create a guest cart.

Use the direct Selver catalog client at `$HOME/.openmausbot/tools/selver-bff.mjs` to find and price candidates. For example:

```sh
node "$HOME/.openmausbot/tools/selver-bff.mjs" search 'kalkuni rinnafilee' --grams 260 --contains kalkuni,rinnafilee --category Linnuliha
```

The client reads Selver's `/api/catalog/vue_storefront_catalog_et/product/_search` endpoint. Its product price and weight step are current catalog observations. Search results can contain unrelated products, including pet food, and do not prove in-cart availability. Use category and exact ingredient terms, then check product identity, ingredients, lactose-free labeling, edible or drained quantity, and the actual accepted cart quantity before choosing one. A truncated result means the query did not exhaust the catalog. The cart BFF requires a session token and an unauthenticated direct call returned 401 on 18 October 2026.

Read the target cart with `node "$HOME/.openmausbot/tools/selver-cart-bff.mjs" read`. Change one SKU with `node "$HOME/.openmausbot/tools/selver-cart-bff.mjs" change SKU TARGET_QUANTITY`; zero removes an existing SKU. This client calls Selver's API directly, checks the backend account and full cart before and after a write, and refuses a mismatched result. Stop on any error. Never use browser clicks, page JavaScript, or another cart to repair it.

Before calling a cart complete, write an audit JSON file with the fixed plan requirements and a fresh cart snapshot, then run `node "$HOME/.openmausbot/tools/selver-bff.mjs" audit PATH`. The input contract is in `node "$HOME/.openmausbot/tools/selver-bff.mjs" schema`. Every required ingredient must be mapped to a purchased line or reported missing. The audit checks total price, quantity coverage, major excess, lactose-free labeling, and ingredient identity terms. Treat a failed audit as unfinished work: search more same-ingredient options, adjust cart quantities, and rerun. Do not turn an over-budget cart into a menu-change proposal unless the person explicitly asks for menu changes.

Before reporting a cart total or account, run the direct cart client's `read` command against the provisioned target session. If it fails, state that the real cart is unverified. Run the ingredient audit against those returned lines and report its failures. The local `verify-delivery` command rejects bot-authored cart files; they cannot establish account ownership.

If catalog searches establish that no suitable Selver pack meets a requirement or the budget, return the exact item, required amount, cheapest observed suitable pack and price, queries and candidate SKUs checked, and the smallest unresolved gap. Preserve the menu and current cart; do not say a lower-cost cart is impossible from a few search results. Do not order or pay without an explicit request.
