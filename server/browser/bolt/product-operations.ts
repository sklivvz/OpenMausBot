import type { BoltDomTransport } from "./browser.ts";
import { BoltFault } from "./contracts.ts";
import { digest } from "./state.ts";

/**
 * Selectors and field names below come from the public Bolt Food web bundle
 * https://food.bolt.eu/_expo/static/js/web/index-6c9f5a6981b9e8534582dd15d4cf5e0b.js
 * (sha256 df909f20f08346d8f1345e5dd65c645b06e7225a65862ab6205a58e0965c5965),
 * observed 25 October 2026. The fixture is synthetic; this is source evidence,
 * not a live qualification.
 */
export const PRODUCT_DOM_EVIDENCE = {
  url: "https://food.bolt.eu/_expo/static/js/web/index-6c9f5a6981b9e8534582dd15d4cf5e0b.js",
  sha256: "df909f20f08346d8f1345e5dd65c645b06e7225a65862ab6205a58e0965c5965",
  observedAt: "2026-10-25",
  components: [
    "GridMenuDishBase.view",
    "GridMenuDishBase.button",
    "GridMenuDishBase.title",
    "GridMenuDishBase.price",
    "GridMenuDishBase.originalPrice",
    "GridMenuDishBase.unitPrice",
    "ProviderMenuStickySearch.searchInput.input",
    "ProviderMenuStickySearch.searchInput.cancelButton",
    "ProviderDish.dishName",
    "ProviderDish.dishPrice.originalPrice",
    "ProviderDish.dishPrice.discount",
    "ProviderDish.additionalPriceInfo",
    "ProviderDish.dishCounter",
    "ProviderDish.dishCounter.plus",
    "ProviderDish.dishCounter.minus",
    "ProviderDish.dishCounter.text",
    "ProviderDish.addButton",
    "ProviderDish.updateButton",
    "ProviderDish.removeButton",
    "ProviderDish.dishComment",
    "ProviderDish.optionsContainer",
    "screens.Provider.Dish.DishBottomSheet.closeButton",
    "CheckboxGroup.view",
    "CheckboxGroup.title",
    "CheckboxGroup.itemRow",
    "CheckboxGroup.itemRadio",
    "CheckboxGroup.itemCheckbox",
    "CheckboxGroup.itemCounter.plus",
    "CheckboxGroup.itemCounter.minus",
  ],
} as const;

export interface ProductControl {
  ref: string;
  selector: string;
  signature: string;
  enabled: boolean;
  label?: string;
}

export interface ProductSearchInput extends ProductControl {
  value: string;
}

export interface ProductCardObservation {
  ref: string;
  name: string;
  pack?: string;
  priceMinor?: number;
  priceText?: string;
  originalPriceText?: string;
  discountText?: string;
  unitPriceMinor?: number;
  unitPriceText?: string;
  unitPriceBasis?: "per_kg" | "per_g" | "per_l" | "per_ml" | "per_pc";
  displayedPriceBasis?: "per_pack";
  cardSelector: string;
  open: ProductControl | null;
  openError?: string;
  signature: string;
}

export interface ProductOptionChoice {
  ref: string;
  id: string;
  label: string;
  selected: boolean | null;
  available: boolean;
  quantity: number | null;
  maxQuantity: number | null;
  control: ProductControl;
  plus?: ProductControl;
  minus?: ProductControl;
}

export interface ProductOptionGroup {
  ref: string;
  id: string;
  label: string;
  labelKnown: boolean;
  required: boolean;
  min: number | null;
  max: number | null;
  mode: "single" | "multiple" | "quantity" | "unknown";
  choices: ProductOptionChoice[];
}

export interface ProductDetailObservation {
  ref: string;
  branchId?: string;
  name: string;
  pack?: string;
  priceMinor?: number;
  priceText?: string;
  originalPriceText?: string;
  discountText?: string;
  unitPriceMinor?: number;
  unitPriceText?: string;
  unitPriceBasis?: "per_kg" | "per_g" | "per_l" | "per_ml" | "per_pc";
  quantity: number | null;
  quantityText: string | null;
  quantityControls: "available" | "absent" | "ambiguous";
  comment: {
    supported: boolean;
    text: string;
    maxLength: number | null;
    input?: ProductControl;
  };
  groups: ProductOptionGroup[];
  options: "none_observed" | "observed" | "unknown";
  controls: {
    close?: ProductControl;
    add?: ProductControl;
    update?: ProductControl;
    remove?: ProductControl;
    quantity?: {
      root: ProductControl;
      text: ProductControl;
      plus?: ProductControl;
      minus?: ProductControl;
    };
  };
  signature: string;
}

export interface ProductPageObservation {
  url: string;
  origin: string;
  branchId?: string;
  branchName?: string;
  search: {
    inStore?: ProductSearchInput;
    global?: ProductSearchInput;
    inStoreCount: number;
    globalCount: number;
    inStoreAmbiguous: boolean;
    launcher?: ProductControl;
    active: boolean;
    results: boolean;
    empty: boolean;
    resultQuery?: string;
  };
  products: ProductCardObservation[];
  productListSignature: string;
  resultSignature: string;
  detail?: ProductDetailObservation;
  overlay: "none" | "product" | "unknown";
  issues: string[];
  observationRef: string;
}

export type ProductOperation =
  | "read_products"
  | "search"
  | "open"
  | "read_detail"
  | "set_quantity"
  | "set_options"
  | "set_comment"
  | "close";

export interface ProductPlanAction {
  kind: "click" | "fill";
  selector: string;
  value?: string;
  targetRef: string;
  signature: string;
  purpose: string;
}

export interface ProductPlanIdentity {
  branchId?: string;
  cardRef?: string;
  detailRef?: string;
  productName?: string;
  noDetail?: boolean;
}

export interface ProductPlan {
  operation: ProductOperation;
  actions: ProductPlanAction[];
  identity?: ProductPlanIdentity;
}

export interface ProductOptionsSelection {
  groupRef: string;
  choices: Array<{ choiceRef: string; quantity: number }>;
}

export interface ProductOperationOptions {
  origin?: string;
  guard?: () => void;
  timeoutMs?: number;
  pollMs?: number;
}

const DEFAULT_ORIGIN = "https://food.bolt.eu";
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_POLL_MS = 150;

function fail(code: string): never {
  throw new BoltFault(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function originOf(options: ProductOperationOptions): string {
  return options.origin ?? DEFAULT_ORIGIN;
}

function checkOrigin(url: string, expected: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("bolt_origin_required");
  }
  if (parsed.origin !== expected || parsed.username || parsed.password) fail("bolt_origin_required");
}

function normalizedName(value: string): string {
  return value
    .replace(/^[\s,;]+/, "")
    .replace(/\s+/g, " ")
    .replace(/\s*[,;]\s*\d+(?:[.,]\d+)?\s*€\s*$/i, "")
    .trim();
}

function sameName(left: string, right: string): boolean {
  return normalizedName(left).toLocaleLowerCase() === normalizedName(right).toLocaleLowerCase();
}

function packOf(name: string): string | undefined {
  const match = /(?:^|[,;]\s*)((?:(?:\d+\s*[x×]\s*)+\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl)|[~∼]?\s*\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|cl)|\d+\s*(?:pcs?|pc|tk|rl|rolls?|pakk|pack))\.?)\s*$/i.exec(name);
  return match?.[1]?.trim();
}

