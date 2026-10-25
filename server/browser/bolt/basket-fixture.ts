import { Window } from "happy-dom";
import type { BoltBasketTransport } from "./basket-operations.ts";

/**
 * Recorded Bolt Food checkout row shape, 16/23 October 2026: accessible
 * `Name. Amount: N. Price: X €.` rows, counter test ids `.minus`/`.text`, and
 * `components.ProviderDish.addButton` changing from Add to Update after one add.
 * The public web bundle renders `total_price` in `Price:` and derives `.plus`
 * via getCounterTestIDs; the fixture therefore uses extended line totals and
 * also exercises structural discovery when the plus id is absent.
 */
export const BASKET_FIXTURE_EVIDENCE = {
  e03: "9ec0fcb1-9c17-4501-b5ad-969cfefb4cf6",
  e04: ["2d86f13d-e8c6-41d8-b13c-4690bf5f72e7", "024893db-c1c5-4665-ae32-5f886ce3120d"],
  e05: ["ae2174ea-3946-423e-84ee-bd31c5757aaf", "4d1f019d-162c-4724-acf4-d58beaa284b7", "ec51c944-2084-4707-983b-e1487c22512c"],
  e08: "8184163c-f71d-415d-8eb1-68134d2b461d",
  bundle: "https://food.bolt.eu/_expo/static/js/web/index-6c9f5a6981b9e8534582dd15d4cf5e0b.js",
} as const;

export interface FixtureLine {
  key: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor?: number;
  selectedOptions?: string;
  comment?: string;
}

export interface FixtureOptions {
  start?: "menu" | "checkout";
  lines?: FixtureLine[];
  plusTestId?: boolean;
  plusAmbiguous?: boolean;
  duplicateCommentLine?: boolean;
  ignoreAdd?: boolean;
  ignorePlus?: boolean;
  ignoreMinus?: boolean;
  noControlPrice?: boolean;
  mysteryProduct?: boolean;
  malformedRow?: boolean;
  zeroQuantityRow?: boolean;
  minusDisabledAtOne?: boolean;
  addQuantity?: number;
  hideEmptyBasketEntry?: boolean;
  hideBasketEntry?: boolean;
}

const money = (minor: number): string => `${(minor / 100).toFixed(2).replace(".", ",")} €`;

const DEFAULT_LINES: FixtureLine[] = [
  { key: "yogurt", name: "Tere, Kreeka jogurt maitsestamata, 350 g", quantity: 2, unitPriceMinor: 176 },
  { key: "yogurt-comment", name: "Tere, Kreeka jogurt maitsestamata, 350 g", quantity: 1, unitPriceMinor: 176, comment: "lactose free" },
  { key: "soup", name: "Selveri Köök, Kana-nuudlisupp, 400 g", quantity: 1, unitPriceMinor: 314 },
];

const PADS: FixtureLine = { key: "pads", name: "Selver, Vatipadjad, ümmargused, 80 tk", quantity: 0, unitPriceMinor: 167 };

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lineTotal(line: FixtureLine): number {
  return line.lineTotalMinor ?? line.unitPriceMinor * line.quantity;
}

function label(line: FixtureLine): string {
  const options = line.selectedOptions ? ` Selected options: ${line.selectedOptions}.` : "";
  const comment = line.comment ? ` Comment: ${line.comment}.` : "";
  return `${line.name}. Amount: ${line.quantity}. Price: ${money(lineTotal(line))}.${options}${comment}`;
}

interface ClickTarget {
  closest(selector: string): ClickTarget | null;
  getAttribute(name: string): string | null;
}

export class BasketFixture {
  readonly window: Window;
  readonly transport: BoltBasketTransport;
  readonly options: FixtureOptions;
  lines: FixtureLine[];
  page: "menu" | "checkout";
  clicks: Array<{ selector: string; testId: string | null; action: string | null }> = [];
  addClicks = 0;
  plusClicks = 0;
  minusClicks = 0;
  basketMainClicks = 0;
  basketGroceryClicks = 0;
  basketStickyClicks = 0;

