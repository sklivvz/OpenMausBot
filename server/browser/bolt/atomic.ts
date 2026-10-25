import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BoltDomTransport } from "./browser.ts";
import { BoltFault, requireBolt, type BoltCheckout, type BoltInput, type BoltLine, type BoltView } from "./contracts.ts";
import {
  BoltBasketOperations,
  type BoltAddControl,
  type BoltBasketLine,
  type BoltBasketSnapshot,
} from "./basket-operations.ts";
import {
  readCheckoutQuote,
  type CheckoutHostFacts,
  type CheckoutQuote,
} from "./checkout-operations.ts";
import { digest } from "./state.ts";
import {
  readProductObservation,
  runProductAction,
  type ProductActionResult,
  type ProductDetailObservation,
  type ProductPageObservation,
} from "./product-operations.ts";

const PRODUCT_ACTIONS = new Set<BoltInput["action"]>([
  "search_branch", "open_product", "read_item_options", "set_item_options",
  "set_product_quantity", "read_item_comment", "set_item_comment", "close_product",
]);
const BASKET_ACTIONS = new Set<BoltInput["action"]>(["open_basket", "read_basket", "set_basket_quantity"]);
const CHECKOUT_ACTIONS = new Set<BoltInput["action"]>(["read_checkout", "request_payment_approval", "pay"]);
const ATOMIC_MUTATIONS = new Set<BoltInput["action"]>([
  "search_branch", "open_product", "set_item_options", "set_product_quantity", "set_item_comment",
  "close_product", "add_configured_product", "open_basket", "set_basket_quantity", "pay",
]);

export interface BoltAtomicHost {
  profileKey?: string;
  providerAccountId?: string;
}

export interface BoltAtomicOptions {
  transport: BoltDomTransport;
  guard: () => void;
  directory: string;
  origin?: string;
  host?: BoltAtomicHost;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
}

/** A verified basket row set, stored only by the host adapter and keyed to this browser profile. */
interface StoredBaseline {
  version: 1;
  profileKey: string;
  branchId: string;
  savedAt: number;
  totalMinor: number | null;
  emptyBasket: boolean;
  observationRef: string;
  rows: Array<{
    ref: string;
    name: string;
    quantity: number;
    priceText: string;
    priceMinor: number | null;
    selectedOptions: string | null;
    comment: string | null;
  }>;
}

const BASELINE_MAX_AGE_MS = 30 * 60_000;