function sameCardIdentity(left: string, right: string, leftPrice?: number, rightPrice?: number): boolean {
  if (sameName(left, right)) return true;
  const a = normalizedName(left).toLocaleLowerCase();
  const b = normalizedName(right).toLocaleLowerCase();
  if (!a.includes(b) && !b.includes(a)) return false;
  if (leftPrice !== undefined && rightPrice !== undefined) return leftPrice === rightPrice;
  return Boolean(packOf(left) && packOf(left) === packOf(right));
}

function unitBasis(value: string | undefined): ProductDetailObservation["unitPriceBasis"] {
  switch (value?.toLowerCase()) {
    case "kg": return "per_kg";
    case "g": return "per_g";
    case "l": return "per_l";
    case "ml": return "per_ml";
    case "pc":
    case "pcs":
    case "tk": return "per_pc";
    default: return undefined;
  }
}

function control(raw: {
  selector?: unknown;
  enabled?: unknown;
  label?: unknown;
  signature?: unknown;
} | null | undefined, ref: string, fallback?: () => string): ProductControl | undefined {
  if (!raw || typeof raw.selector !== "string" || raw.selector.length === 0) return undefined;
  const selector = raw.selector;
  const signature = typeof raw.signature === "string" && raw.signature.length > 0
    ? raw.signature
    : digest({ ref, selector });
  return {
    ref,
    selector,
    signature,
    enabled: raw.enabled !== false,
    ...(typeof raw.label === "string" && raw.label.trim() ? { label: raw.label.trim() } : {}),
    ...(fallback ? { ref: fallback() } : {}),
  };
}

interface RawPage {
  url: string;
  branchId?: string;
  branchName?: string;
  search: {
    inStore?: { selector: string; value: string; enabled: boolean };
    global?: { selector: string; value: string; enabled: boolean };
    inStoreCount: number;
    globalCount: number;
    launcher?: { selector: string; label: string; enabled: boolean };
    active: boolean;
    results: boolean;
    empty: boolean;
    resultQuery?: string;
  };
  products: Array<{
    name: string;
    pack?: string;
    priceMinor?: number;
    priceText?: string;
    originalPriceText?: string;
    discountText?: string;
    unitPriceMinor?: number;
    unitPriceText?: string;
    unitPriceBasis?: string;
    cardSelector: string;
    clickSelector?: string;
  }>;
  detail: null | {
    name: string;
    priceText?: string;
    priceMinor?: number;
    originalPriceText?: string;
    discountText?: string;
    unitPriceText?: string;
    unitPriceMinor?: number;
    unitPriceBasis?: string;
    quantity: number | null;
    quantityText: string | null;
    quantityAmbiguous?: boolean;
    optionsPresent?: boolean;
    quantityRoot?: { selector: string; enabled: boolean };
    quantityTextControl?: { selector: string; enabled: boolean };
    quantityPlus?: { selector: string; enabled: boolean };
    quantityMinus?: { selector: string; enabled: boolean };
    close?: { selector: string; enabled: boolean };
    add?: { selector: string; enabled: boolean };
    update?: { selector: string; enabled: boolean };
    remove?: { selector: string; enabled: boolean };
    comment?: { selector: string; enabled: boolean; text: string; maxLength: number | null };
    groups: Array<{
      title: string;
      titleKnown: boolean;
      required: boolean;
      min: number | null;
      max: number | null;
      mode: "single" | "multiple" | "quantity" | "unknown";
      selector: string;
      choices: Array<{
        label: string;
        labelKnown: boolean;
        selected: boolean | null;
        available: boolean;
        quantity: number | null;
        maxQuantity: number | null;
        control: { selector: string; enabled: boolean };
        plus?: { selector: string; enabled: boolean };
        minus?: { selector: string; enabled: boolean };
      }>;
    }>;
  };
  issues: string[];
}

