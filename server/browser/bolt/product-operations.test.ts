import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import type { BoltDomTransport } from "./browser.ts";
import {
  PRODUCT_DOM_EVIDENCE,
  closeProduct,
  executeProductPlan,
  findProduct,
  openProduct,
  planProductOptions,
  planProductQuantity,
  readBranchProducts,
  readProductDetail,
  runProductAction,
  searchBranchProducts,
  setProductComment,
  setProductOptions,
  setProductQuantity,
} from "./product-operations.ts";

const ORIGIN = "https://food.bolt.eu";
const URL = `${ORIGIN}/en/1-tallinn/p/28032-bolt-market-toompuiestee/`;

interface Dish {
  key: string;
  name: string;
  price: string;
  priceMinor: number;
  unit?: string;
  unitMinor?: number;
  pack: string;
}

const dishes: Dish[] = [
  {
    key: "soup",
    name: "Presto, Organic Pumpkin Puree Soup with Coconut Milk, 300g",
    price: "3,29 €",
    priceMinor: 329,
    unit: "10,97 €/kg",
    unitMinor: 1097,
    pack: "300g",
  },
  {
    key: "jam",
    name: "Meie Mari, Raspberry Jam, 310g",
    price: "3,02 €",
    priceMinor: 302,
    unit: "9,74 €/kg",
    unitMinor: 974,
    pack: "310g",
  },
];

type ElementLike = {
  getAttribute(name: string): string | null;
  closest(selector: string): ElementLike | null;
  parentElement: ElementLike | null;
  querySelector(selector: string): ElementLike | null;
  addEventListener(type: string, listener: (event: { target: unknown }) => void): void;
  insertAdjacentHTML(position: "beforeend", html: string): void;
  dispatchEvent(event: unknown): boolean;
  value: string;
  textContent: string | null;
  disabled: boolean;
  style: { display: string };
};

function cardHtml(dish: Dish): string {
  return `<button data-testid="components.GridMenuDishBase.view" aria-label=", ${dish.name}, ${dish.price}" data-dish="${dish.key}">
    <div data-testid="components.GridMenuDishBase.button" tabindex="0">
      <div data-testid="components.GridMenuDishBase.title">${dish.name}</div>
      <div data-testid="components.GridMenuDishBase.price">${dish.price}</div>
      ${dish.unit ? `<div data-testid="components.GridMenuDishBase.unitPrice">${dish.unit}</div>` : ""}
    </div>
  </button>`;
}

