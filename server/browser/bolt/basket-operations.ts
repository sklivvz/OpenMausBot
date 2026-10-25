import { BoltFault, requireBolt } from "./contracts.ts";
import { digest } from "./state.ts";

const ADD = '[data-testid="components.ProviderDish.addButton"]';
const PRODUCT_CARD = '[data-testid="components.GridMenuDishBase.view"]';
const BASKET_ENTRIES = [
  { id: "components.MainNavigationMenu.viewBasketButton", priority: 0 },
  { id: "screens.Groceries.GroceriesScreen.activeBasketButton", priority: 1 },
  { id: "screens.Provider.Menu.ProviderMenuStickySearch.viewBasket", priority: 2 },
] as const;

/** A disposable browser transport: evaluate a page script and click a selector produced by this module. */
export interface BoltBasketTransport {
  url(): string | Promise<string>;
  evaluate(script: string): Promise<unknown>;
  click(selector: string): Promise<void>;
}

export interface BoltBasketEffect {
  kind: "open_basket" | "add_product" | "increase_quantity" | "decrease_quantity";
  control: string;
  targetRef?: string;
  expectedQuantity?: number;
}

/** Hooks let the existing operation journal record intent immediately before a browser effect. */
export interface BoltBasketHooks {
  beforeEffect?(effect: BoltBasketEffect): void | Promise<void>;
  afterEffect?(effect: BoltBasketEffect, outcome: "dispatched" | "unknown"): void | Promise<void>;
}

export interface BoltBasketControl {
  selector: string;
  enabled: boolean;
  text: string;
}

export interface BoltBasketLine {
  /** Deterministic observation ref derived from the observed name, choices and comment, never from price or quantity. */
  ref: string;
  name: string;
  /** Bolt's recorded basket row exposes no item-level provider id. Never substitute the shared counter test id. */
  providerItemId: null;
  observedTestIds: string[];
  quantity: number;
  /** Bolt renders `total_price` (extended line total) in the row accessibility label, not a unit price. */
  priceText: string;
  priceMinor: number | null;
  priceBasis: "line_total";
  priceProvenance: "total_price_or_original_price";
  unitPriceMinor: null;
  selectedOptions: string | null;
  comment: string | null;
  label: string;
  ambiguous: boolean;
  containerSelector: string;
  counterTestId: string;
  controls: { minus: BoltBasketControl; plus: BoltBasketControl | null; quantity: BoltBasketControl };
  warnings: string[];
}

export interface BoltBasketEntry {
  testId: string;
  priority: number;
  selector: string;
  text: string;
  priceText: string | null;
  priceMinor: number | null;
  enabled: boolean;
}

export interface BoltBasketSnapshot {
  url: string;
  open: boolean;
  checkoutId: string | null;
  branchId: string | null;
  basketTotalText: string | null;
  basketTotalMinor: number | null;
  basketTotalSource: "basket_button" | "empty_basket" | null;
  emptyBasket: boolean;
  complete: boolean;
  errors: string[];
  observedCounters: number;
  skippedRows: number;
  zeroQuantityRows: number;
  basketEntry: BoltBasketEntry | null;
  rows: BoltBasketLine[];
  replacementPrompt: boolean;
  unknowns: string[];
  observationRef: string;
}

export interface BoltAddControl {
  ref: string;
  name: string | null;
  nameSource: "product_card" | "heading" | "aria_label" | "none";
  controlText: string;
  asUpdate: boolean;
  /** Observed add quantity from Bolt's `Add {N} ...` accessibility label, or the recorded simple-card default of one. */
  quantity: number | null;
  quantitySource: "aria_label" | "simple_default" | "unknown";
  priceText: string | null;
  priceMinor: number | null;
  priceBasis: "add_total";
  priceSource: "control" | "aria_label" | "product_label" | null;
  selector: string;
  enabled: boolean;
  containerText: string;
  ambiguous: boolean;
  warnings: string[];
}

export interface BoltBasketChange {
  status: "verified" | "verified_limited";
  effectDispatched: boolean;
  before: BoltBasketSnapshot;
  after: BoltBasketSnapshot;
  changed: { ref: string; name: string; from: number | null; to: number; addedQuantity?: number };
  total: { beforeMinor: number | null; afterMinor: number | null; lineDeltaMinor: number | null; observedDeltaMinor: number | null; verified: boolean };
  baseline: "observed" | "empty_basket" | "unknown";
  preservedRows: boolean | "unknown";
  warnings: string[];
}

export interface BoltBasketOpenResult {
  status: "verified";
  effectDispatched: boolean;
  alreadyOpen: boolean;
  before: BoltBasketSnapshot;
  after: BoltBasketSnapshot;
}

export interface BoltBasketSetQuantityInput {
  lineRef: string;
  expectedQuantity: number;
  quantity: number;
}

export interface BoltBasketAddInput {
  controlRef: string;
  expectedName?: string;
  expectedQuantity?: number;
  expectedPriceMinor?: number;
  baseline?: BoltBasketSnapshot;
}

export interface BoltBasketOptions {
  origin?: string;
  timeoutMs?: number;
  pollMs?: number;
  clickTimeoutMs?: number;
  hooks?: BoltBasketHooks;
}