const OBSERVATION_SCRIPT = String.raw`(() => {
  const issues = [];
  const visible = (element) => {
    if (!element) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return element.getClientRects().length > 0;
  };
  const cssPath = (element) => {
    const parts = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
      parts.unshift(node.tagName.toLowerCase() + ":nth-child(" + index + ")");
    }
    return parts.join(" > ");
  };
  const textOf = (element) => element ? (element.textContent || "").trim() : "";
  const one = (selector, root) => {
    const elements = [...(root || document).querySelectorAll(selector)].filter(visible);
    if (elements.length > 1) { issues.push("ambiguous:" + selector); return null; }
    return elements[0] || null;
  };
  const many = (selector, root) => [...(root || document).querySelectorAll(selector)].filter(visible);
  const attr = (element, name) => element ? (element.getAttribute(name) || "") : "";
  const money = (value) => {
    const text = (value || "").replace(/\u00a0|\u202f/g, " ").replace(/−/g, "-");
    const match = /(-?\d+(?:[.,]\d{1,2})?)\s*€/.exec(text);
    if (!match) return null;
    const amount = Number(match[1].replace(",", "."));
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
  };
  const unit = (value) => {
    const match = /(\d+(?:[.,]\d+)?)\s*€\s*\/\s*(kg|g|l|ml|cl|pcs?|pc|tk)\b/i.exec(value || "");
    if (!match) return null;
    return { minor: Math.round(Number(match[1].replace(",", ".")) * 100), basis: match[2].toLowerCase() };
  };
  const stripPrice = (value) => (value || "")
    .replace(/^[\s,;]+/, "")
    .replace(/\s*[,;]\s*\d+(?:[.,]\d+)?\s*€\s*$/i, "")
    .trim();
  const cardRoots = many('[data-testid="components.GridMenuDishBase.view"]').slice(0, 120);
  const products = [];
  for (const card of cardRoots) {
    try {
      const title = one('[data-testid="components.GridMenuDishBase.title"]', card);
      const price = one('[data-testid="components.GridMenuDishBase.price"]', card);
      const original = one('[data-testid="components.GridMenuDishBase.originalPrice"]', card);
      const discount = one('[data-testid="components.GridMenuDishBase.discount"]', card);
      const unitPrice = one('[data-testid="components.GridMenuDishBase.unitPrice"]', card);
      const click = many('[data-testid="components.GridMenuDishBase.button"]', card);
      const label = attr(card, "aria-label");
      const name = textOf(title) || stripPrice(label);
      if (!name) { issues.push("card_name_missing"); continue; }
      const priceText = textOf(price) || (/,\s*(\d+(?:[.,]\d+)?\s*€)\s*$/.exec(label) || [])[1] || "";
      const facts = unit(textOf(unitPrice));
      products.push({
        name,
        pack: undefined,
        priceMinor: money(priceText),
        priceText: priceText || undefined,
        originalPriceText: textOf(original) || undefined,
        discountText: textOf(discount) || undefined,
        unitPriceMinor: facts ? facts.minor : null,
        unitPriceText: textOf(unitPrice) || undefined,
        unitPriceBasis: facts ? facts.basis : undefined,
        cardSelector: cssPath(card),
        clickSelector: click.length === 1 ? cssPath(click[0]) : undefined,
      });
      if (click.length !== 1) issues.push("card_click_target_" + (click.length === 0 ? "missing" : "ambiguous"));
    } catch (error) {
      issues.push("card_read_failed:" + String(error.message || error));
    }
  }
  const pageInputs = many("input, textarea").filter((element) => {
    const testId = attr(element, "data-testid");
    return testId.startsWith("screens.Provider.Menu.ProviderMenuStickySearch.searchInput.") || testId === "screens.Search.searchInput.blurred";
  });
  const inStoreInputs = pageInputs.filter((element) => attr(element, "data-testid").startsWith("screens.Provider.Menu.ProviderMenuStickySearch.searchInput."));
  const globalInputs = pageInputs.filter((element) => attr(element, "data-testid") === "screens.Search.searchInput.blurred");
  const inputFacts = (element) => element ? {
    selector: cssPath(element),
    value: element.value || "",
    enabled: !element.disabled && attr(element, "aria-disabled") !== "true",
  } : undefined;
  const launcherCandidates = many('button, [role=button], [tabindex], [onclick], [data-testid="components.ProviderStickyTitleHeader.searchButton"]').filter((element) => {
    const label = (attr(element, "aria-label") || textOf(element)).replace(/^[\uE000-\uF8FF\s]+/u, "");
    return /^(search for food|search$)/i.test(label) || attr(element, "data-testid") === "components.ProviderStickyTitleHeader.searchButton";
  });
  const launcher = launcherCandidates.length === 1 ? {
    selector: cssPath(launcherCandidates[0]),
    label: attr(launcherCandidates[0], "aria-label") || textOf(launcherCandidates[0]),
    enabled: !launcherCandidates[0].disabled && attr(launcherCandidates[0], "aria-disabled") !== "true",
  } : undefined;
  if (launcherCandidates.length > 1) issues.push("ambiguous:search_launcher");
  const cancel = many('[data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.cancelButton"]');
  const active = cancel.length > 0 || location.pathname.toLowerCase().includes("/menusearchmodal");
  const empty = many('[data-testid="screens.Provider.Menu.ProviderMenuStickySearch.emptySearchState"]').length > 0;
  const results = many('[data-testid="screens.Provider.Menu.ProviderMenuStickySearch.results"]').length > 0;
  const resultQuery = new URL(location.href).searchParams.get("query") || undefined;
  let detail = null;
  try {
    const close = one('[data-testid="screens.Provider.Dish.DishBottomSheet.closeButton"]');
    const name = one('[data-testid="components.ProviderDish.dishName"]');
    const add = one('[data-testid="components.ProviderDish.addButton"]');
    const update = one('[data-testid="components.ProviderDish.updateButton"]');
    const remove = one('[data-testid="components.ProviderDish.removeButton"]');
    if (close || name) {
      let scope = close || name;
      const anchor = name || close;
      for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
        if (scope.contains(anchor) && scope.querySelector('[data-testid="components.ProviderDish.addButton"], [data-testid="components.ProviderDish.updateButton"]')) break;
      }
      const sheet = scope || document.body;
      const fullDetailText = sheet.innerText || sheet.textContent || "";
      const nameText = textOf(name);
      const nameIndex = nameText ? fullDetailText.indexOf(nameText) : -1;
      const detailText = nameIndex >= 0 ? fullDetailText.slice(nameIndex) : fullDetailText;
      const currentLine = detailText.split("\n").map((line) => line.trim()).find((line) => /^-?\d+(?:[.,]\d{1,2})?\s*€$/.test(line));
      const discountElement = one('[data-testid="components.ProviderDish.dishPrice.discount"]', sheet);
      const originalElement = one('[data-testid="components.ProviderDish.dishPrice.originalPrice"]', sheet);
      const discountText = textOf(discountElement);
      const priceText = money(discountText) !== null ? discountText : currentLine || discountText || "";
      const unitTexts = many('[data-testid="components.ProviderDish.additionalPriceInfo"]', sheet).map(textOf);
      const unitText = unitTexts.find((value) => /€\s*\//.test(value)) || (detailText.split("\n").map((line) => line.trim()).find((line) => /€\s*\/\s*(kg|g|l|ml|cl|pcs?|pc|tk)\b/i.test(line)) || "");
      const facts = unit(unitText);
      const counterRoots = many('[data-testid="components.ProviderDish.dishCounter"]', document);
      const counters = counterRoots.map((root) => {
        const text = one('[data-testid="components.ProviderDish.dishCounter.text"]', root);
        const plus = one('[data-testid="components.ProviderDish.dishCounter.plus"]', root);
        const minus = one('[data-testid="components.ProviderDish.dishCounter.minus"]', root);
        const insideAction = Boolean(root.closest('[data-testid="components.ProviderDish.addButton"], [data-testid="components.ProviderDish.updateButton"], [data-testid="components.ProviderDish.removeButton"]'));
        const plusEnabled = Boolean(plus) && !plus.disabled && attr(plus, "aria-disabled") !== "true";
        const minusEnabled = Boolean(minus) && !minus.disabled && attr(minus, "aria-disabled") !== "true";
        return {
          root,
          text,
          plus: plusEnabled ? plus : null,
          minus: minusEnabled ? minus : null,
          score: (insideAction ? 0 : 10) + (plusEnabled ? 4 : 0) + (minusEnabled ? 2 : 0) + (text ? 1 : 0),
        };
      }).filter((entry) => entry.text);
      counters.sort((left, right) => right.score - left.score);
      const chosen = counters[0];
      const ambiguousQuantity = counters.length > 1 && counters[1].score === chosen.score;
      const quantityText = chosen ? textOf(chosen.text) : null;
      const parsedQuantity = quantityText && /^\d{1,3}$/.test(quantityText) ? Number(quantityText) : null;
      const commentElement = one('[data-testid="components.ProviderDish.dishComment"]', sheet);
      const optionContainers = many('[data-testid="components.ProviderDish.optionsContainer"]', sheet);
      const optionContainer = optionContainers.length === 1 ? optionContainers[0] : null;
      if (optionContainers.length > 1) issues.push("ambiguous:optionsContainer");
      const groups = [];
      if (optionContainer) {
        const groupElements = many('[data-testid="components.CheckboxGroup.view"]', optionContainer);
        for (const groupElement of groupElements) {
          const titleElement = one('[data-testid="components.CheckboxGroup.title"]', groupElement);
          const title = textOf(titleElement);
          const atLeast = /(\d+)/.exec(textOf(one('[data-testid="components.CheckboxGroup.atLeastLabel"]', groupElement)))?.[1];
          const notMoreThan = /(\d+)/.exec(textOf(one('[data-testid="components.CheckboxGroup.notMoreThanLabel"]', groupElement)))?.[1];
          const required = Boolean(one('[data-testid="components.CheckboxGroup.required"]', groupElement)) || /required|kohustuslik/i.test(textOf(groupElement));
          const rowLabels = many('[data-testid^="components.CheckboxGroup.itemRow."]', groupElement)
            .filter((element) => {
              const id = attr(element, "data-testid");
              return !id.includes(".infoButton") && !id.includes(".feeInfo");
            });
          const choices = [];
          let mode = "unknown";
          for (const row of rowLabels) {
            const label = textOf(row);
            let holder = row;
            let input = null;
            for (let depth = 0; holder && depth < 6; depth++, holder = holder.parentElement) {
              const candidates = [
                ...(holder.matches && holder.matches("input[type=radio], input[type=checkbox], [role=radio], [role=checkbox]") ? [holder] : []),
                ...holder.querySelectorAll("input[type=radio], input[type=checkbox], [role=radio], [role=checkbox]"),
              ].filter(visible);
              if (candidates.length === 1) { input = candidates[0]; break; }
              if (candidates.length > 1) break;
            }
            let clickable = input;
            if (!clickable) {
              let ancestor = row;
              for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
                if (ancestor.matches && (ancestor.matches("button, [role=button]") || ancestor.getAttribute("tabindex") !== null)) { clickable = ancestor; break; }
              }
            }
            if (!clickable) clickable = row;
            const inputType = input ? (input.getAttribute("type") || input.getAttribute("role") || "").toLowerCase() : "";
            if (inputType === "radio") mode = mode === "unknown" || mode === "single" ? "single" : "unknown";
            else if (inputType === "checkbox") mode = mode === "unknown" || mode === "multiple" ? "multiple" : "unknown";
            const counterPlus = one('[data-testid="components.CheckboxGroup.itemCounter.plus"]', holder || groupElement);
            const counterMinus = one('[data-testid="components.CheckboxGroup.itemCounter.minus"]', holder || groupElement);
            if (counterPlus || counterMinus) mode = "quantity";
            const counterText = one('[data-testid="components.CheckboxGroup.itemCounter.text"]', holder || groupElement);
            const quantity = counterText && /^\d{1,3}$/.test(textOf(counterText)) ? Number(textOf(counterText)) : null;
            choices.push({
              label,
              labelKnown: Boolean(label),
              selected: input ? (input.checked === true || attr(input, "aria-checked") === "true") : null,
              available: Boolean(clickable) && !clickable.disabled && attr(clickable, "aria-disabled") !== "true",
              quantity,
              maxQuantity: counterText && /^\d{1,3}$/.test(attr(counterText, "aria-valuemax")) ? Number(attr(counterText, "aria-valuemax")) : null,
              control: { selector: cssPath(clickable), enabled: Boolean(clickable) && !clickable.disabled && attr(clickable, "aria-disabled") !== "true" },
              plus: counterPlus ? { selector: cssPath(counterPlus), enabled: !counterPlus.disabled && attr(counterPlus, "aria-disabled") !== "true" } : undefined,
              minus: counterMinus ? { selector: cssPath(counterMinus), enabled: !counterMinus.disabled && attr(counterMinus, "aria-disabled") !== "true" } : undefined,
            });
          }
          groups.push({
            title,
            titleKnown: Boolean(title),
            required,
            min: atLeast ? Number(atLeast) : null,
            max: notMoreThan ? Number(notMoreThan) : null,
            mode,
            selector: cssPath(groupElement),
            choices,
          });
        }
      }
      detail = {
        name: textOf(name),
        priceText: priceText || undefined,
        priceMinor: money(priceText),
        originalPriceText: textOf(originalElement) || undefined,
        discountText: textOf(discountElement) || undefined,
        unitPriceText: unitText || undefined,
        unitPriceMinor: facts ? facts.minor : null,
        unitPriceBasis: facts ? facts.basis : undefined,
        quantity: parsedQuantity,
        quantityText,
        quantityRoot: chosen ? { selector: cssPath(chosen.root), enabled: true } : undefined,
        quantityTextControl: chosen?.text ? { selector: cssPath(chosen.text), enabled: true } : undefined,
        quantityPlus: chosen?.plus ? { selector: cssPath(chosen.plus), enabled: true } : undefined,
        quantityMinus: chosen?.minus ? { selector: cssPath(chosen.minus), enabled: true } : undefined,
        close: close ? { selector: cssPath(close), enabled: !close.disabled && attr(close, "aria-disabled") !== "true" } : undefined,
        add: add ? { selector: cssPath(add), enabled: !add.disabled && attr(add, "aria-disabled") !== "true" } : undefined,
        update: update ? { selector: cssPath(update), enabled: !update.disabled && attr(update, "aria-disabled") !== "true" } : undefined,
        remove: remove ? { selector: cssPath(remove), enabled: !remove.disabled && attr(remove, "aria-disabled") !== "true" } : undefined,
        comment: commentElement ? {
          selector: cssPath(commentElement),
          enabled: !commentElement.disabled && attr(commentElement, "aria-disabled") !== "true",
          text: commentElement.value || "",
          maxLength: commentElement.maxLength > 0 ? commentElement.maxLength : null,
        } : undefined,
        groups,
        quantityAmbiguous: ambiguousQuantity,
        optionsPresent: optionContainers.length > 0,
      };
    }
  } catch (error) {
    issues.push("detail_read_failed:" + String(error.message || error));
  }
  return {
    url: location.href,
    branchId: (/\/p\/(\d+)(?:-|\/|$)/.exec(location.pathname) || [])[1] || (/\/checkout\/(\d+)(?:\/|$)/.exec(location.pathname) || [])[1] || (location.pathname.toLowerCase().includes("/menusearchmodal") ? new URL(location.href).searchParams.get("providerId") || undefined : undefined),
    branchName: textOf(one("h1")),
    search: {
      inStore: inputFacts(inStoreInputs[0]),
      global: inputFacts(globalInputs[0]),
      inStoreCount: inStoreInputs.length,
      globalCount: globalInputs.length,
      launcher,
      active,
      results,
      empty,
      resultQuery,
    },
    products,
    detail,
    issues,
  };
})()`;

