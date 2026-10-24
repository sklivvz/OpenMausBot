---
name: fli-flight-research
description: Research one-way and return flights, nearby airports and flexible dates through the installed fli-research MCP. Gustave uses this before browser flight searches; booking remains a separate operation.
license: MIT
---

# Flight research for Gustave

Use the installed `fli-research` tools for flight discovery. No browser, account
login, installation command or API key is needed. Donna retains ownership of
requests she delegates; return a useful shortlist and any actual decision to
her in the existing assignment. A direct request from Marco keeps its own scope.

1. Recover origin/destination, dates or flexibility, travelers and ages, cabin,
   stops, budget and arrival constraints from the request and existing profile.
   Ask only for missing information that changes the search. Use `find_airports`
   to resolve uncertain airport codes; do not silently substitute another city.
2. Call `search_flights` with a `query` object. Use `origin`, `destination`,
   `departure_date` as YYYY-MM-DD and `return_date` only for a return trip.
   Pass actual passengers/children/infants and cabin. Default currency is EUR;
   supply another explicit currency when requested. `max_stops` accepts ANY,
   NON_STOP, ONE_STOP or TWO_PLUS_STOPS. Airline inclusion/exclusion, departure
   windows and layover limits must follow the request, not invented preferences.
3. For flexible dates, call `search_dates` with `query.origin`, `destination`,
   `start_date`, `end_date`, and `is_round_trip` plus `trip_duration` when needed.
   Each call accepts at most seven dates because every date costs a page fetch.
   Start with the relevant window; do not tile months into calls automatically.
   Recheck the promising date with `search_flights` for the actual itinerary.
4. Round-trip search expands three outbound candidates by default. `top_n` can
   be 1–5; change it only to address a demonstrated coverage gap. Six results are
   returned per call. This is a shortlist, not proof of exhaustive market coverage.
5. Return concrete options with airports, local dates/times, duration, stops,
   airline, reported price/currency, traveler basis, observedAt and the returned
   per-itinerary `booking_url`. Preserve date changes and overnight connections.
   A Google Flights link opens the itinerary; it is not a booked fare or payment
   authorization. Do not manufacture a seller link or assume seat availability.

The current Fli transport reads Google Flights public search pages through HTTP;
it does not drive the user's browser. Baggage costs, refundable terms, basic-
economy exclusion and emissions are not established by it. Unsupported filters
are rejected. Keep these as explicit missing fare checks for the airline or the
existing authorized booking route; never call the fare fully inclusive without
that evidence. `XXX` currency is unknown, not EUR. Prices can change before booking.

Multi-city is not supported as a single ticket search. Separate leg research is
possible when useful, but label it as separate legs rather than a protected
through-ticket. Child/infant searches can return sparse or empty results; that
is not proof the route has no flights. An adults-only follow-up can show a
schedule but must never be presented as the family's fare.

No `get_booking_options` tool is exposed: its upstream transport is currently
unavailable. Do not call it, scrape around it or repeatedly retry. A failed search
is not “no flights.” Use the returned error and retryable status. The client
already retries transient requests; do not loop. Preserve any useful results,
return the exact limitation to Donna, and use an available authorized alternative
only if needed for the actual task. Research does not authorize booking or spending.
