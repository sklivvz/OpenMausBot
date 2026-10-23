export const ENDPOINT = 'https://mcp.perk.com/api/mcp/mcp';

// Perk's public tool reference documents draft creation by searches and rate selection.
// https://developers.perk.com/docs/perk-mcp-tools-reference
export const OPERATIONS = Object.freeze({
  identity_get_current_user: 'read',
  policies_get_travel_policy: 'read',
  trips_get_trip: 'read',
  trips_list_trips: 'read',
  trips_get_trip_itinerary_pdf: 'read',
  flights_search_flight_places: 'read',
  flights_start_flight_search: 'prepare',
  flights_get_flight_leg_options: 'read',
  flights_build_flight_deeplink: 'prepare',
  hotels_start_hotel_search: 'prepare',
  hotels_get_hotels: 'read',
  hotels_start_hotel_rates: 'prepare',
  hotels_get_hotel_rates: 'read',
  hotels_select_hotel_rate: 'prepare',
  trains_search_train_places: 'read',
  trains_start_train_search: 'prepare',
  trains_get_train_search_results: 'read',
  trains_start_train_search_inbound: 'prepare',
  trains_get_train_search_inbound_results: 'read',
  trains_build_train_deeplink: 'prepare',
  cars_search_car_places: 'read',
  cars_list_car_delivery_addresses: 'read',
  cars_start_car_search: 'prepare',
  cars_get_car_search_results: 'read',
  cars_build_car_deeplink: 'prepare',
});

const string = { type: 'string', minLength: 1, maxLength: 2048 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const operations = (effect) => Object.entries(OPERATIONS).filter(([, value]) => !effect || value === effect).map(([name]) => name);
const execution = (effect) => ({
  operation: { enum: operations(effect) },
  schemaHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  arguments: { type: 'object' },
});

export const TOOLS = [
  { name: 'perk_status', description: 'Check Perk authentication and available travel capabilities. Does not start searches.', inputSchema: object({}) },
  { name: 'perk_contract', description: 'Get the authenticated, exact vendor argument schema and its hash for one allowed travel operation. No guessed parameters.', inputSchema: object({ operation: { enum: operations() } }) },
  { name: 'perk_read', description: 'Execute one contract-validated travel lookup or poll. No automatic retries. Saves private evidence; returns a bounded result page.', inputSchema: object(execution('read')) },
  { name: 'perk_prepare', description: 'Prepare travel options or checkout; searches may create draft trips, hotel rate selection changes an unbooked trip. Never purchases. Reuse operationId for the same action; never retry unknown outcomes with a new ID.', inputSchema: object({ ...execution('prepare'), operationId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' }, sourceRef: string }) },
  { name: 'perk_result', description: 'Read a saved evidence page without another Perk call. Pending or unknown write outcomes require reconciliation, not resubmission.', inputSchema: object({ receiptId: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' }, offset: { type: 'integer', minimum: 0 } }, ['receiptId']) },
];