function decodeRaw(raw: unknown): RawPage {
  let value = raw;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  if (!value || typeof value !== "object") fail("product_observation_invalid");
  const candidate = value as { error?: unknown; url?: unknown; products?: unknown; search?: unknown; detail?: unknown };
  if (typeof candidate.error === "string") fail(`product_observation_failed:${candidate.error.slice(0, 120)}`);
  if (typeof candidate.url !== "string" || !Array.isArray(candidate.products) || !candidate.search || typeof candidate.search !== "object") {
    fail("product_observation_invalid");
  }
  return candidate as unknown as RawPage;
}

function normalize(raw: RawPage, origin: string): ProductPageObservation {
  checkOrigin(raw.url, origin);
  const rawDetail = raw.detail;
  let detail: ProductDetailObservation | undefined;
  if (rawDetail) {
    const name = rawDetail.name.trim();
    if (!name) fail("product_detail_identity_missing");
    const controls: ProductDetailObservation["controls"] = {
      ...(control(rawDetail.close, "detail.close") ? { close: control(rawDetail.close, "detail.close")! } : {}),
      ...(control(rawDetail.add, "detail.add") ? { add: control(rawDetail.add, "detail.add")! } : {}),
      ...(control(rawDetail.update, "detail.update") ? { update: control(rawDetail.update, "detail.update")! } : {}),
      ...(control(rawDetail.remove, "detail.remove") ? { remove: control(rawDetail.remove, "detail.remove")! } : {}),
    };
    const root = control(rawDetail.quantityRoot, "detail.quantity.root");
    const text = control(rawDetail.quantityTextControl, "detail.quantity.text");
    if (root && text) {
      controls.quantity = {
        root,
        text,
        ...(control(rawDetail.quantityPlus, "detail.quantity.plus") ? { plus: control(rawDetail.quantityPlus, "detail.quantity.plus")! } : {}),
        ...(control(rawDetail.quantityMinus, "detail.quantity.minus") ? { minus: control(rawDetail.quantityMinus, "detail.quantity.minus")! } : {}),
      };
    }
    const groups = (rawDetail.groups ?? []).map((rawGroup) => {
      const label = rawGroup.title.trim();
      const groupRef = digest({ selector: rawGroup.selector, label });
      return {
        ref: groupRef,
        id: label,
        label,
        labelKnown: rawGroup.titleKnown && Boolean(label),
        required: rawGroup.required,
        min: rawGroup.min,
        max: rawGroup.max,
        mode: rawGroup.mode,
        choices: rawGroup.choices.map((rawChoice) => {
          const choiceLabel = rawChoice.label.trim();
          return {
            ref: digest({ groupRef, selector: rawChoice.control.selector, label: choiceLabel }),
            id: choiceLabel,
            label: choiceLabel,
            selected: rawChoice.selected,
            available: rawChoice.available,
            quantity: rawChoice.quantity,
            maxQuantity: rawChoice.maxQuantity,
            control: control(rawChoice.control, digest({ choice: choiceLabel, selector: rawChoice.control.selector }))!,
            ...(rawChoice.plus ? { plus: control(rawChoice.plus, digest({ choice: choiceLabel, plus: rawChoice.plus.selector }))! } : {}),
            ...(rawChoice.minus ? { minus: control(rawChoice.minus, digest({ choice: choiceLabel, minus: rawChoice.minus.selector }))! } : {}),
          };
        }),
      };
    });
    const quantityAmbiguous = Boolean(rawDetail.quantityAmbiguous);
    detail = {
      ref: digest({ name, selector: rawDetail.close?.selector, groups: groups.map((group) => group.ref) }),
      branchId: raw.branchId,
      name,
      pack: packOf(name),
      priceMinor: rawDetail.priceMinor ?? undefined,
      priceText: rawDetail.priceText,
      originalPriceText: rawDetail.originalPriceText,
      discountText: rawDetail.discountText,
      unitPriceMinor: rawDetail.unitPriceMinor ?? undefined,
      unitPriceText: rawDetail.unitPriceText,
      unitPriceBasis: unitBasis(rawDetail.unitPriceBasis),
      quantity: rawDetail.quantity,
      quantityText: rawDetail.quantityText,
      quantityControls: quantityAmbiguous ? "ambiguous" : rawDetail.quantityPlus || rawDetail.quantityMinus ? "available" : "absent",
      comment: rawDetail.comment
        ? {
          supported: true,
          text: rawDetail.comment.text,
          maxLength: rawDetail.comment.maxLength,
          ...(control(rawDetail.comment, "detail.comment") ? { input: control(rawDetail.comment, "detail.comment")! } : {}),
        }
        : { supported: false, text: "", maxLength: null },
      groups,
      options: groups.length > 0 ? "observed" : rawDetail.optionsPresent ? "unknown" : "none_observed",
      controls,
      signature: digest({ name, priceText: rawDetail.priceText, quantity: rawDetail.quantity, groups: groups.map((group) => ({ ref: group.ref, choices: group.choices.map((choice) => [choice.ref, choice.selected, choice.quantity]) })) }),
    };
  }
  const products = raw.products
    .filter((rawProduct) => typeof rawProduct.name === "string" && rawProduct.name.trim().length > 0)
    .slice(0, 100)
    .map((rawProduct) => {
      const name = rawProduct.name.trim();
      const cardRef = digest({ name, card: rawProduct.cardSelector, price: rawProduct.priceText });
      const clickSelector = typeof rawProduct.clickSelector === "string" && rawProduct.clickSelector !== rawProduct.cardSelector ? rawProduct.clickSelector : undefined;
      const signature = digest({ ref: cardRef, name, priceText: rawProduct.priceText, unitPriceText: rawProduct.unitPriceText });
      const open = clickSelector
        ? { ref: cardRef, selector: clickSelector, signature, enabled: true }
        : null;
      return {
        ref: cardRef,
        name,
        pack: rawProduct.pack?.trim() || packOf(name),
        priceMinor: rawProduct.priceMinor ?? undefined,
        priceText: rawProduct.priceText,
        originalPriceText: rawProduct.originalPriceText,
        discountText: rawProduct.discountText,
        unitPriceMinor: rawProduct.unitPriceMinor ?? undefined,
        unitPriceText: rawProduct.unitPriceText,
        unitPriceBasis: unitBasis(rawProduct.unitPriceBasis),
        ...(rawProduct.priceText ? { displayedPriceBasis: "per_pack" as const } : {}),
        cardSelector: rawProduct.cardSelector,
        open,
        ...(open ? {} : { openError: "card_click_target_missing" }),
        signature,
      };
    });
  const inStore = raw.search.inStore ? {
    ...control(raw.search.inStore, "search.in_store")!,
    value: raw.search.inStore.value,
  } : undefined;
  const global = raw.search.global ? {
    ...control(raw.search.global, "search.global")!,
    value: raw.search.global.value,
  } : undefined;
  const launcher = raw.search.launcher
    ? { ...control(raw.search.launcher, "search.launcher")!, label: raw.search.launcher.label }
    : undefined;
  const resultSignature = digest({
    empty: raw.search.empty,
    products: products.map((product) => [product.ref, product.priceText, product.unitPriceText]),
  });
  const productListSignature = digest({ active: raw.search.active, resultSignature });
  const page: ProductPageObservation = {
    url: raw.url,
    origin: new URL(raw.url).origin,
    branchId: raw.branchId,
    branchName: raw.branchName?.trim() || undefined,
    search: {
      ...(inStore ? { inStore } : {}),
      ...(global ? { global } : {}),
      inStoreCount: raw.search.inStoreCount,
      globalCount: raw.search.globalCount,
      inStoreAmbiguous: raw.search.inStoreCount > 1,
      ...(launcher ? { launcher } : {}),
      active: raw.search.active,
      results: raw.search.results,
      empty: raw.search.empty,
      resultQuery: raw.search.resultQuery,
    },
    products,
    productListSignature,
    resultSignature,
    ...(detail ? { detail } : {}),
    overlay: detail ? "product" : "none",
    issues: [...raw.issues],
    observationRef: "",
  };
  page.observationRef = digest({ url: page.url, search: page.search, products: page.products, detail: page.detail });
  return page;
}