  constructor(options: FixtureOptions = {}) {
    this.options = options;
    this.lines = structuredClone(options.lines ?? DEFAULT_LINES);
    if (options.duplicateCommentLine) {
      const source = this.lines.find((line) => line.comment) ?? this.lines[0];
      this.lines.push({ ...source, key: `${source.key}-duplicate` });
    }
    this.page = options.start ?? "checkout";
    this.window = new Window({ url: this.url() });
    this.transport = {
      url: () => this.window.location.href,
      evaluate: async (script) => this.window.eval(script),
      click: async (selector) => {
        const element = this.window.document.querySelector(selector);
        if (!element) throw new Error(`missing fixture selector ${selector}`);
        this.clicks.push({ selector, testId: element.getAttribute("data-testid"), action: element.getAttribute("data-action") });
        (element as unknown as { click(): void }).click();
      },
    };
    this.window.document.addEventListener("click", (event) => this.handle(event));
    this.render();
  }

  private url(): string {
    return this.page === "checkout"
      ? "https://food.bolt.eu/en/1-tallinn/checkout/200420/?source=menu_screen"
      : "https://food.bolt.eu/en/1-tallinn/p/200420-selver-pelgulinna/";
  }

  showMenu(): void {
    this.page = "menu";
    this.render();
  }

  showCheckout(): void {
    this.page = "checkout";
    this.render();
  }

  total(): number {
    return this.lines.filter((line) => line.quantity > 0).reduce((sum, line) => sum + lineTotal(line), 0);
  }

  private header(): string {
    const total = money(this.total());
    if (this.options.hideBasketEntry) return "";
    if (this.options.hideEmptyBasketEntry && this.total() === 0) return "";
    return [
      `<button data-testid="components.MainNavigationMenu.viewBasketButton" data-action="basket-main">View basket · ${total}</button>`,
      `<button data-testid="screens.Groceries.GroceriesScreen.activeBasketButton" data-action="basket-grocery">View basket · ${total}</button>`,
      `<button data-testid="screens.Provider.Menu.ProviderMenuStickySearch.viewBasket" data-action="basket-sticky">View basket\n · ${total}</button>`,
    ].join("");
  }

  private counter(line: FixtureLine): string {
    const plusTestId = this.options.plusTestId === true ? ' data-testid="components.CheckoutItem.checkoutItemCounter.plus"' : "";
    const extra = this.options.plusAmbiguous
      ? '<div role="button" tabindex="0" data-action="noop" aria-label="Edit quantity">edit</div>'
      : "";
    const minusDisabled = this.options.minusDisabledAtOne && line.quantity === 1 ? ' aria-disabled="true"' : "";
    return `<div data-testid="components.CheckoutItem.checkoutItemCounter">
      <div role="button" tabindex="0" data-action="plus"${plusTestId}>+</div>
      <span data-testid="components.CheckoutItem.checkoutItemCounter.text">${line.quantity}</span>
      <div role="button" tabindex="0" data-action="minus" data-testid="components.CheckoutItem.checkoutItemCounter.minus"${minusDisabled}>−</div>
      ${extra}
    </div>`;
  }

  private row(line: FixtureLine): string {
    return `<div class="checkout-row" data-key="${escape(line.key)}" aria-label="${escape(label(line))}">${this.counter(line)}</div>`;
  }

  private productCard(key: string, name: string, unitPriceMinor: number, action: string, addQuantity = 1): string {
    const line = this.lines.find((candidate) => candidate.key === key);
    const current = line?.quantity ?? 0;
    const total = money(unitPriceMinor * addQuantity);
    const currentTotal = money(line ? lineTotal(line) : 0);
    const text = current > 0 ? `Update\n${currentTotal}` : this.options.noControlPrice ? "Add" : `Add\n${total}`;
    const aria = current > 0
      ? `Update ${current} ${name} in basket. Price: ${currentTotal}.`
      : `Add ${addQuantity} ${name} to basket.${this.options.noControlPrice ? "" : ` Price: ${total}.`}`;
    return `<div data-testid="components.GridMenuDishBase.view" aria-label=", ${escape(name)}, ${money(unitPriceMinor)}">
      <button data-testid="components.ProviderDish.addButton" data-action="${action}" aria-label="${escape(aria)}">${text.replace(/\n/g, "<br>")}</button>
    </div>`;
  }