function sameName(left: string, right: string): boolean {
  return left.replace(/\s+/g, " ").trim().toLocaleLowerCase() === right.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function basketLine(row: BoltBasketLine): BoltLine | undefined {
  if (row.quantity <= 0 || row.priceMinor === null || row.priceMinor % row.quantity !== 0) return undefined;
  return {
    ref: row.ref,
    id: row.ref,
    name: row.name,
    quantity: row.quantity,
    unitPriceMinor: row.priceMinor / row.quantity,
    lineTotalMinor: row.priceMinor,
    priceBasis: "line_total",
    options: row.selectedOptions
      ? row.selectedOptions.split(/,\s*/).filter(Boolean).map((label) => ({
        groupId: "observed-selected-options",
        groupLabel: "Selected options",
        choiceId: label,
        choiceLabel: label,
        quantity: 1,
      }))
      : [],
    comment: row.comment ?? "",
  };
}

function productItem(detail: ProductDetailObservation): BoltView["item"] | undefined {
  if (detail.priceMinor === undefined || detail.quantity === null) return undefined;
  const groups = detail.groups.flatMap((group) => {
    if (group.mode === "unknown") return [];
    const choices = group.choices.map((choice) => ({
      ref: choice.ref,
      id: choice.id,
      label: choice.label,
      available: choice.available,
      selected: choice.selected === true,
      ...(choice.maxQuantity !== null ? { maxQuantity: choice.maxQuantity } : {}),
      control: choice.control.ref,
      ...(choice.plus ? { plus: choice.plus.ref } : {}),
      ...(choice.minus ? { minus: choice.minus.ref } : {}),
    }));
    return [{
      ref: group.ref,
      id: group.id,
      label: group.label,
      min: group.min,
      max: group.max,
      mode: group.mode as "single" | "multiple" | "quantity",
      choices,
    }];
  });
  return {
    ref: detail.ref,
    id: detail.ref,
    name: detail.name,
    mode: detail.controls.add ? "new" : "edit",
    quantity: detail.quantity,
    unitPriceMinor: detail.priceMinor,
    groups,
    comment: {
      supported: detail.comment.supported,
      text: detail.comment.text,
      maxLength: detail.comment.maxLength,
      ...(detail.comment.input ? { input: detail.comment.input.ref } : {}),
    },
    ...(detail.controls.add ? { add: detail.controls.add.ref } : {}),
    ...(detail.controls.close ? { close: detail.controls.close.ref } : {}),
  };
}

function basketView(snapshot: BoltBasketSnapshot): Partial<BoltView> {
  const lines = snapshot.rows.map(basketLine).filter((line): line is BoltLine => line !== undefined);
  return {
    ...(snapshot.branchId ? { branchId: snapshot.branchId } : {}),
    basketState: {
      loading: false,
      ready: snapshot.open,
      rowsAvailable: snapshot.open && snapshot.complete,
      ...(snapshot.basketTotalText ? { detail: snapshot.basketTotalText } : {}),
    },
    ...(snapshot.open && snapshot.complete ? { basket: lines } : {}),
  };
}

export class BoltAtomicOperations {
  readonly transport: BoltDomTransport;
  readonly basket: BoltBasketOperations;
  readonly origin: string;
  readonly directory: string;
  readonly host: BoltAtomicHost;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly #guard: () => void;
  readonly #now: () => number;
  #effects = 0;

  get effectsDispatched(): number { return this.#effects; }

  constructor(options: BoltAtomicOptions) {
    this.#guard = options.guard;
    this.#now = options.now ?? Date.now;
    this.origin = options.origin ?? "https://food.bolt.eu";
    this.directory = options.directory;
    this.host = options.host ?? {};
    this.timeoutMs = options.timeoutMs ?? 4_000;
    this.pollMs = options.pollMs ?? 150;
    const counted: BoltDomTransport = {
      url: () => options.transport.url(),
      evaluate: async (script) => {
        this.#guard();
        return options.transport.evaluate(script);
      },
      click: async (selector) => {
        this.#guard();
        this.#effects++;
        await options.transport.click(selector);
      },
      fill: async (selector, value) => {
        this.#guard();
        this.#effects++;
        await options.transport.fill(selector, value);
      },
      navigate: async (url) => {
        this.#guard();
        this.#effects++;
        await options.transport.navigate(url);
      },
    };
    this.transport = counted;
    this.basket = new BoltBasketOperations(counted, {
      origin: this.origin,
      timeoutMs: options.timeoutMs ?? 8_000,
      pollMs: options.pollMs ?? 200,
    });
  }

  handles(action: BoltInput["action"]): boolean {
    return PRODUCT_ACTIONS.has(action) || BASKET_ACTIONS.has(action) || CHECKOUT_ACTIONS.has(action) || action === "add_configured_product";
  }

  isMutation(action: BoltInput["action"]): boolean {
    return ATOMIC_MUTATIONS.has(action);
  }

  private productOptions() {
    return { origin: this.origin, guard: this.#guard, timeoutMs: this.timeoutMs, pollMs: this.pollMs };
  }

  private async productPage(): Promise<ProductPageObservation> {
    return readProductObservation(this.transport, this.productOptions());
  }

  private checkoutHost(): CheckoutHostFacts | undefined {
    const profileKey = this.host.profileKey?.trim();
    if (!profileKey) return undefined;
    return {
      scope: "host_browser_profile",
      profileKey,
      ...(this.host.providerAccountId ? { providerAccountId: this.host.providerAccountId } : {}),
    };
  }

  async checkoutQuote(): Promise<CheckoutQuote> {
    return readCheckoutQuote(this.transport, { origin: this.origin, guard: this.#guard, host: this.checkoutHost() });
  }

  private baselinePath(): string {
    return join(this.directory, "basket-baseline.json");
  }

  private saveBaseline(snapshot: BoltBasketSnapshot): void {
    const profileKey = this.host.profileKey?.trim();
    const branchId = snapshot.branchId;
    if (!profileKey || !branchId || !snapshot.complete || !snapshot.open) return;
    if (snapshot.rows.length === 0 && !snapshot.emptyBasket) return;
    const stored: StoredBaseline = {
      version: 1,
      profileKey,
      branchId,
      savedAt: this.#now(),
      totalMinor: snapshot.basketTotalMinor,
      emptyBasket: snapshot.emptyBasket,
      observationRef: snapshot.observationRef,
      rows: snapshot.rows.map((row) => ({
        ref: row.ref,
        name: row.name,
        quantity: row.quantity,
        priceText: row.priceText,
        priceMinor: row.priceMinor,
        selectedOptions: row.selectedOptions,
        comment: row.comment,
      })),
    };
    mkdirSync(dirname(this.baselinePath()), { recursive: true, mode: 0o700 });
    const temporary = `${this.baselinePath()}.${process.pid}.tmp`;
    const fd = openSync(temporary, "w", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(stored));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.baselinePath());
  }

  private loadBaseline(branchId: string | undefined): BoltBasketSnapshot | undefined {
    if (!branchId || !this.host.profileKey?.trim() || !existsSync(this.baselinePath())) return undefined;
    let stored: StoredBaseline;
    try {
      stored = JSON.parse(readFileSync(this.baselinePath(), "utf8")) as StoredBaseline;
    } catch {
      return undefined;
    }
    if (stored.version !== 1 || stored.profileKey !== this.host.profileKey || stored.branchId !== branchId) return undefined;
    if (this.#now() - stored.savedAt > BASELINE_MAX_AGE_MS) return undefined;
    if (stored.emptyBasket && this.#now() - stored.savedAt > 120_000) return undefined;
    const rows: BoltBasketLine[] = stored.rows.map((row) => ({
      ref: row.ref,
      name: row.name,
      providerItemId: null,
      observedTestIds: [],
      quantity: row.quantity,
      priceText: row.priceText,
      priceMinor: row.priceMinor,
      priceBasis: "line_total",
      priceProvenance: "total_price_or_original_price",
      unitPriceMinor: null,
      selectedOptions: row.selectedOptions,
      comment: row.comment,
      label: "",
      ambiguous: false,
      containerSelector: "",
      counterTestId: "components.CheckoutItem.checkoutItemCounter",
      controls: {
        minus: { selector: "", enabled: false, text: "" },
        plus: null,
        quantity: { selector: "", enabled: false, text: String(row.quantity) },
      },
      warnings: [],
    }));
    return {
      url: "",
      open: true,
      checkoutId: null,
      branchId: stored.branchId,
      basketTotalText: null,
      basketTotalMinor: stored.totalMinor,
      basketTotalSource: stored.totalMinor === null ? "empty_basket" : "basket_button",
      emptyBasket: stored.emptyBasket,
      complete: true,
      errors: [],
      observedCounters: rows.length,
      skippedRows: 0,
      zeroQuantityRows: 0,
      basketEntry: null,
      rows,
      replacementPrompt: false,
      unknowns: ["trusted_basket_baseline"],
      observationRef: stored.observationRef,
    };
  }

  async observe(input: BoltInput): Promise<{ url: string; observationRef: string; view: Partial<BoltView> }> {
    const needsProduct = PRODUCT_ACTIONS.has(input.action) || input.action === "add_configured_product";
    let page: ProductPageObservation | undefined;
    try {
      page = await this.productPage();
    } catch (error) {
      if (needsProduct) throw error;
    }
    const snapshot = await this.basket.read();
    let quote: CheckoutQuote | undefined;
    try {
      quote = await this.checkoutQuote();
    } catch (error) {
      if (CHECKOUT_ACTIONS.has(input.action)) throw error;
    }
    const url = page?.url ?? snapshot.url;
    const observationRef = digest({
      url,
      branchId: page?.branchId,
      product: page?.observationRef ?? null,
      basket: snapshot.observationRef,
      checkout: quote?.observedHash ?? null,
    });
    const base: Partial<BoltView> = {
      ...(page?.branchId ? { branchId: page.branchId } : {}),
      ...basketView(snapshot),
      ...(quote?.status === "complete" && quote.checkout ? { checkout: quote.checkout } : {}),
    };
    if (needsProduct && page) {
      const outcome = this.productOutcome({ status: "observed", action: (input.action === "add_configured_product" ? "read_item_options" : input.action) as ProductActionResult["action"], observationRef: page.observationRef, branchId: page.branchId, page, ...(page.detail ? { detail: page.detail } : {}) });
      return { url, observationRef, view: { ...base, ...(outcome.view as Partial<BoltView>) } };
    }
    if (BASKET_ACTIONS.has(input.action)) return { url, observationRef, view: { ...base, ...basketView(snapshot) } };
    if (CHECKOUT_ACTIONS.has(input.action)) return { url, observationRef, view: base };
    throw new BoltFault("unsupported_atomic_action");
  }

  private productOutcome(result: ProductActionResult): Record<string, unknown> {
    const page = result.page;
    const detail = result.detail ?? page?.detail;
    const view: Partial<BoltView> = {
      ...(result.branchId ? { branchId: result.branchId } : {}),
      ...(page ? {
        ...(page.search.inStore ? { search: page.search.inStore.value } : {}),
        ...(page.search.resultQuery ? { searchResultQuery: page.search.resultQuery } : {}),
        products: page.products.map((product) => ({
          ref: product.ref,
          id: product.name,
          name: product.name,
          ...(product.priceText ? { details: product.priceText } : {}),
          ...(product.priceMinor !== undefined ? { priceMinor: product.priceMinor } : {}),
          ...(product.displayedPriceBasis ? { displayedPriceBasis: product.displayedPriceBasis } : {}),
          ...(product.unitPriceMinor !== undefined ? { unitPriceMinor: product.unitPriceMinor } : {}),
          ...(product.unitPriceBasis ? { unitPriceBasis: product.unitPriceBasis } : {}),
          open: product.open?.ref ?? product.ref,
        })),
        overlay: page.detail ? "product" : "none",
      } : {}),
      ...(detail ? { item: productItem(detail) } : {}),
    };
    return {
      status: result.status,
      action: result.action,
      observationRef: page?.observationRef ?? detail?.ref,
      ...(page?.url ? { url: page.url } : {}),
      ...(page ? { product: page } : {}),
      ...(detail ? { item: detail } : {}),
      view,
    };
  }

  async run(input: BoltInput, authority?: { request?(checkout: BoltCheckout): Promise<string>; verify(ref: string, hash: string): Promise<void>; scope?: { profileKey: string } }): Promise<Record<string, unknown>> {
    const result = await this.runInner(input, authority);
    const observed = await this.observe(input);
    return { ...result, observationRef: observed.observationRef, url: observed.url };
  }

  private async runInner(input: BoltInput, authority?: { request?(checkout: BoltCheckout): Promise<string>; verify(ref: string, hash: string): Promise<void>; scope?: { profileKey: string } }): Promise<Record<string, unknown>> {
    if (PRODUCT_ACTIONS.has(input.action) || input.action === "add_configured_product") {
      if (input.action === "add_configured_product") return this.addConfigured();
      const result = await runProductAction(this.transport, {
        action: input.action as ProductActionResult["action"],
        ...(input.targetRef ? { targetRef: input.targetRef } : {}),
        ...(input.query !== undefined ? { query: input.query } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.expectedQuantity !== undefined ? { expectedQuantity: input.expectedQuantity } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.selections ? { selections: input.selections } : {}),
      }, this.productOptions());
      const resultPage = result.page ?? await this.productPage();
      return this.productOutcome({ ...result, page: resultPage, detail: result.detail ?? resultPage.detail });
    }
    if (input.action === "open_basket") {
      const opened = await this.basket.open();
      this.saveBaseline(opened.after);
      return {
        status: opened.effectDispatched ? "verified" : "observed",
        basketOpen: true,
        alreadyOpen: opened.alreadyOpen,
        basket: opened.after,
        observationRef: opened.after.observationRef,
        url: opened.after.url,
        effectsDispatched: this.#effects,
        view: basketView(opened.after),
      };
    }
    if (input.action === "read_basket") {
      const snapshot = await this.basket.read();
      this.saveBaseline(snapshot);
      return {
        status: "observed",
        basketOpen: snapshot.open,
        basketRows: !snapshot.open ? "not_open" : snapshot.complete ? "available" : "partial",
        ...(snapshot.open ? {} : { next: "open_basket" }),
        basket: snapshot,
        observationRef: snapshot.observationRef,
        url: snapshot.url,
        view: basketView(snapshot),
      };
    }
    if (input.action === "set_basket_quantity") {
      requireBolt(input.targetRef && input.expectedQuantity !== undefined && input.quantity !== undefined, "basket_quantity_precondition_required");
      const change = await this.basket.setQuantity({
        lineRef: input.targetRef,
        expectedQuantity: input.expectedQuantity,
        quantity: input.quantity,
      });
      this.saveBaseline(change.after);
      return {
        status: change.status,
        basketChange: change,
        basket: change.after,
        observationRef: change.after.observationRef,
        url: change.after.url,
        view: basketView(change.after),
      };
    }
    if (input.action === "read_checkout") {
      const quote = await this.checkoutQuote();
      return {
        status: quote.status === "complete" ? "observed" : "partial",
        checkoutStatus: quote.status,
        checkoutHash: quote.status === "complete" ? quote.checkoutHash : undefined,
        quote,
        observationRef: quote.observedHash,
        url: quote.url,
        missing: quote.missing,
        conflicts: quote.conflicts,
        view: {
          ...(quote.branchId ? { branchId: quote.branchId } : {}),
          ...(quote.status === "complete" && quote.checkout ? { checkout: quote.checkout } : {}),
        },
      };
    }
    if (input.action === "request_payment_approval") {
      const quote = await this.checkoutQuote();
      requireBolt(quote.status === "complete" && quote.checkout, "checkout_quote_incomplete");
      requireBolt(authority?.request, "checkout_approval_host_required");
      this.requireHostScope(quote.checkout, authority);
      const approvalRef = await authority.request(quote.checkout);
      return {
        status: "awaiting_user_approval",
        approvalRef,
        checkoutHash: quote.checkoutHash,
        quote,
        observationRef: quote.observedHash,
        url: quote.url,
        view: { checkout: quote.checkout },
      };
    }
    if (input.action === "pay") {
      const quote = await this.checkoutQuote();
      requireBolt(quote.status === "complete" && quote.checkout && quote.payControl?.enabled, "checkout_quote_incomplete");
      this.requireHostScope(quote.checkout, authority);
      requireBolt(input.approvedCheckoutRef && authority?.verify, "trusted_checkout_approval_required");
      await authority.verify(input.approvedCheckoutRef, quote.checkoutHash!);
      this.#guard();
      this.#effects++;
      await this.transport.click(quote.payControl.ref);
      return {
        status: "dispatched",
        verification: "payment_dispatched_unverified",
        purchase: "unverified",
        orderRead: "unavailable",
        next: "reconcile_operation_when_order_page_is_visible",
        checkoutHash: quote.checkoutHash,
        quote,
        observationRef: quote.observedHash,
        url: quote.url,
        view: { checkout: quote.checkout },
      };
    }
    throw new BoltFault("unsupported_atomic_action");
  }

  private requireHostScope(checkout: BoltCheckout, authority?: { scope?: { profileKey: string } }): void {
    const profileKey = authority?.scope?.profileKey;
    requireBolt(profileKey, "checkout_approval_host_required");
    requireBolt(checkout.account === profileKey, "checkout_identity_unverified");
  }

  async baselineFor(): Promise<unknown> {
    const page = await this.productPage();
    return this.loadBaseline(page.branchId);
  }

  private async addConfigured(): Promise<Record<string, unknown>> {
    const page = await this.productPage();
    const detail = page.detail;
    requireBolt(detail, "product_detail_not_open");
    requireBolt(detail.controls.add && !detail.controls.update, "new_item_required_for_add");
    requireBolt(detail.quantity !== null && detail.quantity > 0, "product_quantity_invalid");
    requireBolt(detail.priceMinor !== undefined, "product_price_unknown");
    const expectedName = detail.name;
    const expectedQuantity = detail.quantity;
    const expectedPriceMinor = detail.priceMinor * expectedQuantity;
    requireBolt(Number.isSafeInteger(expectedPriceMinor), "add_total_unknown");

    const branchId = detail.branchId ?? page.branchId;
    requireBolt(branchId, "branch_identity_required");
    const baseline = this.loadBaseline(branchId);
    requireBolt(baseline, "read_basket_required_before_add");

    const current = await this.basket.read();
    requireBolt(current.complete, "basket_observation_incomplete");
    if (baseline.basketTotalMinor !== null) {
      requireBolt(current.basketTotalMinor !== null, "basket_summary_unavailable_read_basket_again");
      requireBolt(current.basketTotalMinor === baseline.basketTotalMinor, "basket_changed_before_add");
    } else {
      requireBolt(baseline.emptyBasket && current.rows.length === 0 && !current.replacementPrompt &&
        (current.emptyBasket || (!current.open && !current.basketEntry && current.basketTotalMinor === null)), "basket_baseline_stale_read_basket_again");
    }

    const controls = await this.basket.readAddControls();
    const matches = controls.filter((control) => control.selector === detail.controls.add!.selector);
    requireBolt(matches.length > 0, "add_control_not_found");
    requireBolt(matches.length === 1 && !matches[0].ambiguous, "add_control_ambiguous");
    const control: BoltAddControl = matches[0];
    requireBolt(control.enabled, "add_control_disabled");
    requireBolt(!control.asUpdate, "add_control_is_update");
    requireBolt(control.quantity === expectedQuantity, "add_quantity_mismatch");
    requireBolt(control.priceMinor === expectedPriceMinor, control.priceMinor === null ? "add_price_unknown" : "add_total_mismatch");
    if (control.name) requireBolt(sameName(control.name, expectedName), "add_control_name_mismatch");

    const change = await this.basket.add({
      controlRef: control.ref,
      controlSelector: control.selector,
      expectedName,
      expectedQuantity,
      expectedPriceMinor,
      baseline,
    });
    this.saveBaseline(change.after);
    const added = change.after.rows.find((row) => row.ref === change.changed.ref);
    requireBolt(added, "added_line_not_observed");
    const previous = change.before.rows.find((row) => row.ref === change.changed.ref);
    requireBolt(added.quantity === (previous?.quantity ?? 0) + expectedQuantity, "added_line_quantity_mismatch");
    requireBolt(added.priceMinor === (previous?.priceMinor ?? 0) + expectedPriceMinor, "added_line_total_mismatch");
    const selectedLabels = detail.groups.flatMap((group) => group.choices.filter((choice) => group.mode === "quantity" ? (choice.quantity ?? 0) > 0 : choice.selected === true).map((choice) => choice.label));
    if (selectedLabels.length > 0) {
      requireBolt(selectedLabels.every((label) => (added.selectedOptions ?? "").includes(label)), "added_line_options_mismatch");
    }
    if (detail.comment.text) requireBolt(added.comment === detail.comment.text, "added_line_comment_mismatch");
    return {
      status: change.status,
      basketChange: change,
      basket: change.after,
      observationRef: change.after.observationRef,
      url: change.after.url,
      configured: {
        name: detail.name,
        quantity: expectedQuantity,
        unitPriceMinor: detail.priceMinor,
        lineTotalMinor: expectedPriceMinor,
        baseline: change.baseline,
      },
      view: basketView(change.after),
    };
  }

  async reconcile(input: BoltInput, before?: BoltView, trustedBaseline?: unknown): Promise<boolean> {
    if (input.action === "search_branch") {
      const page = await this.productPage();
      return input.query !== undefined && page.search.inStore?.value.trim() === input.query.trim() && (page.search.results || page.search.empty);
    }
    if (input.action === "open_product") {
      const page = await this.productPage();
      const target = before?.products?.find((product) => product.ref === input.targetRef);
      return !!page.detail && (!target || sameName(page.detail.name, target.name));
    }
    if (input.action === "close_product") return (await this.productPage()).detail === undefined;
    if (input.action === "set_product_quantity") {
      const page = await this.productPage();
      const detail = page.detail;
      if (!detail) return false;
      return detail.quantity === input.quantity && (!before?.item || sameName(detail.name, before.item.name));
    }
    if (input.action === "set_item_comment") {
      const page = await this.productPage();
      const detail = page.detail;
      if (!detail) return false;
      return detail.comment.text === input.text && (!before?.item || sameName(detail.name, before.item.name));
    }
    if (input.action === "set_item_options") {
      const page = await this.productPage();
      const detail = page.detail;
      if (!detail) return false;
      return (input.selections ?? []).every((selection) => {
        const group = detail.groups.find((candidate) => candidate.ref === selection.groupRef);
        if (!group) return false;
        return selection.choices.every((wanted) => {
          const choice = group.choices.find((candidate) => candidate.ref === wanted.choiceRef);
          return choice && (group.mode === "quantity" ? choice.quantity : Number(choice.selected)) === wanted.quantity;
        });
      });
    }
    if (input.action === "open_basket") return (await this.basket.read()).open;
    if (input.action === "set_basket_quantity") {
      const snapshot = await this.basket.read();
      if (!snapshot.complete) return false;
      const original = before?.basket?.find((line) => line.ref === input.targetRef);
      if (!original) return false;
      const line = snapshot.rows.find((row) => row.ref === input.targetRef);
      if (input.quantity === 0) {
        if (line) return false;
      } else if (!line || line.quantity !== input.quantity) return false;
      if (line && !sameName(line.name, original.name)) return false;
      if (before?.basket) {
        const otherBefore = before.basket.filter((entry) => entry.ref !== input.targetRef).map((entry) => [entry.ref, entry.quantity] as const).sort();
        const otherAfter = snapshot.rows.filter((entry) => entry.ref !== input.targetRef).map((entry) => [entry.ref, entry.quantity] as const).sort();
        if (JSON.stringify(otherBefore) !== JSON.stringify(otherAfter)) return false;
      }
      return true;
    }
    if (input.action === "add_configured_product") {
      const item = before?.item;
      if (!item) return false;
      const baseline = (trustedBaseline as BoltBasketSnapshot | undefined) ?? this.loadBaseline(before.branchId);
      if (!baseline) return false;
      const snapshot = await this.basket.read();
      const selectedLabels = item.groups.flatMap((group) => group.choices
        .filter((choice) => group.mode === "quantity" ? (choice.quantity ?? 0) > 0 : choice.selected)
        .map((choice) => choice.label));
      const matches = (row: BoltBasketLine) => sameName(row.name, item.name)
        && selectedLabels.every((label) => (row.selectedOptions ?? "").includes(label))
        && (!item.comment.text || row.comment === item.comment.text);
      const previous = baseline.rows.find(matches);
      const addTotal = item.unitPriceMinor * item.quantity;
      const expectedTotal = (previous?.priceMinor ?? 0) + addTotal;
      const baselineTotal = baseline.basketTotalMinor ?? (baseline.emptyBasket && baseline.rows.length === 0 ? 0 : null);
      if (!snapshot.open || !snapshot.complete) {
        return baselineTotal !== null && snapshot.basketTotalMinor === baselineTotal + addTotal;
      }
      const line = snapshot.rows.find(matches);
      if (!line) return false;
      if (line.quantity !== (previous?.quantity ?? 0) + item.quantity) return false;
      if (line.priceMinor !== expectedTotal) return false;
      const otherBefore = baseline.rows.filter((row) => !matches(row)).map((row) => [row.ref, row.quantity] as const).sort();
      const otherAfter = snapshot.rows.filter((row) => !matches(row)).map((row) => [row.ref, row.quantity] as const).sort();
      return JSON.stringify(otherBefore) === JSON.stringify(otherAfter);
    }
    return false;
  }
}

export function createBoltAtomicOperations(options: BoltAtomicOptions): BoltAtomicOperations {
  return new BoltAtomicOperations(options);
}