export async function readProductObservation(
  transport: BoltDomTransport,
  options: ProductOperationOptions = {},
): Promise<ProductPageObservation> {
  options.guard?.();
  const url = await transport.url();
  checkOrigin(url, originOf(options));
  const raw = decodeRaw(await transport.evaluate(OBSERVATION_SCRIPT));
  return normalize(raw, originOf(options));
}

export async function readBranchProducts(
  transport: BoltDomTransport,
  options: ProductOperationOptions = {},
): Promise<ProductPageObservation> {
  return readProductObservation(transport, options);
}

export async function readProductDetail(
  transport: BoltDomTransport,
  expected?: Pick<ProductCardObservation, "name" | "priceMinor">,
  options: ProductOperationOptions = {},
): Promise<ProductDetailObservation> {
  const page = await readProductObservation(transport, options);
  const detail = page.detail;
  if (!detail) fail("product_detail_not_open");
  if (expected && !sameCardIdentity(detail.name, expected.name, detail.priceMinor, expected.priceMinor)) fail("product_identity_mismatch");
  if (expected?.priceMinor !== undefined && detail.priceMinor !== undefined && expected.priceMinor !== detail.priceMinor) {
    fail("product_price_changed");
  }
  return detail;
}

function pageTargets(page: ProductPageObservation): Map<string, ProductControl> {
  const targets = new Map<string, ProductControl>();
  if (page.search.inStore) targets.set(page.search.inStore.ref, page.search.inStore);
  if (page.search.global) targets.set(page.search.global.ref, page.search.global);
  if (page.search.launcher) targets.set(page.search.launcher.ref, page.search.launcher);
  for (const product of page.products) if (product.open) targets.set(product.ref, product.open);
  if (page.detail) {
    for (const [name, value] of Object.entries(page.detail.controls)) {
      if (name === "quantity" || value === undefined) continue;
      targets.set((value as ProductControl).ref, value as ProductControl);
    }
    if (page.detail.controls.quantity) {
      const quantity = page.detail.controls.quantity;
      targets.set(quantity.root.ref, quantity.root);
      targets.set(quantity.text.ref, quantity.text);
      if (quantity.plus) targets.set(quantity.plus.ref, quantity.plus);
      if (quantity.minus) targets.set(quantity.minus.ref, quantity.minus);
    }
    if (page.detail.comment.input) targets.set(page.detail.comment.input.ref, page.detail.comment.input);
    for (const group of page.detail.groups) {
      for (const choice of group.choices) {
        targets.set(choice.control.ref, choice.control);
        if (choice.plus) targets.set(choice.plus.ref, choice.plus);
        if (choice.minus) targets.set(choice.minus.ref, choice.minus);
      }
    }
  }
  return targets;
}

