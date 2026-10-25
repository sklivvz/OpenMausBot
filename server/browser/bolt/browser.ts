import { existsSync, readFileSync, statSync } from "node:fs";
import { z } from "zod";
import type { CdpPage } from "../cdp/page.ts";
import { BINDINGS, BoltFault, VIEW, requireBolt, type BoltBindings, type BoltInput } from "./contracts.ts";
import { inspectionScript, RECORDED_BINDINGS } from "./dom.ts";
import { digest } from "./state.ts";
import type { BoltObservation, BoltPort } from "./runner.ts";

const snapshot = z.object({
  url: z.string().url(),
  view: VIEW,
  targets: z.record(z.string(), z.object({ selector: z.string().min(1).max(8000), enabled: z.boolean(), signature: z.string().max(4000) })),
});

export interface BoltDomTransport {
  url(): string | Promise<string>;
  evaluate(script: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  navigate(url: string): Promise<void>;
}

function productFacts(name: string) {
  const sale = /(?:^|,\s*)((?:\d+\s*x\s*)?\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|pcs|pc|tk))\s*(?:,|$)/i.exec(name);
  const unitPrice = /(\d+(?:[.,]\d+)?)\s*€\s*\/\s*(kg|g|l|ml|pcs|pc|tk)\b/i.exec(name);
  const packPrice = /(?:^|,\s*)(\d+(?:[.,]\d+)?)\s*€(?![^,]*\/)/.exec(name);
  const saleUnit = sale ? /(kg|g|ml|l|pcs|pc|tk)$/i.exec(sale[1])?.[1].toLowerCase() : undefined;
  return {
    ...(sale ? { saleDescription: sale[1], saleQuantity: sale[1], saleUnit } : {}),
    ...(packPrice ? { priceMinor: Math.round(Number(packPrice[1].replace(",", ".")) * 100) } : {}),
    ...(unitPrice ? { unitPriceMinor: Math.round(Number(unitPrice[1].replace(",", ".")) * 100), unitPriceBasis: `per_${unitPrice[2].toLowerCase()}` } : {}),
  };
}

function normalizeProducts(view: z.infer<typeof VIEW>): z.infer<typeof VIEW> {
  if (!view.products) return view;
  return {
    ...view,
    products: view.products.map(product => ({
      ...product,
      ...(product.priceMinor !== undefined ? { displayedPriceBasis: "per_pack" as const } : {}),
      ...productFacts(product.name),
    })),
  };
}

function normalizeSnapshot(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !("view" in raw)) return raw;
  const view = (raw as { view?: unknown }).view;
  if (!view || typeof view !== "object") return raw;
  const next: Record<string, unknown> = normalizeProducts(view as z.infer<typeof VIEW>);
  const delivery = next.deliveryOptions;
  if (Array.isArray(delivery)) next.deliveryOptions = delivery.map(choice => choice && typeof choice === "object"
    ? { ...choice, feeMinor: (choice as { feeMinor?: unknown }).feeMinor ?? null, eta: (choice as { eta?: unknown }).eta ?? null }
    : choice);
  const basketState = next.basketState;
  if (basketState && typeof basketState === "object") {
    const state = basketState as { loading?: unknown; ready?: unknown };
    next.basketState = { ...basketState, ready: state.ready === true && state.loading !== true, rowsAvailable: false };
  }
  return { ...raw, view: next };
}

/** The branch and query are route facts, not DOM guesses: both observed route shapes are recorded. */
export function withUrlFacts(view: z.infer<typeof VIEW>, pageUrl: string): z.infer<typeof VIEW> {
  const url = new URL(pageUrl);
  const branch = /\/p\/(\d+)(?:-|\/|$)/.exec(url.pathname)?.[1] ?? /\/checkout\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
  const query = url.searchParams.get("query");
  return {
    ...view,
    ...(view.branchId === undefined && branch ? { branchId: branch } : {}),
    ...(view.searchResultQuery === undefined && query ? { searchResultQuery: query } : {}),
  };
}

export function loadBindings(path: string): BoltBindings {
  if (!existsSync(path)) return RECORDED_BINDINGS;
  requireBolt(statSync(path).size <= 128_000, "bindings_too_large");
  try {
    return BINDINGS.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof BoltFault) throw error;
    throw new BoltFault("bindings_invalid");
  }
}

const supportedFields: Record<BoltInput["action"], string[]> = {
  inspect: [],
  read_session: ["session"],
  list_saved_addresses: ["addresses"],
  select_saved_address: ["addresses", "address"],
  open_branch: [],
  search_branch: ["search", "products"],
  open_product: ["products", "item"],
  close_product: ["item", "overlay", "controls"],
  read_item_options: ["item"],
  set_item_options: ["item"],
  set_product_quantity: ["item"],
  read_item_comment: ["item"],
  set_item_comment: ["item"],
  add_configured_product: ["item", "basket"],
  open_basket: ["basket", "overlay"],
  read_basket: ["basket"],
  set_basket_quantity: ["basket"],
  list_fulfilment_options: ["fulfilmentOptions"],
  select_fulfilment: ["fulfilmentOptions"],
  list_delivery_options: ["deliveryOptions"],
  select_delivery_option: ["deliveryOptions"],
  read_checkout: ["session", "checkout"],
  request_payment_approval: ["session", "checkout"],
  pay: ["session", "checkout", "order", "controls"],
  read_order: ["order"],
  reconcile_operation: [],
};

