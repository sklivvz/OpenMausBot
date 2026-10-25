import { z } from "zod";

const text = z.string().max(4000);
const ref = z.string().min(1).max(200);
const minor = z.number().int().safe();
const quantity = z.number().int().min(0).max(100);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const BOLT_ACTIONS = ["inspect", "read_session", "list_saved_addresses", "select_saved_address", "open_branch", "search_branch", "open_product", "read_item_options", "set_item_options", "set_product_quantity", "read_item_comment", "set_item_comment", "add_configured_product", "close_product", "open_basket", "read_basket", "set_basket_quantity", "list_fulfilment_options", "select_fulfilment", "list_delivery_options", "select_delivery_option", "read_checkout", "request_payment_approval", "pay", "read_order", "reconcile_operation"] as const;
export const BOLT_INPUT = z.object({
  action: z.enum(BOLT_ACTIONS),
  observationRef: hash.optional(),
  operationId: id.optional(),
  targetRef: ref.optional(),
  branchUrl: z.string().url().max(2048).optional(),
  query: z.string().max(200).optional(),
  quantity: quantity.optional(),
  expectedQuantity: quantity.optional(),
  text: text.optional(),
  selections: z.array(z.object({ groupRef: ref, choices: z.array(z.object({ choiceRef: ref, quantity })).max(50) }).strict()).max(30).optional(),
  approvedCheckoutRef: id.optional(),
  tab: z.string().regex(/^t[1-9]\d{0,8}$/).optional(),
});
export type BoltInput = z.infer<typeof BOLT_INPUT>;
const option = z.object({ ref, id: text, label: text, available: z.boolean(), selected: z.boolean(), priceMinor: minor.optional(), quantity: quantity.optional(), maxQuantity: quantity.optional(), control: ref, plus: ref.optional(), minus: ref.optional() });
const group = z.object({ ref, id: text, label: text, min: quantity.nullable(), max: quantity.nullable(), mode: z.enum(["single", "multiple", "quantity"]), choices: z.array(option).max(50) });
const comment = z.object({ supported: z.boolean(), text, maxLength: z.number().int().nonnegative().nullable(), input: ref.optional(), save: ref.optional() });
const configured = { id: text.min(1), name: text.min(1), quantity: quantity, unitPriceMinor: minor, options: z.array(z.object({ groupId: text, groupLabel: text.min(1), choiceId: text, choiceLabel: text.min(1), quantity })).max(100), comment: text };
export const LINE = z.object({ ref, ...configured, /** Extended line total when the page exposes only that amount. */ lineTotalMinor: minor.optional(), priceBasis: z.literal("line_total").optional(), edit: ref.optional(), plus: ref.optional(), minus: ref.optional() });
export type BoltLine = z.infer<typeof LINE>;
const delivery = z.object({ ref, id: text.min(1), label: text.min(1), feeMinor: minor.nullable(), eta: text.min(1).nullable(), available: z.boolean(), selected: z.boolean(), control: ref });
const checkout = z.object({
  /** Host browser approval scope; never an unproven provider account id. */
  account: text.min(1), accountScope: z.literal("host_browser_profile").optional(), providerAccountId: text.optional(),
  branchId: text.min(1), currency: z.literal("EUR"), destination: text.min(1), fulfilment: text.min(1), deliveryOptionId: text.min(1), deliveryLabel: text.min(1), deliveryEta: text.min(1), paymentMethod: text.min(1), courierComment: text,
  lines: z.array(LINE).min(1).max(100), subtotalMinor: minor.nonnegative(), adjustments: z.array(z.object({ label: text.min(1), amountMinor: minor })).max(30), totalMinor: minor.nonnegative(),
});
export type BoltCheckout = z.infer<typeof checkout>;
export const VIEW = z.object({
  session: z.object({ signedIn: z.boolean(), account: text.optional() }).optional(),
  branchId: text.optional(), address: text.optional(), search: text.optional(), searchResultQuery: text.optional(), searchPending: z.boolean().optional(),
  addresses: z.array(z.object({ ref, label: text, destination: text, selected: z.boolean(), control: ref })).max(50).optional(),
  products: z.array(z.object({
    ref, id: text.optional(), name: text, details: text.optional(), priceMinor: minor.optional(),
    saleDescription: text.optional(), saleQuantity: text.optional(), saleUnit: text.optional(),
    displayedPriceBasis: z.literal("per_pack").optional(), unitPriceMinor: minor.optional(), unitPriceBasis: text.optional(),
    open: ref,
  })).max(100).optional(),
  item: z.object({ ref, id: text.min(1), name: text, mode: z.enum(["new", "edit"]), quantity, unitPriceMinor: minor, groups: z.array(group).max(30), comment, plus: ref.optional(), minus: ref.optional(), add: ref.optional(), close: ref.optional() }).optional(),
  basket: z.array(LINE).max(100).optional(),
  basketState: z.object({ loading: z.boolean(), ready: z.boolean(), rowsAvailable: z.boolean(), detail: text.optional(), control: ref.optional() }).optional(),
  fulfilmentOptions: z.array(z.object({ ref, id: text, label: text, available: z.boolean(), selected: z.boolean(), control: ref })).max(10).optional(),
  deliveryOptions: z.array(delivery).min(1).max(20).optional(),
  checkout: checkout.optional(),
  order: z.object({ id: text.min(1), state: text.min(1), totalMinor: minor, account: text.optional(), branchId: text.optional(), destination: text.optional(), lines: z.array(LINE).max(100).optional() }).optional(),
  authenticationRequired: z.boolean().optional(),
  overlay: z.enum(["none", "product", "basket", "address", "replacement", "unknown"]).optional(),
  controls: z.record(z.string(), ref).optional(),
});
export type BoltView = z.infer<typeof VIEW>;
export type DomNode = { selector?: string; kind: "text" | "number" | "money" | "boolean" | "enabled" | "exists" | "control" | "object" | "list"; attribute?: string; pattern?: string; group?: number; first?: boolean; fields?: Record<string, DomNode>; item?: DomNode; optional?: boolean };
const node: z.ZodType<DomNode> = z.lazy(() => z.object({ selector: z.string().min(1).max(2000).optional(), kind: z.enum(["text", "number", "money", "boolean", "enabled", "exists", "control", "object", "list"]), attribute: z.string().max(100).optional(), pattern: z.string().min(1).max(500).optional(), group: z.number().int().min(0).max(9).optional(), first: z.boolean().optional(), fields: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/), node).optional(), item: node.optional(), optional: z.boolean().optional() }).strict());
/** Host-reviewed DOM mappings; these are never accepted as bot tool arguments. */
export const BINDINGS = z.object({ version: z.literal(1), evidence: z.string().min(1).max(2000), root: node }).strict();
export type BoltBindings = z.infer<typeof BINDINGS>;
export class BoltFault extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function requireBolt(value: unknown, code: string): asserts value { if (!value) throw new BoltFault(code); }