export async function executeProductPlan(
  transport: BoltDomTransport,
  plan: ProductPlan,
  options: ProductOperationOptions = {},
): Promise<ProductPageObservation> {
  if (plan.actions.length > 0 && !plan.identity) fail("product_identity_required");
  let page = await readProductObservation(transport, options);
  for (const action of plan.actions) {
    options.guard?.();
    page = await readProductObservation(transport, options);
    if (plan.identity?.branchId !== undefined && page.branchId !== plan.identity.branchId) fail("product_context_changed");
    if (plan.identity?.cardRef !== undefined && !page.products.some((product) => product.ref === plan.identity!.cardRef)) fail("product_context_changed");
    if (plan.identity?.noDetail && page.detail) fail("product_context_changed");
    if (plan.identity?.detailRef !== undefined || plan.identity?.productName !== undefined) {
      if (!page.detail || (plan.identity.detailRef !== undefined && page.detail.ref !== plan.identity.detailRef)) fail("product_context_changed");
      if (plan.identity.productName !== undefined && !sameCardIdentity(page.detail!.name, plan.identity.productName, page.detail!.priceMinor, undefined)) fail("product_context_changed");
    }
    const target = pageTargets(page).get(action.targetRef);
    if (!target) fail("product_target_missing");
    if (target.signature !== action.signature) fail("product_page_changed_before_action");
    if (!target.enabled) fail("product_control_disabled");
    options.guard?.();
    if (action.kind === "click") {
      await transport.click(target.selector);
    } else {
      await transport.fill(target.selector, action.value ?? "");
    }
  }
  return readProductObservation(transport, options);
}

function clickAction(control: ProductControl, purpose: string): ProductPlanAction {
  return { kind: "click", selector: control.selector, targetRef: control.ref, signature: control.signature, purpose };
}

function fillAction(control: ProductControl, value: string, purpose: string): ProductPlanAction {
  return { kind: "fill", selector: control.selector, value, targetRef: control.ref, signature: control.signature, purpose };
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  failure: string,
  options: ProductOperationOptions,
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let last: T | undefined;
  while (Date.now() < deadline) {
    options.guard?.();
    last = await read();
    if (predicate(last)) return last;
    await sleep(options.pollMs ?? DEFAULT_POLL_MS);
  }
  if (last && predicate(last)) return last;
  fail(failure);
}

export interface ProductSearchResult {
  status: "fresh";
  freshness: "results_changed";
  page: ProductPageObservation;
  plan: ProductPlan;
}

export async function searchBranchProducts(
  transport: BoltDomTransport,
  page: ProductPageObservation,
  query: string,
  options: ProductOperationOptions = {},
): Promise<ProductSearchResult> {
  const text = query.trim();
  if (!text || text.length > 200) fail("search_query_invalid");
  if (page.detail) fail("product_detail_open");
  let current = page;
  let plan: ProductPlan = { operation: "search", actions: [], identity: { ...(page.branchId ? { branchId: page.branchId } : {}), noDetail: true } };
  if (!current.search.inStore) {
    if (!current.search.launcher) fail("in_store_search_unavailable");
    const launcher = current.search.launcher;
    const identity = { ...(page.branchId ? { branchId: page.branchId } : {}), noDetail: true };
    plan = { operation: "search", actions: [clickAction(launcher, "open in-store search")], identity };
    await executeProductPlan(transport, plan, options);
    current = await waitFor(
      () => readProductObservation(transport, options),
      (next) => Boolean(next.search.inStore),
      "in_store_search_not_opened",
      options,
    );
  }
  if (current.search.inStoreAmbiguous || !current.search.inStore) fail("in_store_search_ambiguous");
  if (!current.search.inStore.enabled) fail("in_store_search_disabled");
  const input = current.search.inStore;
  const baseline = current.resultSignature;
  const identity = { ...(page.branchId ? { branchId: page.branchId } : {}), noDetail: true };
  const fillPlan: ProductPlan = { operation: "search", actions: [fillAction(input, text, "fill in-store search")], identity };
  await executeProductPlan(transport, fillPlan, options);
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let stable: { signature: string; active: boolean } | undefined;
  let changed = false;
  let sawInput = false;
  while (Date.now() < deadline) {
    options.guard?.();
    const next = await readProductObservation(transport, options);
    if (next.detail) fail("product_context_changed");
    const observedInput = next.search.inStore;
    if (observedInput?.value !== text) {
      stable = undefined;
      await sleep(options.pollMs ?? DEFAULT_POLL_MS);
      continue;
    }
    sawInput = true;
    if (!next.search.active) {
      stable = undefined;
      await sleep(options.pollMs ?? DEFAULT_POLL_MS);
      continue;
    }
    if (!next.search.empty && next.products.length === 0) {
      stable = undefined;
      await sleep(options.pollMs ?? DEFAULT_POLL_MS);
      continue;
    }
    if (next.resultSignature !== baseline) changed = true;
    if (changed && stable && stable.signature === next.resultSignature && stable.active === next.search.active) {
      return {
        status: "fresh",
        freshness: "results_changed",
        page: next,
        plan: { operation: "search", actions: [...plan.actions, ...fillPlan.actions], ...(identity ? { identity } : {}) },
      };
    }
    stable = { signature: next.resultSignature, active: next.search.active };
    await sleep(options.pollMs ?? DEFAULT_POLL_MS);
  }
  if (!sawInput) fail("search_input_not_applied");
  fail("search_results_not_confirmed");
}