export class BoltDomPort implements BoltPort {
  readonly bindings: BoltBindings;
  readonly guard: () => void;
  readonly transport: BoltDomTransport;
  readonly origin: string;
  #latest?: z.infer<typeof snapshot>;
  #effectsDispatched = 0;

  get effectsDispatched(): number { return this.#effectsDispatched; }

  constructor(transport: BoltDomTransport, bindings: BoltBindings, guard: () => void, origin = "https://food.bolt.eu") {
    this.transport = transport;
    this.bindings = bindings;
    this.guard = guard;
    this.origin = origin;
  }

  async read(): Promise<BoltObservation> {
    this.guard();
    this.checkOrigin(await this.transport.url());
    const raw = await this.transport.evaluate(inspectionScript(this.bindings));
    requireBolt(JSON.stringify(raw).length <= 128_000, "observation_too_large");
    if (raw && typeof raw === "object" && "error" in raw) throw new BoltFault(`dom_binding_error:${String(raw.error).slice(0, 100)}`);
    const normalized = normalizeSnapshot(raw);
    const parsed = snapshot.safeParse(normalized);
    requireBolt(parsed.success, "dom_binding_incomplete");
    this.checkOrigin(parsed.data.url);
    const view = withUrlFacts(parsed.data.view, parsed.data.url);
    this.#latest = parsed.data;
    return { url: parsed.data.url, observationRef: digest({ ...parsed.data, view }), view };
  }

  private checkOrigin(url: string) {
    const parsed = new URL(url);
    requireBolt(parsed.origin === this.origin && !parsed.username && !parsed.password, "bolt_origin_required");
  }

  supports(action: BoltInput["action"]): boolean {
    if (action === "read_basket") return Object.hasOwn(this.bindings.root.fields ?? {}, "basket") || Object.hasOwn(this.bindings.root.fields ?? {}, "basketState");
    if (action === "open_branch") return Object.hasOwn(this.bindings.root.fields ?? {}, "basketState") || Object.hasOwn(this.bindings.root.fields ?? {}, "basket");
    return supportedFields[action].every((field) => Object.hasOwn(this.bindings.root.fields ?? {}, field));
  }

  private async target(ref: string): Promise<string> {
    const previous = this.#latest;
    requireBolt(previous, "observation_required");
    const expected = digest(previous);
    await this.read();
    requireBolt(digest(this.#latest) === expected, "page_changed_before_action");
    requireBolt(Object.hasOwn(previous.targets, ref), "unknown_control_ref");
    const target = previous.targets[ref];
    requireBolt(target.enabled, "control_disabled");
    this.guard();
    return target.selector;
  }

  async click(ref: string): Promise<void> {
    const selector = await this.target(ref);
    this.guard();
    this.#effectsDispatched++;
    await this.transport.click(selector);
  }

  async fill(ref: string, value: string): Promise<void> {
    const selector = await this.target(ref);
    this.guard();
    this.#effectsDispatched++;
    await this.transport.fill(selector, value);
    await this.read();
  }

  async navigate(url: string): Promise<void> {
    this.checkOrigin(url);
    this.guard();
    this.#effectsDispatched++;
    await this.transport.navigate(url);
    this.checkOrigin(await this.transport.url());
  }
}

class CdpTransport implements BoltDomTransport {
  readonly page: CdpPage;
  readonly timeoutMs: () => number;
  constructor(page: CdpPage, timeoutMs: () => number) {
    this.page = page;
    this.timeoutMs = timeoutMs;
  }
  url(): string { return this.page.url(); }
  evaluate(script: string): Promise<unknown> { return this.page.evaluate(script, { world: "isolated", timeoutMs: this.timeoutMs() }); }
  async click(selector: string): Promise<void> { await this.page.click({ selector }, { timeoutMs: this.timeoutMs() }); }
  async fill(selector: string, value: string): Promise<void> { await this.page.fill({ selector }, value); }
  async navigate(url: string): Promise<void> { await this.page.navigate(url, { readiness: "load", timeoutMs: this.timeoutMs() }); }
}

export class BoltBrowserPort extends BoltDomPort {
  readonly page: CdpPage;
  constructor(page: CdpPage, bindings: BoltBindings, guard: () => void, timeoutMs: () => number, origin = "https://food.bolt.eu") {
    super(new CdpTransport(page, timeoutMs), bindings, guard, origin);
    this.page = page;
  }
}