  private render(): void {
    const total = money(this.total());
    const addQuantity = this.options.addQuantity ?? 1;
    const menu = `${this.header()}
      ${this.productCard("pads", PADS.name, PADS.unitPriceMinor, "add-pads", addQuantity)}
      ${this.productCard("yogurt", DEFAULT_LINES[0].name, DEFAULT_LINES[0].unitPriceMinor, "add-yogurt")}
      ${this.options.mysteryProduct ? `<div data-testid="components.GridMenuDishBase.view" aria-label=", Mystery item"><button data-testid="components.ProviderDish.addButton" data-action="add-mystery">Add</button></div>` : ""}
      <div id="menu">menu ${total}</div>`;
    const rows = this.lines.filter((line) => line.quantity > 0).map((line) => this.row(line));
    if (this.options.zeroQuantityRow) {
      rows.push(this.row({ key: "removed", name: "Removed fixture line", quantity: 0, unitPriceMinor: 100 }));
    }
    if (this.options.malformedRow) {
      rows.push(`<div class="checkout-row" aria-label="Broken row. Amount: ?. Price: ?."><div data-testid="components.CheckoutItem.checkoutItemCounter"><div role="button" tabindex="0" data-action="plus">+</div><span data-testid="components.CheckoutItem.checkoutItemCounter.text">?</span><div role="button" tabindex="0" data-action="minus" data-testid="components.CheckoutItem.checkoutItemCounter.minus">−</div></div></div>`);
    }
    const checkout = `${this.header()}
      <div id="checkout">${rows.join("")}${this.total() === 0 ? "<div>Your basket is empty</div>" : ""}<div>Subtotal ${total}</div></div>`;
    this.window.document.body.innerHTML = this.page === "checkout" ? checkout : menu;
    this.window.history.replaceState({}, "", this.url());
  }

  private handle(event: unknown): void {
    const target = (event as { target?: ClickTarget | null }).target;
    const element = target?.closest("[data-action]");
    const action = element?.getAttribute("data-action");
    if (!action) return;
    if (action === "basket-main") { this.basketMainClicks++; this.showCheckout(); return; }
    if (action === "basket-grocery") { this.basketGroceryClicks++; this.showCheckout(); return; }
    if (action === "basket-sticky") { this.basketStickyClicks++; this.showCheckout(); return; }
    if (action.startsWith("add-")) {
      this.addClicks++;
      if (this.options.ignoreAdd) return;
      const key = action === "add-pads" ? "pads" : action === "add-yogurt" ? "yogurt" : "mystery";
      const quantity = key === "pads" ? this.options.addQuantity ?? 1 : 1;
      const known = this.lines.find((line) => line.key === key);
      if (known) known.quantity += quantity;
      else if (key === "pads") this.lines.push({ ...PADS, quantity });
      else this.lines.push({ key, name: key === "mystery" ? "Mystery item" : key, quantity, unitPriceMinor: 0 });
      this.render();
      return;
    }
    const row = element?.closest(".checkout-row");
    const key = row?.getAttribute("data-key");
    const line = this.lines.find((candidate) => candidate.key === key);
    if (!line) return;
    if (action === "plus") {
      this.plusClicks++;
      if (this.options.ignorePlus) return;
      line.quantity++;
      this.render();
    } else if (action === "minus") {
      this.minusClicks++;
      if (this.options.ignoreMinus) return;
      line.quantity--;
      if (line.quantity <= 0) this.lines = this.lines.filter((candidate) => candidate.key !== line.key);
      this.render();
    }
  }
}
