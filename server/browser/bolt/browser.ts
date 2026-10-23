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

export function loadBindings(path: string): BoltBindings {
  if (!existsSync(path)) return RECORDED_BINDINGS;
  requireBolt(statSync(path).size <= 128_000, "bindings_too_large");
  return BINDINGS.parse(JSON.parse(readFileSync(path, "utf8")));
}

export class BoltBrowserPort implements BoltPort {
  readonly page: CdpPage;
  readonly bindings: BoltBindings;
  readonly guard: () => void;
  readonly origin: string;
  readonly timeoutMs: () => number;
  #latest?: z.infer<typeof snapshot>;
  #effectsDispatched = 0;

  get effectsDispatched(): number { return this.#effectsDispatched; }

  constructor(page: CdpPage, bindings: BoltBindings, guard: () => void, timeoutMs: () => number, origin = "https://food.bolt.eu") {
    this.page = page;
    this.bindings = bindings;
    this.guard = guard;
    this.origin = origin;
    this.timeoutMs = timeoutMs;
  }

  async read(): Promise<BoltObservation> {
    this.guard();
    this.checkOrigin(this.page.url());
    const raw = await this.page.evaluate(inspectionScript(this.bindings), { world: "isolated", timeoutMs: this.timeoutMs() });
    requireBolt(JSON.stringify(raw).length <= 128_000, "observation_too_large");
    if (raw && typeof raw === "object" && "error" in raw) throw new BoltFault(`dom_binding_error:${String(raw.error).slice(0, 100)}`);
    const parsed = snapshot.safeParse(raw);
    requireBolt(parsed.success, "dom_binding_incomplete");
    this.checkOrigin(parsed.data.url);
    this.#latest = parsed.data;
    return { url: parsed.data.url, observationRef: digest(parsed.data), view: parsed.data.view };
  }

  private checkOrigin(url: string) {
    const parsed = new URL(url);
    requireBolt(parsed.origin === this.origin && !parsed.username && !parsed.password, "bolt_origin_required");
  }

  supports(action: BoltInput["action"]): boolean {
    const fields: Partial<Record<BoltInput["action"], string[]>> = {
      open_branch: ["branchId", "basket"], search_branch: ["branchId", "search", "products", "searchResultQuery", "searchPending"],
      open_product: ["products", "item"], close_product: ["item", "overlay"], open_basket: ["basket", "overlay"],
      select_saved_address: ["addresses", "address"], set_item_options: ["item"], set_item_comment: ["item"], set_product_quantity: ["item"],
      add_configured_product: ["item", "basket"], set_basket_quantity: ["basket"], select_fulfilment: ["fulfilmentOptions"], select_delivery_option: ["deliveryOptions"],
      request_payment_approval: ["session", "checkout"], pay: ["session", "checkout", "order"],
    };
    return (fields[action] ?? []).every((field) => Object.hasOwn(this.bindings.root.fields ?? {}, field));
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
    await this.page.click({ selector }, { timeoutMs: this.timeoutMs() });
  }

  async fill(ref: string, value: string): Promise<void> {
    const selector = await this.target(ref);
    this.guard();
    this.#effectsDispatched++;
    await this.page.fill({ selector }, value);
    await this.read();
  }

  async navigate(url: string): Promise<void> {
    this.checkOrigin(url);
    this.guard();
    this.#effectsDispatched++;
    await this.page.navigate(url, { readiness: "load", timeoutMs: this.timeoutMs() });
    this.checkOrigin(this.page.url());
  }
}