export interface ProductOpenResult {
  status: "opened";
  card: ProductCardObservation;
  detail: ProductDetailObservation;
  page: ProductPageObservation;
  plan: ProductPlan;
}

export async function openProduct(
  transport: BoltDomTransport,
  page: ProductPageObservation,
  targetRef: string,
  options: ProductOperationOptions = {},
): Promise<ProductOpenResult> {
  if (page.detail) fail("product_already_open");
  const card = page.products.find((candidate) => candidate.ref === targetRef);
  if (!card) fail("product_target_not_found");
  if (!card.open) fail(card.openError ?? "card_click_target_missing");
  const identity = { ...(page.branchId ? { branchId: page.branchId } : {}), cardRef: card.ref, noDetail: true };
  const plan: ProductPlan = { operation: "open", actions: [clickAction(card.open, "open exact product card")], identity };
  await executeProductPlan(transport, plan, options);
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let detail: ProductDetailObservation | undefined;
  while (Date.now() < deadline) {
    options.guard?.();
    const next = await readProductObservation(transport, options);
    if (next.detail) {
      if (!sameCardIdentity(next.detail.name, card.name, next.detail.priceMinor, card.priceMinor)) fail("product_identity_mismatch");
      detail = next.detail;
      break;
    }
    await sleep(options.pollMs ?? DEFAULT_POLL_MS);
  }
  if (!detail) fail("product_detail_not_opened");
  if (card.priceMinor !== undefined && detail.priceMinor !== undefined && card.priceMinor !== detail.priceMinor) {
    fail("product_price_changed");
  }
  const finalPage = await readProductObservation(transport, options);
  return { status: "opened", card, detail, page: finalPage, plan };
}

function detailIdentity(detail: ProductDetailObservation): ProductPlanIdentity {
  return {
    ...(detail.branchId ? { branchId: detail.branchId } : {}),
    detailRef: detail.ref,
    productName: detail.name,
  };
}

export function planProductQuantity(detail: ProductDetailObservation, target: number): ProductPlan {
  if (!Number.isInteger(target) || target < 1 || target > 100) fail("product_quantity_invalid");
  if (detail.quantity === null) fail("product_quantity_unknown");
  if (detail.quantity === target) return { operation: "set_quantity", actions: [], identity: detailIdentity(detail) };
  if (detail.quantityControls === "ambiguous") fail("product_quantity_ambiguous");
  const step = target > detail.quantity ? "plus" : "minus";
  const controlToUse = detail.controls.quantity?.[step];
  if (!controlToUse) fail(step === "plus" ? "quantity_increase_control_missing" : "quantity_decrease_control_missing");
  if (!controlToUse.enabled) fail("quantity_control_disabled");
  return { operation: "set_quantity", actions: [clickAction(controlToUse, `${step} product quantity`)], identity: detailIdentity(detail) };
}

export async function setProductQuantity(
  transport: BoltDomTransport,
  detail: ProductDetailObservation,
  target: number,
  options: ProductOperationOptions = {},
): Promise<ProductDetailObservation> {
  if (!Number.isInteger(target) || target < 1 || target > 100) fail("product_quantity_invalid");
  let current = detail;
  let guardCount = 0;
  while (current.quantity !== target) {
    if (guardCount++ > 100) fail("product_quantity_not_confirmed");
    if (current.quantity === null) fail("product_quantity_unknown");
    const plan = planProductQuantity(current, target);
    if (plan.actions.length === 0) break;
    await executeProductPlan(transport, plan, options);
    const expected = current.quantity + (target > current.quantity ? 1 : -1);
    current = await waitFor(
      () => readProductDetail(transport, { name: current.name }, options),
      (next) => next.quantity === expected,
      "product_quantity_not_confirmed",
      options,
    );
  }
  if (current.quantity !== target) fail("product_quantity_not_confirmed");
  return current;
}

export function planProductOptions(
  detail: ProductDetailObservation,
  selections: ProductOptionsSelection[],
): ProductPlan {
  if (new Set(selections.map((selection) => selection.groupRef)).size !== selections.length) fail("duplicate_option_group");
  const actions: ProductPlanAction[] = [];
  for (const selection of selections) {
    const group = detail.groups.find((candidate) => candidate.ref === selection.groupRef);
    if (!group) fail("unknown_option_group");
    if (!group.labelKnown) fail("option_group_label_unknown");
    if (new Set(selection.choices.map((choice) => choice.choiceRef)).size !== selection.choices.length) fail("duplicate_option_choice");
    const wanted = new Map(selection.choices.map((choice) => [choice.choiceRef, choice.quantity]));
    for (const choiceRef of wanted.keys()) {
      if (!group.choices.some((choice) => choice.ref === choiceRef)) fail("unknown_option_choice");
    }
    if (group.mode === "unknown") fail("option_group_mode_unknown");
    const targets = group.choices.map((choice) => ({ choice, target: wanted.get(choice.ref) ?? 0 }));
    for (const { choice, target } of targets) {
      if (!Number.isInteger(target) || target < 0 || target > 100) fail("option_quantity_invalid");
      if (group.mode !== "quantity" && target !== 0 && target !== 1) fail("option_quantity_invalid");
      if (group.mode === "quantity" && choice.maxQuantity !== null && target > choice.maxQuantity) fail("option_quantity_exceeds_max");
      if (target > 0 && !choice.available) fail("choice_unavailable");
    }
    const targetCount = group.mode === "quantity"
      ? targets.reduce((total, { target }) => total + target, 0)
      : targets.filter(({ target }) => target > 0).length;
    if (group.mode === "single" && targetCount > 1) fail("option_single_choice_violation");
    if (group.min !== null && targetCount < group.min) fail("option_constraints_unsatisfied");
    if (group.max !== null && targetCount > group.max) fail("option_constraints_unsatisfied");
    if (group.required && targetCount === 0) fail("option_required_group_empty");
    if (group.mode === "single") {
      const selectedTarget = targets.find(({ target }) => target > 0);
      if (!selectedTarget) {
        if (group.choices.some((choice) => choice.selected === true)) fail("option_single_choice_clear_unsupported");
        continue;
      }
      if (selectedTarget.choice.selected === null) fail("option_selection_unknown");
      if (!selectedTarget.choice.selected) actions.push(clickAction(selectedTarget.choice.control, `select option ${selectedTarget.choice.label}`));
      continue;
    }
    for (const { choice, target } of targets) {
      if (group.mode === "quantity") {
        if (choice.quantity === null) fail("option_quantity_unknown");
        let steps = Math.abs(target - choice.quantity);
        const direction = target > choice.quantity ? "plus" : "minus";
        const control = direction === "plus" ? choice.plus : choice.minus;
        if (steps > 0 && (!control || !control.enabled)) fail("option_quantity_control_missing");
        while (steps-- > 0) actions.push(clickAction(control!, `set option ${choice.label} ${direction}`));
      } else {
        if (choice.selected === null) fail("option_selection_unknown");
        const shouldSelect = target > 0;
        if (choice.selected !== shouldSelect) actions.push(clickAction(choice.control, `${shouldSelect ? "select" : "clear"} option ${choice.label}`));
      }
    }
  }
  return { operation: "set_options", actions, identity: detailIdentity(detail) };
}