const READ_SCRIPT = `(() => {
  const MAX_ROWS = 100;
  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const visible = (element) => {
    try { return !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none"; } catch { return false; }
  };
  const cssPath = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      let index = 1;
      for (let previous = node.previousElementSibling; previous; previous = previous.previousElementSibling) index++;
      parts.unshift(node.tagName.toLowerCase() + ":nth-child(" + index + ")");
      if (parts.length > 24) break;
    }
    return parts.join(" > ");
  };
  const parseMoney = (text) => {
    const matches = [...String(text || "").matchAll(/(-?)(\\d[\\d\\s.,]*)\\s*€/g)];
    if (matches.length === 0) return null;
    const match = matches[matches.length - 1];
    const value = match[2].replace(/[\\s\\u00a0]/g, "");
    const decimal = /^(.*?)(?:[.,](\\d{1,2}))?$/.exec(value);
    if (!decimal) return null;
    const whole = decimal[1].replace(/[.,]/g, "");
    if (!/^\\d+$/.test(whole)) return null;
    const cents = Number(whole) * 100 + Number((decimal[2] || "").padEnd(2, "0"));
    if (!Number.isSafeInteger(cents)) return null;
    return (match[1] === "-" ? -1 : 1) * cents;
  };
  const parseProductLabel = (label) => {
    let value = clean(label).replace(/^[\\s,;|]+/, "").replace(/^[\\uE000-\\uF8FF\\s]+/u, "").trim();
    for (let index = 0; index < 4; index++) {
      const next = value.replace(/,\\s*[0-9][0-9\\s.,]*\\s*€(?:\\s*\\/\\s*[a-zA-Z]+)?\\s*$/, "").trim();
      if (next === value) break;
      value = next;
    }
    return value || null;
  };
  const packPrice = (label) => {
    const match = /(?:^|,\\s*)(\\d+(?:[.,]\\d+)?)\\s*€(?![^,]*\\/)/.exec(String(label || ""));
    if (!match) return null;
    const amount = Number(match[1].replace(",", "."));
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  };
  const activation = (element) => {
    if (!element || element.nodeType !== 1) return false;
    const tag = element.tagName.toLowerCase();
    if (["button", "a"].includes(tag) || element.getAttribute("role") === "button") return true;
    if (element.hasAttribute("tabindex") || element.hasAttribute("onclick")) return true;
    return (element.getAttribute("data-testid") || "").endsWith("checkoutItemCounter.plus");
  };
  const counterLabel = (row) => {
    const labels = [];
    if (row.getAttribute("aria-label")) labels.push(clean(row.getAttribute("aria-label")));
    for (const node of row.querySelectorAll("[aria-label]")) {
      if (node === row) continue;
      const label = clean(node.getAttribute("aria-label"));
      if (/Amount:\\s*\\d+/.test(label) && /Price:\\s*[0-9]/.test(label)) labels.push(label);
    }
    const matching = labels.filter((label) => /Amount:\\s*\\d+/.test(label) && /Price:\\s*[0-9]/.test(label));
    if (matching.length === 1) return { text: matching[0], source: "aria_label", ambiguous: false };
    if (matching.length > 1) return { text: matching[0], source: "aria_label", ambiguous: true };
    return { text: clean(row.innerText), source: "inner_text", ambiguous: false };
  };
  const parseRow = (label) => {
    let match = /([\\s\\S]*?)\\s*\\.?\\s*Amount:\\s*(\\d+)\\s*\\.?\\s*Price:\\s*([0-9][0-9\\s.,]*\\s*€)/i.exec(label);
    if (!match) return null;
    let name = clean(match[1]).replace(/^[\\s,;|]+/, "").replace(/^[\\uE000-\\uF8FF\\s]+/u, "").trim().replace(/\\.$/, "");
    if (name.includes("\\n")) name = name.split("\\n").map(clean).filter(Boolean).pop() || name;
    const rest = label.slice(match.index + match[0].length);
    const options = /Selected options:\\s*([\\s\\S]*?)(?:\\.\\s*Comment:|$)/i.exec(rest)?.[1];
    const comment = /Comment:\\s*([\\s\\S]*?)(?:\\.\\s*$|$)/i.exec(rest)?.[1];
    return {
      name: name || null,
      quantity: Number(match[2]),
      priceText: clean(match[3]),
      selectedOptions: options ? clean(options) || null : null,
      comment: comment ? clean(comment) || null : null,
    };
  };
  const rows = [];
  const errors = [];
  const allCounters = [...document.querySelectorAll('[data-testid="components.CheckoutItem.checkoutItemCounter"]')].filter(visible);
  const counterCount = allCounters.length;
  const counters = allCounters.slice(0, MAX_ROWS + 1);
  if (counters.length > MAX_ROWS) errors.push("basket_row_limit");
  for (const counter of counters.slice(0, MAX_ROWS)) {
    const texts = [...counter.querySelectorAll('[data-testid="components.CheckoutItem.checkoutItemCounter.text"], [data-testid$="checkoutItemCounter.text"]')].filter(visible);
    const minuses = [...counter.querySelectorAll('[data-testid="components.CheckoutItem.checkoutItemCounter.minus"], [data-testid$="checkoutItemCounter.minus"]')].filter(visible);
    if (texts.length !== 1 || minuses.length !== 1) { errors.push("counter_anchor_ambiguous"); continue; }
    const text = texts[0];
    const minus = minuses[0];
    let row = counter.parentElement;
    let depth = 0;
    let label = null;
    while (row && depth++ < 12) {
      const inside = row.querySelectorAll('[data-testid="components.CheckoutItem.checkoutItemCounter"]').length;
      if (inside === 1) {
        const candidate = counterLabel(row);
        if (candidate.text && /Amount:\\s*\\d+/.test(candidate.text) && /Price:\\s*[0-9]/.test(candidate.text)) { label = candidate; break; }
      }
      row = row.parentElement;
    }
    if (!row || !label) { errors.push("row_container_missing"); continue; }
    if (label.ambiguous) { errors.push("row_label_ambiguous"); continue; }
    const facts = parseRow(label.text);
    if (!facts || facts.name === null) { errors.push("row_label_unparsed"); continue; }
    const quantityText = clean(text.textContent);
    const plusTestIds = [...counter.querySelectorAll('[data-testid="components.CheckoutItem.checkoutItemCounter.plus"], [data-testid$="checkoutItemCounter.plus"]')].filter(visible);
    let plus = plusTestIds.length === 1 ? plusTestIds[0] : null;
    let plusSource = plus ? "testid" : null;
    let plusWarning = plusTestIds.length > 1 ? "quantity_plus_ambiguous" : null;
    if (!plus && plusWarning === null) {
      const candidates = [...counter.querySelectorAll("*")].filter((element) => {
        if (!visible(element) || element === counter || element === text || element === minus) return false;
        if (text.contains(element) || minus.contains(element)) return false;
        if (!activation(element)) return false;
        const label = clean(element.getAttribute("aria-label"));
        return !/decrease|remove|delete|trash|vähenda|eemalda/i.test(label);
      });
      if (candidates.length === 1) { plus = candidates[0]; plusSource = "structural"; }
      else plusWarning = candidates.length === 0 ? "quantity_plus_missing" : "quantity_plus_ambiguous";
    }
    const testIds = [...new Set([row, ...row.querySelectorAll("[data-testid]")].map((element) => element.getAttribute("data-testid")).filter(Boolean))].slice(0, 20);
    rows.push({
      label: label.text,
      labelSource: label.source,
      name: facts.name,
      quantityText,
      quantity: facts.quantity,
      priceText: facts.priceText,
      selectedOptions: facts.selectedOptions,
      comment: facts.comment,
      counterTestId: counter.getAttribute("data-testid") || "components.CheckoutItem.checkoutItemCounter",
      containerSelector: cssPath(row),
      textSelector: cssPath(text),
      minusSelector: cssPath(minus),
      minusEnabled: !minus.disabled && minus.getAttribute("aria-disabled") !== "true",
      plusSelector: plus ? cssPath(plus) : null,
      plusEnabled: plus ? !plus.disabled && plus.getAttribute("aria-disabled") !== "true" : false,
      plusSource,
      plusWarning,
      observedTestIds: testIds,
    });
  }
  const entries = [];
  for (const [index, spec] of ${JSON.stringify(BASKET_ENTRIES)}.entries()) {
    for (const element of [...document.querySelectorAll('[data-testid="' + spec.id + '"]')].filter(visible)) {
      const text = clean(element.innerText || element.textContent);
      entries.push({ testId: spec.id, priority: index, selector: cssPath(element), text, priceText: (text.match(/[0-9][0-9\\s.,]*\\s*€/g) || []).pop() || null, priceMinor: parseMoney(text), enabled: !element.disabled && element.getAttribute("aria-disabled") !== "true" });
    }
  }
  const bodyText = clean(document.body.innerText);
  return {
    url: location.href,
    checkout: /\\/checkout\\/[0-9]+(?:\\/|$)/.test(location.pathname),
    emptyBasket: /empty basket|basket is empty|ostukorv on tühi/i.test(bodyText),
    replacementPrompt: /Start a new order\\?/i.test(bodyText),
    counterCount,
    rows,
    errors,
    entries,
    addControls: [...document.querySelectorAll('${ADD}')].filter(visible).slice(0, 50).map((addButton) => {
      const controlText = clean(addButton.innerText || addButton.textContent);
      const ariaLabel = clean(addButton.getAttribute("aria-label"));
      const controlLabel = controlText.replace(/^[\\uE000-\\uF8FF\\s]+/u, "");
      const card = addButton.closest('${PRODUCT_CARD}');
      let container = card;
      let name = card ? parseProductLabel(card.getAttribute("aria-label") || card.innerText) : null;
      let nameSource = name ? "product_card" : "none";
      if (!name) {
        let node = addButton.parentElement;
        for (let depth = 0; node && depth < 8; node = node.parentElement, depth++) {
          const heading = node.querySelector('h1, h2, h3, h4, [role="heading"]');
          if (heading && clean(heading.innerText)) { container = node; name = clean(heading.innerText); nameSource = "heading"; break; }
        }
      }
      if (!name) {
        let node = addButton.parentElement;
        for (let depth = 0; node && depth < 8; node = node.parentElement, depth++) {
          const label = clean(node.getAttribute("aria-label"));
          if (label && /€/.test(label)) { container = node; name = parseProductLabel(label); nameSource = "aria_label"; break; }
        }
      }
      const quantityMatch = /\\b(?:Add|Update)\\s+(\\d+)\\b/i.exec(ariaLabel || controlText);
      const quantity = quantityMatch ? Number(quantityMatch[1]) : (card ? 1 : null);
      const quantitySource = quantityMatch ? "aria_label" : (card ? "simple_default" : "unknown");
      let priceMinor = parseMoney(controlText);
      let priceSource = priceMinor === null ? null : "control";
      if (priceMinor === null && ariaLabel) { priceMinor = parseMoney(ariaLabel); priceSource = priceMinor === null ? null : "aria_label"; }
      if (priceMinor === null && container) {
        priceMinor = packPrice(container.getAttribute("aria-label") || container.innerText);
        if (priceMinor !== null) priceSource = "product_label";
      }
      return {
        name,
        nameSource,
        controlText,
        ariaLabel,
        asUpdate: /^Update(?:\\s|$|[0-9])/i.test(controlLabel) || /^Update/i.test(ariaLabel),
        quantity,
        quantitySource,
        selector: cssPath(addButton),
        priceText: (controlText.match(/[0-9][0-9\\s.,]*\\s*€/g) || []).pop() || (ariaLabel.match(/[0-9][0-9\\s.,]*\\s*€/g) || []).pop() || null,
        priceMinor,
        priceSource,
        enabled: !addButton.disabled && addButton.getAttribute("aria-disabled") !== "true",
        containerText: clean(container ? (container.getAttribute("aria-label") || container.innerText) : controlText).slice(0, 500),
      };
    }),
  };
})()`;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 4000): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function integer(value: unknown, min = 0, max = 100): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function money(value: string | null): number | null {
  if (!value) return null;
  const matches = [...value.matchAll(/(-?)(\d[\d\s.,]*)\s*€/g)];
  if (matches.length === 0) return null;
  const match = matches[matches.length - 1];
  const digits = match[2].replace(/[\s\u00a0]/g, "");
  const parsed = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(digits);
  if (!parsed) return null;
  const whole = parsed[1].replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  const cents = Number(whole) * 100 + Number((parsed[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return (match[1] === "-" ? -1 : 1) * cents;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^[\s,;|]+/, "").replace(/^[\uE000-\uF8FF\s]+/u, "").replace(/\.$/, "").trim();
}

function pathId(url: string): { branchId: string | null; checkoutId: string | null } {
  const parsed = new URL(url);
  return {
    branchId: /\/p\/(\d+)(?:-|\/|$)/.exec(parsed.pathname)?.[1] ?? /\/checkout\/(\d+)(?:\/|$)/.exec(parsed.pathname)?.[1] ?? null,
    checkoutId: /\/checkout\/(\d+)(?:\/|$)/.exec(parsed.pathname)?.[1] ?? null,
  };
}

function parseRead(raw: unknown, origin: string): BoltBasketSnapshot {
  const result = object(raw);
  requireBolt(result, "basket_observation_invalid");
  const url = text(result.url, 2048);
  requireBolt(url, "basket_observation_invalid");
  const parsedUrl = new URL(url);
  requireBolt(parsedUrl.origin === origin && !parsedUrl.username && !parsedUrl.password, "bolt_origin_required");
  const errors: string[] = [];
  if (Array.isArray(result.errors)) for (const entry of result.errors.slice(0, 20)) if (typeof entry === "string" && !errors.includes(entry)) errors.push(entry);
  const observedCounters = integer(result.counterCount, 0, 1000) ?? 0;
  const rawRows = Array.isArray(result.rows) ? result.rows : [];
  requireBolt(rawRows.length <= 100, "basket_row_limit");
  const rows: BoltBasketLine[] = [];
  let skippedRows = 0;
  let zeroQuantityRows = 0;
  for (const entry of rawRows) {
    const row = object(entry);
    const name = row ? text(row.name, 1000) : null;
    const quantity = row ? integer(row.quantity, 0, 100) : null;
    const quantityText = row ? text(row.quantityText, 20) : null;
    const priceText = row ? text(row.priceText, 100) : null;
    const containerSelector = row ? text(row.containerSelector, 8000) : null;
    const textSelector = row ? text(row.textSelector, 8000) : null;
    const minusSelector = row ? text(row.minusSelector, 8000) : null;
    if (!name || quantity === null || quantityText === null || priceText === null || !containerSelector || !textSelector || !minusSelector) {
      skippedRows++;
      if (!errors.includes("basket_row_unparsed")) errors.push("basket_row_unparsed");
      continue;
    }
    if (quantity === 0) { zeroQuantityRows++; continue; }
    const observed = Array.isArray(row!.observedTestIds) ? row!.observedTestIds.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
    const identity = digest({ name: normalized(name), selectedOptions: text(row!.selectedOptions, 1000), comment: text(row!.comment, 1000) });
    const plusSelector = text(row!.plusSelector, 8000);
    const plusWarning = text(row!.plusWarning, 200);
    const priceMinor = money(priceText);
    const lineWarnings: string[] = [];
    if (plusWarning) lineWarnings.push(plusWarning);
    if (priceMinor === null) {
      lineWarnings.push("row_price_unknown");
      if (!errors.includes("row_price_unparsed")) errors.push("row_price_unparsed");
    }
    const line: BoltBasketLine = {
      ref: `line_${identity.slice(0, 20)}`,
      name: normalized(name),
      providerItemId: null,
      observedTestIds: observed,
      quantity,
      priceText,
      priceMinor,
      priceBasis: "line_total",
      priceProvenance: "total_price_or_original_price",
      unitPriceMinor: null,
      selectedOptions: text(row!.selectedOptions, 2000),
      comment: text(row!.comment, 2000),
      label: text(row!.label, 4000) ?? "",
      ambiguous: false,
      containerSelector,
      counterTestId: text(row!.counterTestId, 200) ?? "components.CheckoutItem.checkoutItemCounter",
      controls: {
        minus: { selector: minusSelector, enabled: row!.minusEnabled === true, text: "" },
        plus: plusSelector ? { selector: plusSelector, enabled: row!.plusEnabled !== false, text: text(row!.plusSource, 20) ?? "observed" } : null,
        quantity: { selector: textSelector, enabled: true, text: quantityText },
      },
      warnings: lineWarnings,
    };
    rows.push(line);
  }
  const byRef = new Map<string, number>();
  for (const row of rows) byRef.set(row.ref, (byRef.get(row.ref) ?? 0) + 1);
  for (const row of rows) {
    if ((byRef.get(row.ref) ?? 0) > 1) { row.ambiguous = true; row.warnings.push("basket_line_ambiguous"); }
  }
  const entries: BoltBasketEntry[] = [];
  const rawEntries = Array.isArray(result.entries) ? result.entries : [];
  for (const entry of rawEntries) {
    const item = object(entry);
    if (!item) continue;
    const testId = text(item.testId, 200);
    const selector = text(item.selector, 8000);
    const label = text(item.text, 1000);
    const priority = integer(item.priority, 0, 10);
    if (!testId || !selector || label === null || priority === null) continue;
    entries.push({ testId, priority, selector, text: label, priceText: text(item.priceText, 100), priceMinor: money(text(item.priceText, 100)), enabled: item.enabled !== false });
  }
  entries.sort((a, b) => a.priority - b.priority || a.selector.localeCompare(b.selector));
  const distinctTotals = new Set(entries.filter((entry) => entry.enabled && entry.priceMinor !== null).map((entry) => entry.priceMinor));
  if (distinctTotals.size > 1) errors.push("multiple_basket_totals");
  const best = entries.find((entry) => entry.enabled);
  const emptyBasket = result.emptyBasket === true;
  const open = result.checkout === true || rows.length > 0 || emptyBasket;
  const complete = errors.length === 0 && skippedRows === 0 && observedCounters === rows.length + zeroQuantityRows;
  const unknowns = ["provider_item_id_not_observed", "line_total_may_be_original_price"];
  if (rows.some((row) => row.ambiguous)) unknowns.push("basket_line_ambiguous");
  if (rows.some((row) => row.controls.plus === null)) unknowns.push("quantity_plus_not_uniquely_observed");
  if (zeroQuantityRows > 0) unknowns.push("zero_quantity_rows_present");
  if (best === undefined) unknowns.push("basket_total_not_observed");
  if (!complete) unknowns.push("basket_observation_incomplete");
  const basketTotalSource = best ? "basket_button" as const : emptyBasket && rows.length === 0 ? "empty_basket" as const : null;
  return {
    url,
    open,
    ...pathId(url),
    basketTotalText: best?.priceText ?? null,
    basketTotalMinor: best?.priceMinor ?? null,
    basketTotalSource,
    emptyBasket,
    complete,
    errors,
    observedCounters,
    skippedRows,
    zeroQuantityRows,
    basketEntry: best ?? null,
    rows,
    replacementPrompt: result.replacementPrompt === true,
    unknowns,
    observationRef: digest({ url, complete, errors, rows: rows.map((row) => ({ ref: row.ref, quantity: row.quantity, priceMinor: row.priceMinor })), total: best?.priceMinor ?? null }),
  };
}

function parseAddControls(raw: unknown): { controls: BoltAddControl[]; replacementPrompt: boolean } {
  const result = object(raw);
  requireBolt(result, "add_controls_observation_invalid");
  const list = Array.isArray(result.addControls) ? result.addControls : [];
  requireBolt(list.length <= 50, "add_controls_limit");
  const controls: BoltAddControl[] = [];
  for (const entry of list) {
    const item = object(entry);
    if (!item) continue;
    const selector = text(item.selector, 8000);
    const controlText = text(item.controlText, 1000);
    if (!selector || controlText === null) continue;
    const name = text(item.name, 1000);
    const priceText = text(item.priceText, 100);
    const priceMinor = integer(item.priceMinor, 0, 1000000) ?? money(priceText);
    const quantity = integer(item.quantity, 1, 100);
    const identity = digest({ name: name ? normalized(name) : null, quantity, priceText, controlText, container: text(item.containerText, 500) });
    controls.push({
      ref: `add_${identity.slice(0, 20)}`,
      name: name ? normalized(name) : null,
      nameSource: item.nameSource === "product_card" || item.nameSource === "heading" || item.nameSource === "aria_label" ? item.nameSource : "none",
      controlText,
      asUpdate: item.asUpdate === true,
      quantity,
      quantitySource: item.quantitySource === "aria_label" || item.quantitySource === "simple_default" ? item.quantitySource : "unknown",
      priceText,
      priceMinor,
      priceBasis: "add_total",
      priceSource: item.priceSource === "control" || item.priceSource === "aria_label" || item.priceSource === "product_label" ? item.priceSource : null,
      selector,
      enabled: item.enabled !== false,
      containerText: text(item.containerText, 500) ?? "",
      ambiguous: false,
      warnings: quantity === null ? ["add_quantity_unknown"] : [],
    });
  }
  const counts = new Map<string, number>();
  for (const control of controls) counts.set(control.ref, (counts.get(control.ref) ?? 0) + 1);
  for (const control of controls) if ((counts.get(control.ref) ?? 0) > 1) { control.ambiguous = true; control.warnings.push("add_control_ambiguous"); }
  return { controls, replacementPrompt: result.replacementPrompt === true };
}

function sameRows(left: BoltBasketSnapshot, right: BoltBasketSnapshot): boolean {
  if (left.rows.length !== right.rows.length) return false;
  const map = new Map(right.rows.map((row) => [row.ref, row.quantity]));
  return left.rows.every((row) => map.get(row.ref) === row.quantity);
}

function totalValue(snapshot: BoltBasketSnapshot): number | null {
  if (snapshot.basketTotalMinor !== null) return snapshot.basketTotalMinor;
  if (snapshot.emptyBasket && snapshot.rows.length === 0) return 0;
  return null;
}

function assertBaseline(baseline: BoltBasketSnapshot): void {
  requireBolt(baseline.open, "basket_baseline_not_open");
  requireBolt(baseline.complete, "basket_baseline_incomplete");
  requireBolt(baseline.basketTotalMinor !== null || (baseline.emptyBasket && baseline.rows.length === 0), "basket_baseline_total_unknown");
  const refs = new Set<string>();
  for (const row of baseline.rows) {
    requireBolt(!refs.has(row.ref) && !row.ambiguous, "basket_baseline_ambiguous");
    refs.add(row.ref);
  }
}

function changeTotal(before: number | null, after: BoltBasketSnapshot, lineDelta: number | null): BoltBasketChange["total"] {
  const observed = before !== null && after.basketTotalMinor !== null ? after.basketTotalMinor - before : null;
  return { beforeMinor: before, afterMinor: after.basketTotalMinor, lineDeltaMinor: lineDelta, observedDeltaMinor: observed, verified: observed !== null && lineDelta !== null && observed === lineDelta };
}

function othersPreserved(before: BoltBasketSnapshot, after: BoltBasketSnapshot, targetRef: string): boolean {
  const othersBefore = before.rows.filter((row) => row.ref !== targetRef);
  const othersAfter = after.rows.filter((row) => row.ref !== targetRef);
  if (othersBefore.length !== othersAfter.length) return false;
  return othersBefore.every((row) => othersAfter.find((candidate) => candidate.ref === row.ref)?.quantity === row.quantity);
}

function addDiff(baseline: BoltBasketSnapshot, baselineTotal: number | null, after: BoltBasketSnapshot, name: string, addQuantity: number, addTotal: number): { ok: boolean; retry: boolean; code?: string; row?: BoltBasketLine; lineDeltaMinor?: number | null } {
  if (!after.complete) return { ok: false, retry: true };
  const afterRefs = new Set<string>();
  for (const row of after.rows) {
    if (afterRefs.has(row.ref) || row.ambiguous) return { ok: false, retry: false, code: "basket_rows_ambiguous" };
    afterRefs.add(row.ref);
  }
  const changed = after.rows.filter((row) => {
    const previous = baseline.rows.find((candidate) => candidate.ref === row.ref);
    return !previous || previous.quantity !== row.quantity;
  });
  const removed = baseline.rows.filter((row) => !after.rows.some((candidate) => candidate.ref === row.ref));
  if (removed.length > 0) return { ok: false, retry: false, code: "basket_row_removed_during_add" };
  if (changed.length === 0) return { ok: false, retry: true };
  if (changed.length > 1) return { ok: false, retry: false, code: "basket_rows_changed_during_add" };
  const row = changed[0];
  const previous = baseline.rows.find((candidate) => candidate.ref === row.ref);
  const delta = previous ? row.quantity - previous.quantity : row.quantity;
  if (delta !== addQuantity) return { ok: false, retry: true };
  if (normalized(row.name) !== normalized(name)) return { ok: false, retry: false, code: "added_line_name_mismatch" };
  const different = after.rows.filter((candidate) => candidate.ref !== row.ref && baseline.rows.find((item) => item.ref === candidate.ref)?.quantity !== candidate.quantity);
  if (different.length > 0 || baseline.rows.some((item) => item.ref !== row.ref && !after.rows.some((candidate) => candidate.ref === item.ref))) return { ok: false, retry: false, code: "basket_rows_changed_during_add" };
  const lineDelta = previous ? (row.priceMinor !== null && previous.priceMinor !== null ? row.priceMinor - previous.priceMinor : null) : row.priceMinor;
  if (lineDelta === null) return { ok: false, retry: false, code: "added_line_total_unknown" };
  if (lineDelta !== addTotal) return { ok: false, retry: false, code: "added_line_total_mismatch" };
  if (baselineTotal !== null && after.basketTotalMinor !== null) {
    const deltaMinor = after.basketTotalMinor - baselineTotal;
    if (deltaMinor === 0) return { ok: false, retry: true };
    if (deltaMinor !== addTotal) return { ok: false, retry: false, code: "basket_total_delta_mismatch" };
  }
  return { ok: true, retry: false, row, lineDeltaMinor: lineDelta };
}

export class BoltBasketOperations {
  readonly transport: BoltBasketTransport;
  readonly origin: string;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly clickTimeoutMs: number;
  readonly hooks?: BoltBasketHooks;
  #effectsDispatched = 0;

  get effectsDispatched(): number { return this.#effectsDispatched; }

  constructor(transport: BoltBasketTransport, options: BoltBasketOptions = {}) {
    this.transport = transport;
    this.origin = options.origin ?? "https://food.bolt.eu";
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.pollMs = options.pollMs ?? 200;
    this.clickTimeoutMs = options.clickTimeoutMs ?? Math.max(this.timeoutMs, 1000);
    this.hooks = options.hooks;
  }

  private async evaluate(script: string): Promise<unknown> {
    const url = await this.transport.url();
    const parsed = new URL(url);
    requireBolt(parsed.origin === this.origin && !parsed.username && !parsed.password, "bolt_origin_required");
    return this.transport.evaluate(script);
  }

  private async dispatch(effect: BoltBasketEffect, action: () => Promise<void>): Promise<void> {
    requireBolt(effect.control.length > 0 && effect.control.length <= 8000, "effect_control_invalid");
    await this.hooks?.beforeEffect?.(effect);
    this.#effectsDispatched++;
    let timer: NodeJS.Timeout | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("click_deadline_exceeded")), this.clickTimeoutMs);
        timer.unref();
      });
      await Promise.race([action(), deadline]);
    } catch {
      await this.hooks?.afterEffect?.(effect, "unknown");
      throw new BoltFault("outcome_unknown_reconcile_required");
    } finally {
      if (timer) clearTimeout(timer);
    }
    await this.hooks?.afterEffect?.(effect, "dispatched");
  }

  private async waitFor(predicate: (snapshot: BoltBasketSnapshot) => boolean): Promise<BoltBasketSnapshot> {
    let latest = await this.read();
    if (predicate(latest)) return latest;
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      latest = await this.read();
      if (latest.replacementPrompt) throw new BoltFault("basket_replacement_confirmation_required");
      if (predicate(latest)) return latest;
    }
    throw new BoltFault("verification_incomplete_reconcile_required");
  }

  async read(): Promise<BoltBasketSnapshot> {
    return parseRead(await this.evaluate(READ_SCRIPT), this.origin);
  }

  async open(): Promise<BoltBasketOpenResult> {
    const before = await this.read();
    requireBolt(before.complete, "basket_observation_incomplete");
    if (before.open) return { status: "verified", effectDispatched: false, alreadyOpen: true, before, after: before };
    requireBolt(before.basketEntry, "basket_entry_not_found");
    requireBolt(before.basketEntry.enabled, "basket_entry_disabled");
    const entry = before.basketEntry;
    const latest = await this.read();
    requireBolt(latest.complete && latest.basketEntry?.testId === entry.testId && latest.basketEntry.priceMinor === entry.priceMinor, "basket_entry_changed_before_effect");
    await this.dispatch({ kind: "open_basket", control: latest.basketEntry.selector }, () => this.transport.click(latest.basketEntry!.selector));
    const after = await this.waitFor((snapshot) => snapshot.open && snapshot.complete);
    return { status: "verified", effectDispatched: true, alreadyOpen: false, before, after };
  }

  async readAddControls(): Promise<BoltAddControl[]> {
    return parseAddControls(await this.evaluate(READ_SCRIPT)).controls;
  }

  async add(input: BoltBasketAddInput): Promise<BoltBasketChange> {
    const current = await this.read();
    requireBolt(current.complete, "basket_observation_incomplete");
    const controls = await this.readAddControls();
    const matches = controls.filter((control) => control.ref === input.controlRef);
    requireBolt(matches.length > 0, "add_control_not_found");
    requireBolt(matches.length === 1 && !matches[0].ambiguous, "add_control_ambiguous");
    const control = matches[0];
    requireBolt(control.enabled, "add_control_disabled");
    requireBolt(!control.asUpdate, "add_control_is_update");
    requireBolt(control.name, "add_control_name_unknown");
    const controlName = control.name;
    if (input.expectedName !== undefined) requireBolt(normalized(controlName) === normalized(input.expectedName), "add_control_name_mismatch");
    const addQuantity = input.expectedQuantity ?? control.quantity;
    requireBolt(addQuantity !== null && addQuantity >= 1 && addQuantity <= 100, "add_quantity_unknown");
    if (input.expectedQuantity !== undefined) requireBolt(control.quantity === input.expectedQuantity, "add_quantity_mismatch");
    const addTotal = input.expectedPriceMinor ?? control.priceMinor;
    requireBolt(addTotal !== null, "add_price_unknown");
    if (input.expectedPriceMinor !== undefined && control.priceMinor !== null) requireBolt(input.expectedPriceMinor === control.priceMinor, "add_price_mismatch");

    let baseline: BoltBasketSnapshot | null = input.baseline ?? null;
    if (baseline) assertBaseline(baseline);
    if (!baseline && current.open) {
      assertBaseline(current);
      baseline = current;
    }
    const before = baseline ?? current;
    const beforeTotal = baseline ? totalValue(baseline) : totalValue(current);
    let baselineKind: "observed" | "empty_basket" | "unknown";
    if (baseline) baselineKind = baseline.basketTotalMinor === null && baseline.emptyBasket && baseline.rows.length === 0 ? "empty_basket" : "observed";
    else if (current.emptyBasket && current.rows.length === 0) baselineKind = "empty_basket";
    else baselineKind = "unknown";
    requireBolt(beforeTotal !== null, "basket_baseline_required_for_add");
    if (baseline) {
      const currentTotal = totalValue(current);
      if (!(totalValue(baseline) === 0 && currentTotal === null)) {
        requireBolt(currentTotal !== null && currentTotal === totalValue(baseline), "basket_changed_before_add");
      }
      if (current.open) requireBolt(sameRows(current, baseline), "basket_changed_before_add");
    }

    const latestControls = (await this.readAddControls()).filter((candidate) => candidate.ref === input.controlRef);
    requireBolt(latestControls.length === 1 && !latestControls[0].ambiguous, "add_control_changed_before_effect");
    const latest = latestControls[0];
    requireBolt(latest.enabled && !latest.asUpdate && latest.name === controlName && latest.quantity === addQuantity && latest.priceMinor === addTotal, "add_control_changed_before_effect");
    await this.dispatch({ kind: "add_product", control: latest.selector, targetRef: latest.ref, expectedQuantity: addQuantity }, () => this.transport.click(latest.selector));
    const applied = await this.waitForAdd(control, addTotal, beforeTotal);
    if (applied.replacementPrompt) throw new BoltFault("basket_replacement_confirmation_required");
    const opened = applied.open ? applied : (await this.open()).after;
    if (baselineKind === "observed" || baselineKind === "empty_basket") {
      const deadline = Date.now() + this.timeoutMs;
      let after = opened;
      while (Date.now() < deadline) {
        const diff = addDiff(before, beforeTotal, after, controlName, addQuantity, addTotal);
        if (diff.ok) {
          const total = changeTotal(beforeTotal, after, diff.lineDeltaMinor ?? addTotal);
          requireBolt(total.observedDeltaMinor === addTotal, "basket_total_delta_mismatch");
          const warnings = [...after.rows.flatMap((row) => row.warnings)].slice(0, 20);
          const previous = before.rows.find((row) => row.ref === diff.row!.ref);
          return {
            status: "verified",
            effectDispatched: true,
            before,
            after,
            changed: { ref: diff.row!.ref, name: diff.row!.name, from: previous?.quantity ?? 0, to: diff.row!.quantity, addedQuantity: addQuantity },
            total,
            baseline: baselineKind,
            preservedRows: true,
            warnings,
          };
        }
        if (!diff.retry) throw new BoltFault(diff.code ?? "verification_incomplete_reconcile_required");
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
        after = await this.read();
      }
      throw new BoltFault("verification_incomplete_reconcile_required");
    }

    requireBolt(opened.complete, "basket_observation_incomplete");
    const matching = opened.rows.filter((row) => normalized(row.name) === normalized(controlName));
    requireBolt(matching.length === 1, "added_line_not_uniquely_observed");
    const changed = matching[0];
    const total = changeTotal(beforeTotal, opened, null);
    requireBolt(total.observedDeltaMinor === addTotal, "basket_total_delta_mismatch");
    return {
      status: "verified_limited",
      effectDispatched: true,
      before,
      after: opened,
      changed: { ref: changed.ref, name: changed.name, from: null, to: changed.quantity, addedQuantity: addQuantity },
      total,
      baseline: "unknown",
      preservedRows: "unknown",
      warnings: ["baseline_absent_current_quantity_unknown"],
    };
  }

  private async waitForAdd(control: BoltAddControl, addTotal: number, beforeTotal: number | null): Promise<BoltBasketSnapshot> {
    const deadline = Date.now() + this.timeoutMs;
    let latest = await this.read();
    while (Date.now() < deadline) {
      if (latest.replacementPrompt) return latest;
      if (latest.complete) {
        const controls = await this.readAddControls();
        const current = controls.find((candidate) => candidate.name === control.name);
        const totalDelta = latest.basketTotalMinor !== null && beforeTotal !== null ? latest.basketTotalMinor - beforeTotal : null;
        if (totalDelta !== null && totalDelta !== 0 && totalDelta !== addTotal) throw new BoltFault("basket_total_delta_mismatch");
        const updateSignal = current?.asUpdate === true;
        if (totalDelta === addTotal || (updateSignal && (totalDelta === null || totalDelta === addTotal))) return latest;
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
      latest = await this.read();
    }
    throw new BoltFault("verification_incomplete_reconcile_required");
  }

  async setQuantity(input: BoltBasketSetQuantityInput): Promise<BoltBasketChange> {
    requireBolt(Number.isInteger(input.quantity) && input.quantity >= 0 && input.quantity <= 100, "quantity_invalid");
    requireBolt(Number.isInteger(input.expectedQuantity) && input.expectedQuantity >= 0 && input.expectedQuantity <= 100, "expected_quantity_invalid");
    const before = await this.read();
    requireBolt(before.open, "basket_not_open");
    requireBolt(before.complete, "basket_observation_incomplete");
    const target = before.rows.filter((row) => row.ref === input.lineRef);
    requireBolt(target.length > 0, "basket_line_not_found");
    requireBolt(target.length === 1 && !target[0].ambiguous, "basket_line_ambiguous");
    const line = target[0];
    requireBolt(line.quantity === input.expectedQuantity, "quantity_precondition_failed");
    requireBolt(before.rows.filter((row) => row.ref !== line.ref && row.ambiguous).length === 0, "basket_rows_ambiguous");
    if (input.quantity === line.quantity) {
      return { status: "verified", effectDispatched: false, before, after: before, changed: { ref: line.ref, name: line.name, from: line.quantity, to: line.quantity }, total: changeTotal(totalValue(before), before, 0), baseline: "observed", preservedRows: true, warnings: ["quantity_unchanged"] };
    }
    if (input.quantity > line.quantity) {
      requireBolt(line.controls.plus, line.warnings.includes("quantity_plus_ambiguous") ? "quantity_increase_control_ambiguous" : "quantity_increase_control_missing");
      requireBolt(line.controls.plus.enabled, "quantity_increase_control_disabled");
    }
    let currentQuantity = line.quantity;
    for (let step = 0; step < Math.abs(input.quantity - line.quantity); step++) {
      const current = await this.read();
      requireBolt(current.complete, "basket_observation_incomplete");
      const currentLine = current.rows.find((row) => row.ref === line.ref);
      requireBolt(currentLine && currentLine.quantity === currentQuantity, "basket_line_changed_during_operation");
      requireBolt(current.rows.filter((row) => row.ref !== line.ref && row.ambiguous).length === 0, "basket_rows_ambiguous");
      requireBolt(othersPreserved(before, current, line.ref), "basket_rows_changed_during_operation");
      const next = currentQuantity + (input.quantity > line.quantity ? 1 : -1);
      const control = next > currentQuantity ? currentLine.controls.plus : currentLine.controls.minus;
      requireBolt(control, "quantity_increase_control_missing");
      requireBolt(control.enabled, next > currentQuantity ? "quantity_increase_control_disabled" : "quantity_decrease_control_disabled");
      await this.dispatch({ kind: next > currentQuantity ? "increase_quantity" : "decrease_quantity", control: control.selector, targetRef: line.ref, expectedQuantity: currentQuantity }, () => this.transport.click(control.selector));
      const afterStep = await this.waitFor((snapshot) => {
        if (!snapshot.complete) return false;
        const row = snapshot.rows.find((candidate) => candidate.ref === line.ref);
        return next === 0 ? row === undefined : row?.quantity === next;
      });
      const observed = afterStep.rows.find((row) => row.ref === line.ref);
      requireBolt(next === 0 ? observed === undefined : observed?.quantity === next, "quantity_delta_mismatch");
      requireBolt(othersPreserved(before, afterStep, line.ref), "basket_rows_changed_during_operation");
      currentQuantity = next;
    }
    const after = await this.read();
    requireBolt(after.complete, "basket_observation_incomplete");
    const remaining = after.rows.find((row) => row.ref === line.ref);
    requireBolt(input.quantity === 0 ? remaining === undefined : remaining?.quantity === input.quantity, "quantity_verification_failed");
    requireBolt(othersPreserved(before, after, line.ref), "basket_rows_changed_during_operation");
    const afterLineTotal = input.quantity === 0 ? 0 : remaining?.priceMinor ?? null;
    const lineDelta = line.priceMinor !== null && afterLineTotal !== null ? afterLineTotal - line.priceMinor : null;
    const total = changeTotal(totalValue(before), after, lineDelta);
    const warnings: string[] = [];
    if (lineDelta === null) warnings.push("line_total_unknown");
    if (total.observedDeltaMinor === null) warnings.push("basket_total_unavailable");
    else if (total.observedDeltaMinor === 0 && lineDelta !== 0) warnings.push("basket_total_not_updated");
    else if (lineDelta !== null && !total.verified) warnings.push("basket_total_delta_unexpected");
    return { status: total.verified ? "verified" : "verified_limited", effectDispatched: true, before, after, changed: { ref: line.ref, name: line.name, from: line.quantity, to: input.quantity }, total, baseline: "observed", preservedRows: true, warnings };
  }
}

export function createBasketOperations(transport: BoltBasketTransport, options?: BoltBasketOptions): BoltBasketOperations {
  return new BoltBasketOperations(transport, options);
}
