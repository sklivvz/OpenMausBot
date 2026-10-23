---
name: selver-cart-preview
description: Compute a deterministic Selver cart change preview from fixed shopping requirements, selected SKUs and an existing fresh cart snapshot, without contacting Selver.
---

Once requirements and product choices are fixed, use the deployed local preview:

```sh
node /data/.openmausbot/providers/service-connectors/current/deploy/selver/preview.mjs /absolute/spec.json /absolute/baseline.json
```

Read `/data/.openmausbot/providers/service-connectors/current/deploy/selver/README.md`
for the input schema. Inputs must be private regular JSON files. Use the existing
authenticated cart snapshot; it must be no more than two minutes old. Do not
invent a cart ID or a new observation timestamp to make stale data pass.

The preview computes coverage, selected absolute quantities, explicit removals,
preserved unrelated items and the exact specification hash. It makes no network
request. Hashes identify supplied evidence; they do not verify that a chosen
product satisfies the original request or authorize an update or purchase.

Read the result as a proposed delta, not a changed cart. Report missing product
evidence, stale baseline or mismatched requirements through Donna. This deployment
enables preview only; automatic cart updates and checkout are not enabled by it.