export async function setProductOptions(
  transport: BoltDomTransport,
  detail: ProductDetailObservation,
  selections: ProductOptionsSelection[],
  options: ProductOperationOptions = {},
): Promise<ProductDetailObservation> {
  const plan = planProductOptions(detail, selections);
  if (plan.actions.length > 0) await executeProductPlan(transport, plan, options);
  return waitFor(
    () => readProductDetail(transport, { name: detail.name }, options),
    (next) => optionStateMatches(next, selections),
    "option_selection_not_confirmed",
    options,
  );
}

function optionStateMatches(detail: ProductDetailObservation, selections: ProductOptionsSelection[]): boolean {
  for (const selection of selections) {
    const group = detail.groups.find((candidate) => candidate.ref === selection.groupRef);
    if (!group) return false;
    const wanted = new Map(selection.choices.map((choice) => [choice.choiceRef, choice.quantity]));
    for (const choice of group.choices) {
      const target = wanted.get(choice.ref) ?? 0;
      const current = group.mode === "quantity" ? choice.quantity : Number(choice.selected);
      if (current !== target && !(group.mode === "single" && target > 0 && current === 1)) return false;
    }
  }
  return true;
}

export async function setProductComment(
  transport: BoltDomTransport,
  detail: ProductDetailObservation,
  text: string,
  options: ProductOperationOptions = {},
): Promise<ProductDetailObservation> {
  if (text.length > 4000) fail("comment_too_long");
  if (!detail.comment.supported) {
    if (text.trim() === "") return detail;
    fail("item_comment_unsupported");
  }
  if (!detail.comment.input) fail("item_comment_input_missing");
  if (detail.comment.maxLength !== null && text.length > detail.comment.maxLength) fail("comment_length_invalid");
  const plan: ProductPlan = { operation: "set_comment", actions: [fillAction(detail.comment.input, text, "fill item comment")], identity: detailIdentity(detail) };
  await executeProductPlan(transport, plan, options);
  return waitFor(
    () => readProductDetail(transport, { name: detail.name }, options),
    (next) => next.comment.text === text,
    "item_comment_not_confirmed",
    options,
  );
}

export async function closeProduct(
  transport: BoltDomTransport,
  detail: ProductDetailObservation,
  options: ProductOperationOptions = {},
): Promise<ProductPageObservation> {
  if (!detail.controls.close) fail("product_close_control_missing");
  const plan: ProductPlan = { operation: "close", actions: [clickAction(detail.controls.close, "close product details")], identity: detailIdentity(detail) };
  await executeProductPlan(transport, plan, options);
  return waitFor(
    () => readProductObservation(transport, options),
    (next) => !next.detail,
    "product_close_not_confirmed",
    options,
  );
}

export function findProduct(
  page: ProductPageObservation,
  expected: { name: string; pack?: string; priceMinor?: number },
): ProductCardObservation {
  const matches = page.products.filter((product) => sameName(product.name, expected.name)
    && (expected.pack === undefined || product.pack === expected.pack)
    && (expected.priceMinor === undefined || product.priceMinor === expected.priceMinor));
  if (matches.length === 0) fail("product_not_found");
  if (matches.length > 1) fail("product_ambiguous");
  return matches[0]!;
}

export const PRODUCT_ACTIONS = [
  "search_branch",
  "open_product",
  "read_item_options",
  "set_item_options",
  "set_product_quantity",
  "read_item_comment",
  "set_item_comment",
  "close_product",
] as const;

export type ProductActionName = (typeof PRODUCT_ACTIONS)[number];

export interface ProductActionInput {
  action: ProductActionName;
  observationRef?: string;
  targetRef?: string;
  query?: string;
  quantity?: number;
  expectedQuantity?: number;
  text?: string;
  selections?: ProductOptionsSelection[];
}

export interface ProductActionResult {
  status: "observed" | "verified";
  action: ProductActionName;
  observationRef: string;
  branchId?: string;
  detail?: ProductDetailObservation;
  page?: ProductPageObservation;
  freshness?: ProductSearchResult["freshness"];
}

function requireObservation(page: ProductPageObservation, ref: string | undefined): void {
  if (ref !== undefined && page.observationRef !== ref) fail("stale_observation");
}

export async function runProductAction(
  transport: BoltDomTransport,
  input: ProductActionInput,
  options: ProductOperationOptions = {},
): Promise<ProductActionResult> {
  if (input.action === "search_branch") {
    const page = await readBranchProducts(transport, options);
    requireObservation(page, input.observationRef);
    if (input.query === undefined) fail("search_query_invalid");
    const searched = await searchBranchProducts(transport, page, input.query, options);
    return {
      status: "verified",
      action: input.action,
      observationRef: searched.page.observationRef,
      branchId: searched.page.branchId,
      page: searched.page,
      freshness: searched.freshness,
    };
  }
  if (input.action === "open_product") {
    const page = await readBranchProducts(transport, options);
    requireObservation(page, input.observationRef);
    if (!input.targetRef) fail("product_target_required");
    const opened = await openProduct(transport, page, input.targetRef, options);
    return { status: "verified", action: input.action, observationRef: opened.page.observationRef, branchId: opened.page.branchId, page: opened.page, detail: opened.detail };
  }
  const page = await readProductObservation(transport, options);
  requireObservation(page, input.observationRef);
  const detail = page.detail;
  if (!detail) fail("product_detail_not_open");
  if (input.action === "read_item_options") {
    return { status: "observed", action: input.action, observationRef: page.observationRef, branchId: page.branchId, detail };
  }
  if (input.action === "read_item_comment") {
    return { status: "observed", action: input.action, observationRef: page.observationRef, branchId: page.branchId, detail };
  }
  if (input.action === "set_product_quantity") {
    if (input.expectedQuantity !== undefined && detail.quantity !== input.expectedQuantity) fail("quantity_precondition_failed");
    if (input.quantity === undefined) fail("product_quantity_invalid");
    await setProductQuantity(transport, detail, input.quantity, options);
    const final = await readProductObservation(transport, options);
    return { status: "verified", action: input.action, observationRef: final.observationRef, branchId: final.branchId, detail: final.detail };
  }
  if (input.action === "set_item_options") {
    if (!input.selections) fail("item_options_and_selections_required");
    await setProductOptions(transport, detail, input.selections, options);
    const final = await readProductObservation(transport, options);
    return { status: "verified", action: input.action, observationRef: final.observationRef, branchId: final.branchId, detail: final.detail };
  }
  if (input.action === "set_item_comment") {
    if (input.text === undefined) fail("item_comment_text_required");
    await setProductComment(transport, detail, input.text, options);
    const final = await readProductObservation(transport, options);
    return { status: "verified", action: input.action, observationRef: final.observationRef, branchId: final.branchId, detail: final.detail };
  }
  if (input.action === "close_product") {
    const closed = await closeProduct(transport, detail, options);
    return { status: "verified", action: input.action, observationRef: closed.observationRef, branchId: closed.branchId, page: closed };
  }
  fail("unsupported_product_action");
}