function detailHtml(dish: Dish, options: boolean): string {
  return `<div class="dish-detail" data-detail="${dish.key}" style="display:none">
    <div data-testid="screens.Provider.Dish.DishBottomSheet.closeButton"></div>
    <div data-testid="components.ProviderDish.dishName">${dish.name}</div>
    <div>${dish.price}</div>
    ${dish.unit ? `<div data-testid="components.ProviderDish.additionalPriceInfo">${dish.unit}</div>` : ""}
    <div data-testid="components.ProviderDish.dishCounter">
      <button data-testid="components.ProviderDish.dishCounter.minus" aria-label="Decrease quantity" disabled>−</button>
      <span data-testid="components.ProviderDish.dishCounter.text">1</span>
      <button data-testid="components.ProviderDish.dishCounter.plus" aria-label="Increase quantity">+</button>
    </div>
    <button data-testid="components.ProviderDish.addButton">
      <span data-testid="components.ProviderDish.dishCounter">
        <button data-testid="components.ProviderDish.dishCounter.minus" disabled>−</button>
        <span data-testid="components.ProviderDish.dishCounter.text">1</span>
        <button data-testid="components.ProviderDish.dishCounter.plus" disabled>+</button>
      </span>
      Add ${dish.price}
    </button>
    ${options ? `<div data-testid="components.ProviderDish.optionsContainer">
      <div data-testid="components.CheckboxGroup.view">
        <div data-testid="components.CheckboxGroup.title">Size</div>
        <label data-testid="components.CheckboxGroup.itemRow.Small"><input data-testid="components.CheckboxGroup.itemRadio" type="radio" name="size-${dish.key}" aria-label="Small" checked>Small</label>
        <label data-testid="components.CheckboxGroup.itemRow.Large"><input data-testid="components.CheckboxGroup.itemRadio" type="radio" name="size-${dish.key}" aria-label="Large">Large</label>
      </div>
      <div data-testid="components.CheckboxGroup.view">
        <div data-testid="components.CheckboxGroup.title">Extras</div>
        <label data-testid="components.CheckboxGroup.itemRow.Cheese"><input data-testid="components.CheckboxGroup.itemCheckbox" type="checkbox" aria-label="Cheese">Cheese</label>
        <label data-testid="components.CheckboxGroup.itemRow.Basil"><input data-testid="components.CheckboxGroup.itemCheckbox" type="checkbox" aria-label="Basil">Basil</label>
      </div>
    </div>
    <textarea data-testid="components.ProviderDish.dishComment" maxlength="200" aria-label="Item comment"></textarea>` : ""}
  </div>`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixture(options: { options?: boolean; staleSearch?: boolean; urlOnlySearch?: boolean; manualSearch?: boolean; modalSearch?: boolean } = {}) {
  const window = new Window({ url: URL });
  window.document.body.innerHTML = `
    <h1>Bolt Market Toompuiestee</h1>
    <button aria-label="Delivery address Uus-Volta 6/1, Tallinn"></button>
    <input data-testid="screens.Search.searchInput.blurred" value="">
    <input data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input" value="">
    <button data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.cancelButton" style="display:none">Cancel</button>
    <button data-testid="components.ProviderStickyTitleHeader.searchButton">Search for food, restaurants, stores</button>
    <section id="cards">${dishes.map(cardHtml).join("")}</section>
    ${dishes.map((dish) => detailHtml(dish, options.options === true && dish.key === "soup")).join("")}`;
  const clicks: string[] = [];
  const fills: Array<{ selector: string; value: string }> = [];
  const renderCards = (matches: Dish[]) => {
    window.document.querySelector("#cards")!.innerHTML = matches.map(cardHtml).join("");
  };
  window.document.querySelector("#cards")!.addEventListener("click", (event) => {
    const target = event.target as unknown as ElementLike;
    const button = target.closest('[data-testid="components.GridMenuDishBase.button"]');
    if (!button) return;
    const card = button.closest('[data-dish]');
    const key = card?.getAttribute("data-dish");
    for (const detail of window.document.querySelectorAll(".dish-detail")) {
      (detail as unknown as { style: { display: string } }).style.display = detail.getAttribute("data-detail") === key ? "block" : "none";
    }
  });
  window.document.querySelectorAll(".dish-detail").forEach((detail) => {
    detail.addEventListener("click", (event) => {
      const target = event.target as unknown as ElementLike;
      if (target.getAttribute("data-testid")?.endsWith("DishBottomSheet.closeButton")) {
        (detail as unknown as { style: { display: string } }).style.display = "none";
      }
      if (target.getAttribute("data-testid") === "components.ProviderDish.dishCounter.plus") {
        const counter = target.parentElement as unknown as { querySelector(selector: string): ElementLike };
        const text = counter.querySelector('[data-testid="components.ProviderDish.dishCounter.text"]');
        const minus = counter.querySelector('[data-testid="components.ProviderDish.dishCounter.minus"]')!;
        text.textContent = String(Number(text.textContent) + 1);
        minus.disabled = Number(text.textContent) <= 1;
      }
      if (target.getAttribute("data-testid") === "components.ProviderDish.dishCounter.minus") {
        const counter = target.parentElement as unknown as { querySelector(selector: string): ElementLike };
        const text = counter.querySelector('[data-testid="components.ProviderDish.dishCounter.text"]');
        const plus = counter.querySelector('[data-testid="components.ProviderDish.dishCounter.plus"]')!;
        text.textContent = String(Math.max(1, Number(text.textContent) - 1));
        plus.disabled = false;
      }
    });
  });
  const inStore = window.document.querySelector('[data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input"]')!;
  const cancel = window.document.querySelector('[data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.cancelButton"]') as unknown as { style: { display: string } };
  let pendingQuery: string | undefined;
  const renderQuery = (value: string) => renderCards(dishes.filter((dish) => dish.name.toLowerCase().includes(value.toLowerCase())));
  inStore.addEventListener("input", () => {
    const value = (inStore as unknown as { value: string }).value;
    if (options.staleSearch) return;
    if (options.urlOnlySearch) {
      cancel.style.display = "inline";
      window.history.replaceState({}, "", `${window.location.pathname}?query=${encodeURIComponent(value)}`);
      return;
    }
    cancel.style.display = "inline";
    if (options.manualSearch) { pendingQuery = value; return; }
    if (options.modalSearch) window.history.replaceState({}, "", `/MenuSearchModal/?providerId=28032&screen=menu&autoFocus=true&locale=en`);
    window.setTimeout(() => renderQuery(value), 35);
  });
  const releaseSearch = () => { if (pendingQuery !== undefined) renderQuery(pendingQuery); };
  const transport: BoltDomTransport = {
    url: () => window.location.href,
    evaluate: async (script) => window.eval(script),
    click: async (selector) => {
      clicks.push(selector);
      const element = window.document.querySelector(selector) as unknown as { click(): void } | null;
      if (!element) throw new Error(`missing ${selector}`);
      element.click();
    },
    fill: async (selector, value) => {
      fills.push({ selector, value });
      const element = window.document.querySelector(selector) as unknown as ElementLike | null;
      if (!element) throw new Error(`missing ${selector}`);
      element.value = value;
      element.dispatchEvent(new window.Event("input", { bubbles: true }));
    },
    navigate: async (target) => { window.history.replaceState({}, "", target.replace(ORIGIN, "")); },
  };
  return { window, transport, clicks, fills, renderCards, releaseSearch };
}

describe("atomic Bolt product operations on a source-derived disposable DOM", () => {
  it("reads two visible search inputs and product cards without requiring item or checkout state", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    expect(page.branchId).toBe("28032");
    expect(page.branchName).toBe("Bolt Market Toompuiestee");
    expect(page.search.inStoreCount).toBe(1);
    expect(page.search.globalCount).toBe(1);
    expect(f.window.document.querySelector(page.search.inStore!.selector)?.getAttribute("data-testid")).toBe("screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input");
    expect(page.detail).toBeUndefined();
    expect(page.issues).toEqual([]);
    expect(page.products).toHaveLength(2);
    const jam = findProduct(page, { name: "Meie Mari, Raspberry Jam, 310g", pack: "310g", priceMinor: 302 });
    expect(jam).toMatchObject({
      name: "Meie Mari, Raspberry Jam, 310g",
      pack: "310g",
      priceMinor: 302,
      unitPriceMinor: 974,
      unitPriceBasis: "per_kg",
      displayedPriceBasis: "per_pack",
    });
    expect(f.window.document.querySelector(jam.open!.selector)?.getAttribute("data-testid")).toBe("components.GridMenuDishBase.button");
    expect(jam.open?.selector).not.toBe(jam.cardSelector);
  });

  it("searches the in-store input and waits for changed, stable results", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    const result = await searchBranchProducts(f.transport, page, "pumpkin", { timeoutMs: 2_000, pollMs: 20 });
    expect(result.status).toBe("fresh");
    expect(result.page.branchId).toBe("28032");
    expect(result.freshness).toBe("results_changed");
    expect(result.page.products.map((product) => product.name)).toEqual([dishes[0]!.name]);
    expect(f.fills).toHaveLength(1);
    expect(f.window.document.querySelector(f.fills[0]!.selector)?.getAttribute("data-testid")).toBe("screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input");
    expect(f.fills[0]!.value).toBe("pumpkin");
  });

  it("keeps branch identity across the in-store MenuSearchModal route", async () => {
    const f = fixture({ modalSearch: true });
    const page = await readBranchProducts(f.transport);
    const result = await searchBranchProducts(f.transport, page, "pumpkin", { timeoutMs: 2_000, pollMs: 20 });
    expect(f.window.location.pathname).toContain("/MenuSearchModal/");
    expect(result.page.branchId).toBe("28032");
    expect(result.page.products.map((product) => product.name)).toEqual([dishes[0]!.name]);
  });

  it("does not claim fresh results when only the input changed", async () => {
    const f = fixture({ staleSearch: true });
    const page = await readBranchProducts(f.transport);
    await expect(searchBranchProducts(f.transport, page, "pumpkin", { timeoutMs: 250, pollMs: 20 })).rejects.toThrow("search_results_not_confirmed");
  });

  it("opens the exact known grocery through the real card child and reads name/pack/price/quantity", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    const jam = findProduct(page, { name: "Meie Mari, Raspberry Jam, 310g", pack: "310g", priceMinor: 302 });
    const opened = await openProduct(f.transport, page, jam.ref, { timeoutMs: 1_000, pollMs: 20 });
    expect(f.clicks[0]).toBe(jam.open!.selector);
    expect(opened.detail).toMatchObject({
      name: "Meie Mari, Raspberry Jam, 310g",
      pack: "310g",
      priceMinor: 302,
      quantity: 1,
      quantityControls: "available",
      options: "none_observed",
    });
    expect(opened.detail.comment.supported).toBe(false);
    expect(opened.detail.groups).toEqual([]);
    expect(opened.page.overlay).toBe("product");
  });

  it("sets quantity through observed plus/minus controls, then closes without requiring options or comments", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    const jam = findProduct(page, { name: "Meie Mari, Raspberry Jam, 310g", pack: "310g", priceMinor: 302 });
    let detail = (await openProduct(f.transport, page, jam.ref, { timeoutMs: 1_000, pollMs: 20 })).detail;
    expect(planProductQuantity(detail, 3).actions).toHaveLength(1);
    detail = await setProductQuantity(f.transport, detail, 3, { timeoutMs: 1_000, pollMs: 20 });
    expect(detail.quantity).toBe(3);
    const clickedTestIds = f.clicks.map((selector) => f.window.document.querySelector(selector)?.getAttribute("data-testid"));
    expect(clickedTestIds.filter((testId) => testId === "components.ProviderDish.dishCounter.plus")).toHaveLength(2);
    await expect(setProductComment(f.transport, detail, "No substitutions", { timeoutMs: 200, pollMs: 20 })).rejects.toThrow("item_comment_unsupported");
    expect((await setProductOptions(f.transport, detail, [], { timeoutMs: 500, pollMs: 20 })).groups).toEqual([]);
    const closed = await closeProduct(f.transport, detail, { timeoutMs: 1_000, pollMs: 20 });
    expect(closed.detail).toBeUndefined();
    expect(closed.products).toHaveLength(2);
  });

  it("reads option groups and item comments when the dish exposes them, and mutates only those observed controls", async () => {
    const f = fixture({ options: true });
    const page = await readBranchProducts(f.transport);
    const soup = findProduct(page, { name: dishes[0]!.name, pack: "300g", priceMinor: 329 });
    let detail = (await openProduct(f.transport, page, soup.ref, { timeoutMs: 1_000, pollMs: 20 })).detail;
    expect(detail.groups).toHaveLength(2);
    expect(detail.groups[0]).toMatchObject({ label: "Size", mode: "single" });
    expect(detail.groups[0]!.choices.map((choice) => [choice.label, choice.selected])).toEqual([["Small", true], ["Large", false]]);
    expect(detail.comment.supported).toBe(true);
    expect(detail.comment.maxLength).toBe(200);
    const size = detail.groups[0]!;
    const large = size.choices.find((choice) => choice.label === "Large")!;
    const beforeSelect = f.clicks.length;
    detail = await setProductOptions(f.transport, detail, [{ groupRef: size.ref, choices: [{ choiceRef: large.ref, quantity: 1 }] }], { timeoutMs: 1_000, pollMs: 20 });
    expect(detail.groups[0]!.choices.map((choice) => choice.selected)).toEqual([false, true]);
    expect(f.clicks).toHaveLength(beforeSelect + 1);
    detail = await setProductComment(f.transport, detail, "Please pack upright", { timeoutMs: 1_000, pollMs: 20 });
    expect(detail.comment.text).toBe("Please pack upright");
  });

  it("refuses to open a target without a unique real card click child", async () => {
    const f = fixture();
    f.window.document.querySelector('[data-dish="jam"] [data-testid="components.GridMenuDishBase.button"]')!.remove();
    const page = await readBranchProducts(f.transport);
    const jam = page.products.find((product) => product.name.includes("Raspberry Jam"))!;
    expect(jam.open).toBeNull();
    await expect(openProduct(f.transport, page, jam.ref, { timeoutMs: 100, pollMs: 20 })).rejects.toThrow("card_click_target_missing");
    expect(f.clicks).toEqual([]);
  });

  it("executes an explicit plan through the same native click/fill transport", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    const jam = findProduct(page, { name: "Meie Mari, Raspberry Jam, 310g", pack: "310g", priceMinor: 302 });
    expect(jam.open).not.toBeNull();
    await executeProductPlan(f.transport, { operation: "open", identity: { branchId: page.branchId, cardRef: jam.ref, noDetail: true }, actions: [{ kind: "click", selector: jam.open!.selector, targetRef: jam.ref, signature: jam.signature, purpose: "open" }] });
    expect(f.clicks).toHaveLength(1);
    const detail = await readProductDetail(f.transport, { name: jam.name, priceMinor: jam.priceMinor });
    expect(detail.name).toBe(jam.name);
  });

  it("refuses a stale plan before any effect when the same DOM path now shows another product", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    const soup = findProduct(page, { name: dishes[0]!.name, pack: "300g", priceMinor: 329 });
    let detail = (await openProduct(f.transport, page, soup.ref, { timeoutMs: 1_000, pollMs: 20 })).detail;
    const plan = planProductQuantity(detail, 2);
    const before = f.clicks.length;
    const name = f.window.document.querySelector(`[data-detail="soup"] [data-testid="components.ProviderDish.dishName"]`)!;
    name.textContent = dishes[1]!.name;
    await expect(executeProductPlan(f.transport, plan, { timeoutMs: 500, pollMs: 20 })).rejects.toThrow("product_context_changed");
    expect(f.clicks).toHaveLength(before);
  });

  it("refuses a duplicated visible quantity control instead of acting on the first match", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    const jam = findProduct(page, { name: dishes[1]!.name, pack: "310g", priceMinor: 302 });
    let detail = (await openProduct(f.transport, page, jam.ref, { timeoutMs: 1_000, pollMs: 20 })).detail;
    const plus = f.window.document.querySelector(`[data-detail="jam"] [data-testid="components.ProviderDish.dishCounter.plus"]`)!;
    plus.parentElement!.insertAdjacentHTML("beforeend", '<button data-testid="components.ProviderDish.dishCounter.plus">+</button>');
    detail = await readProductDetail(f.transport, { name: jam.name }, { timeoutMs: 500, pollMs: 20 });
    const before = f.clicks.length;
    await expect(setProductQuantity(f.transport, detail, 2, { timeoutMs: 500, pollMs: 20 })).rejects.toThrow("quantity_increase_control_missing");
    expect(f.clicks).toHaveLength(before);
  });

  it("dispatches freshly resolved target selectors rather than the stale selector carried by a plan", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    const jam = findProduct(page, { name: dishes[1]!.name, pack: "310g", priceMinor: 302 });
    const plan = {
      operation: "open" as const,
      identity: { branchId: page.branchId, cardRef: jam.ref },
      actions: [{ kind: "click" as const, selector: "body", targetRef: jam.ref, signature: jam.signature, purpose: "open" }],
    };
    await executeProductPlan(f.transport, plan, { timeoutMs: 500, pollMs: 20 });
    expect(f.clicks).toEqual([jam.open!.selector]);
  });

  it("rejects unknown option choices, non-boolean checkbox quantities, known maxima and group constraints before effects", async () => {
    const f = fixture({ options: true });
    const page = await readBranchProducts(f.transport);
    const soup = findProduct(page, { name: dishes[0]!.name, pack: "300g", priceMinor: 329 });
    const detail = (await openProduct(f.transport, page, soup.ref, { timeoutMs: 1_000, pollMs: 20 })).detail;
    const size = detail.groups[0]!;
    const extras = detail.groups[1]!;
    const before = f.clicks.length;
    expect(() => planProductOptions(detail, [{ groupRef: size.ref, choices: [{ choiceRef: "invented", quantity: 1 }] }])).toThrow("unknown_option_choice");
    expect(() => planProductOptions(detail, [{ groupRef: extras.ref, choices: [{ choiceRef: extras.choices[0]!.ref, quantity: 2 }] }])).toThrow("option_quantity_invalid");
    extras.mode = "quantity";
    extras.choices[0]!.quantity = 0;
    extras.choices[0]!.maxQuantity = 1;
    expect(() => planProductOptions(detail, [{ groupRef: extras.ref, choices: [{ choiceRef: extras.choices[0]!.ref, quantity: 2 }] }])).toThrow("option_quantity_exceeds_max");
    extras.mode = "multiple";
    extras.min = 2;
    extras.max = 2;
    extras.required = false;
    expect(() => planProductOptions(detail, [{ groupRef: extras.ref, choices: [{ choiceRef: extras.choices[0]!.ref, quantity: 1 }] }])).toThrow("option_constraints_unsatisfied");
    extras.min = null;
    extras.max = null;
    extras.required = true;
    expect(() => planProductOptions(detail, [{ groupRef: extras.ref, choices: [] }])).toThrow("option_required_group_empty");
    extras.required = false;
    expect(() => planProductOptions(detail, [{ groupRef: size.ref, choices: [] }])).toThrow("option_single_choice_clear_unsupported");
    expect(f.clicks).toHaveLength(before);
  });

  it("does not treat a changed URL query as fresh results while old cards remain", async () => {
    const f = fixture({ urlOnlySearch: true });
    const page = await readBranchProducts(f.transport);
    await expect(searchBranchProducts(f.transport, page, "pumpkin", { timeoutMs: 250, pollMs: 20 })).rejects.toThrow("search_results_not_confirmed");
  });

  it("does not resolve a search until the visible results actually change", async () => {
    const f = fixture({ manualSearch: true });
    const page = await readBranchProducts(f.transport);
    let settled = false;
    const promise = searchBranchProducts(f.transport, page, "pumpkin", { timeoutMs: 1_000, pollMs: 10 }).then((result) => { settled = true; return result; });
    await wait(80);
    expect(settled).toBe(false);
    f.releaseSearch();
    const result = await promise;
    expect(result.page.products.map((product) => product.name)).toEqual([dishes[0]!.name]);
  });

  it("exposes one adapter-facing atomic operation surface with observation refs", async () => {
    const f = fixture();
    const page = await readBranchProducts(f.transport);
    const jam = findProduct(page, { name: dishes[1]!.name, pack: "310g", priceMinor: 302 });
    const opened = await runProductAction(f.transport, { action: "open_product", observationRef: page.observationRef, targetRef: jam.ref }, { timeoutMs: 1_000, pollMs: 20 });
    expect(opened.status).toBe("verified");
    expect(opened.detail?.name).toBe(jam.name);
    const quantity = await runProductAction(f.transport, { action: "set_product_quantity", observationRef: opened.observationRef, quantity: 2, expectedQuantity: 1 }, { timeoutMs: 1_000, pollMs: 20 });
    expect(quantity.detail?.quantity).toBe(2);
    const closed = await runProductAction(f.transport, { action: "close_product", observationRef: quantity.observationRef }, { timeoutMs: 1_000, pollMs: 20 });
    expect(closed.status).toBe("verified");
    expect(closed.page?.detail).toBeUndefined();
  });

  it("retains the exact public bundle provenance used for DOM facts", () => {
    expect(PRODUCT_DOM_EVIDENCE.sha256).toBe("df909f20f08346d8f1345e5dd65c645b06e7225a65862ab6205a58e0965c5965");
    expect(PRODUCT_DOM_EVIDENCE.components).toContain("ProviderDish.dishCounter.plus");
    expect(PRODUCT_DOM_EVIDENCE.components).toContain("GridMenuDishBase.button");
  });
});
