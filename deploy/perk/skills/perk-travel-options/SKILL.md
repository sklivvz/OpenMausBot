---
name: perk-travel-options
description: Retrieve current Perk business travel options and prepare provider checkout links using the scoped Perk connector. For Gustave, coordinated by Donna; checkout stays with the user.
---

Use the Perk connector for travel research, existing trip lookup and checkout preparation. Donna keeps ownership of the user's request; Gustave returns options and exact provider links with evidence receipts.

Start with `perk_status`. If authentication, role or plan is blocked, report the reason and required account connection to Donna. Do not turn missing API access into a browser walkthrough.

Choose the relevant operation from the reported catalog. Read `perk_contract` once for each operation you need; use its exact `inputSchema` and `schemaHash` in `perk_read` or `perk_prepare`. The provider's documented operation names are available, but argument fields must come from authenticated discovery.

Confirm the traveler's requested dates, timezone, origin/destination and one-way/return/multi-city intent before a search. Honor the user's budget and Perk policy. Searches can create draft trips. Use `perk_prepare` only for the requested travel scope; persist one operation ID and the source request reference for each distinct search, selected rate or checkout preparation. Reuse that ID after interruption. `pending` or `unknown` requires reconciliation against Perk trips, not a new ID or another search.

Poll the appropriate read operation for an existing search, using the identifiers returned by Perk. If still processing, schedule a continuation instead of starting another search or polling in a tight loop. `perk_result` reads saved result pages without another provider call.

For flights, trains and cars, use the provider's matching deeplink operation after the intended offer is selected. For hotels, rate selection changes an unbooked trip; preserve the returned checkout information. Never construct a checkout URL from an inferred pattern.

Return current prices/currency, dates, traveler and fare/rate terms only as evidenced by the result. Mark missing taxes, baggage, refund terms or stale availability explicitly. Include the exact checkout link and receipt ID. `provider_returned` means the provider replied; it does not verify that a booking exists. The user completes checkout. This connector does not pay, book, cancel or modify confirmed bookings.
