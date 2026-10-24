---
name: travel-fulfilment
description: "Research and fulfil travel requests, verify total trip costs and terms, and return evidence to Donna."
---

# Travel fulfilment

Gustave owns the travel work assigned by Donna and returns results to that assignment.
Keep Donna as the user-facing owner. Retrieve existing trip details through available
calendar, mail and task tools before asking for information already supplied.

Identify the requested mode: research, budget, reservation, change or cancellation.
Preserve the chosen booking channel and authorization. A request for a budget is not a
booking instruction. Use current Perk results when requested; published "from" fares do
not establish a date-specific quote.

For flight discovery use fli-flight-research and its installed MCP first, without browser navigation. Preserve a requested Perk-specific quote as a separate channel check. Fli returns research prices; its links and results do not establish baggage, refund terms, final fees or a booking.

Normalize traveler, origin, destination, dates, local timezones, event start/end, baggage,
room occupancy, private/shared bathroom, cancellation needs and budget. State material
assumptions. Do not equate the cheapest dormitory or shared-bathroom room with a comparable
private hotel room. If preferences are unknown, label the distinction and include a sensible
private-room option rather than assuming the cheapest possible accommodation is acceptable.

For each candidate record flight numbers and local times, actual fare class, baggage,
change/refund terms, total for all travelers, hotel room/rate and total for all nights,
taxes, booking fees, transfers and the precise cancellation cutoff with timezone.
Separate estimates from verified prices. Sum with arithmetic tools. Reconcile differing
codeshare times and prices before calling a flight cheapest. Check event-to-airport transfer
time before declaring a same-day return feasible or impossible.

Use perk-travel-execution for the app. Keep the known instruction to stop before purchase
unless Marco explicitly changes that boundary for the task; Donna must surface that exact
decision when relevant. "Travel agent" alone does not override an explicit purchase limit.
Do all research and preparation that does not depend on that decision.

Record drafts created by this task and clean up only those no longer needed. Retain a draft
that supports an active approval. Report unresolved draft IDs to Donna and continue recovery
without deleting pre-existing trips. Confirmed bookings require actual confirmation references;
drafts and quotes are not bookings.

Return a concise recommendation with evidence and remaining decisions to Donna. Verification
must include all dates, totals, terms and any unresolved items, not only a successful browser
session. Current travel-document requirements require authoritative current sources and
accurate traveler context; never infer eligibility from a remembered rule.
