import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BoltDomPort, type BoltDomTransport } from "./browser.ts";
import { RECORDED_BINDINGS } from "./dom.ts";
import { BoltRunner } from "./runner.ts";
import { BoltJournal } from "./state.ts";

const ORIGIN = "https://food.bolt.eu";
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const products = [
  ", Presto, Organic Pumpkin Puree Soup with Coconut Milk, 300g, 3,29 €",
  ", Dave & Jon's, Mango Chili Twist, 100g, 2,99 €, 29,90 €/kg",
];

function fixture(path = "/en/1-tallinn/p/70745-restoran-friends-kristiine/") {
  const window = new Window({ url: `${ORIGIN}${path}` });
  window.document.body.innerHTML = `
    <button aria-label="Delivery address Work, Lift99 TELLISKIVI Hub, Telliskivi 60a/5, Tallinn"></button>
    <input data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input" value="">
    <section id="products">${products.map((label) => `<button data-testid="components.GridMenuDishBase.view" aria-label="${label}"></button>`).join("")}</section>
    <div data-testid="screens.Groceries.GroceriesScreen.activeBasketButton.loading"></div>
    <button data-testid="screens.Groceries.GroceriesScreen.activeBasketButton">Basket</button>
    <button aria-label="Priority delivery, 25-50 min, Direct to you"><input type="radio" name="mode"></button>
    <button aria-label="Standard delivery, 30-55 min"><input type="radio" name="mode"></button>
    <button aria-label="Pickup, 10-15 min"><input type="radio" name="mode"></button>
    <button aria-label="Schedule, Select time"><input type="radio" name="mode"></button>`;
  const transport: BoltDomTransport = {
    url: () => window.location.href,
    evaluate: async (script) => window.eval(script),
    click: async (selector) => {
      const element = window.document.querySelector(selector);
      if (!element) throw new Error(`missing ${selector}`);
      type Input = { name: string; checked: boolean; value: string };
      const radio = element.matches('input[type="radio"]') ? element as unknown as Input : element.querySelector('input[type="radio"]') as unknown as Input | null;
      if (radio) {
        for (const other of window.document.querySelectorAll(`input[type="radio"][name="${radio.name}"]`)) (other as unknown as Input).checked = false;
        radio.checked = true;
      } else {
        (element as unknown as { click(): void }).click();
      }
    },
    fill: async (selector, value) => {
      const input = window.document.querySelector(selector) as unknown as { value: string };
      input.value = value;
      window.history.replaceState({}, "", `${window.location.pathname}?query=${encodeURIComponent(value)}`);
      const matches = products.filter((label) => label.toLowerCase().includes(value.toLowerCase()));
      window.document.querySelector("#products")!.innerHTML = matches.map((label) => `<button data-testid="components.GridMenuDishBase.view" aria-label="${label}"></button>`).join("");
    },
    navigate: async (url) => { window.history.replaceState({}, "", url.replace(ORIGIN, "")); },
  };
  const directory = mkdtempSync(join(tmpdir(), "bolt-dom-"));
  directories.push(directory);
  const port = new BoltDomPort(transport, RECORDED_BINDINGS, () => {}, ORIGIN);
  return { window, directory, port, runner: new BoltRunner(port, new BoltJournal(directory)) };
}

describe("the recorded Bolt mappings on a disposable DOM", () => {
  it("reads search, products with sale facts, address, basket loading and observed delivery choices", async () => {
    const f = fixture();
    const observed = await f.port.read();
    expect(observed.view).toMatchObject({
      search: "", address: "Work, Lift99 TELLISKIVI Hub, Telliskivi 60a/5, Tallinn", branchId: "70745",
      basketState: { loading: true, ready: false, rowsAvailable: false },
    });
    expect(observed.view.products?.map((product) => [product.name, product.priceMinor, product.saleDescription, product.saleUnit])).toEqual([
      ["Presto, Organic Pumpkin Puree Soup with Coconut Milk, 300g", 329, "300g", "g"],
      ["Dave & Jon's, Mango Chili Twist, 100g, 2,99 €, 29,90 €/kg", 299, "100g", "g"],
    ]);
    expect(observed.view.products?.[1]?.unitPriceMinor).toBe(2990);
    expect(observed.view.products?.[1]?.unitPriceBasis).toBe("per_kg");
    expect(observed.view.fulfilmentOptions?.map((choice) => choice.label)).toEqual([
      "Priority delivery, 25-50 min, Direct to you", "Standard delivery, 30-55 min", "Pickup, 10-15 min", "Schedule, Select time",
    ]);
    expect(observed.view.deliveryOptions?.map((choice) => [choice.label, choice.eta, choice.feeMinor])).toEqual([
      ["Priority delivery, 25-50 min, Direct to you", "25-50 min", null],
      ["Standard delivery, 30-55 min", "30-55 min", null],
    ]);
    const inspected = await f.runner.run({ action: "inspect" }) as { supportedActions: string[] };
    expect(inspected.supportedActions).toEqual([
      "inspect", "open_branch", "search_branch", "read_basket", "list_fulfilment_options", "select_fulfilment", "list_delivery_options", "select_delivery_option", "reconcile_operation",
    ]);
  });

  it("dispatches the recorded search separately from claiming fresh results", async () => {
    const f = fixture();
    const observed = await f.port.read();
    const result = await f.runner.run({ action: "search_branch", operationId: "search", observationRef: observed.observationRef, query: "risotto" }) as { status: string; searchResults?: string; verification?: string };
    expect(result.status).toBe("dispatched");
    expect(result.searchResults).toBe("unknown");
    expect(result.verification).toBe("input_only");
    expect((await f.port.read()).view.products).toBeUndefined();
  });

  it("reads basket loading state without inventing rows, and selects fulfilment/delivery through real radio state", async () => {
    const f = fixture();
    let observed = await f.port.read();
    const basket = await f.runner.run({ action: "read_basket" }) as { view: { basketState: { loading: boolean; rowsAvailable: boolean } }; basketRows: string };
    expect(basket.basketRows).toBe("unavailable");
    expect(basket.view.basketState).toMatchObject({ loading: true, ready: false, rowsAvailable: false });
    expect((await f.runner.run({ action: "select_fulfilment", operationId: "fulfil", observationRef: observed.observationRef, targetRef: observed.view.fulfilmentOptions![1].ref })).status).toBe("verified");
    observed = await f.port.read();
    expect(observed.view.fulfilmentOptions!.map((choice) => choice.selected)).toEqual([false, true, false, false]);
    expect((await f.runner.run({ action: "select_delivery_option", operationId: "tier", observationRef: observed.observationRef, targetRef: observed.view.deliveryOptions![0].ref })).status).toBe("verified");
    expect((await f.port.read()).view.deliveryOptions!.map((choice) => choice.selected)).toEqual([true, false]);
  });

  it("fails unsupported item, basket-row, checkout and payment actions before any effect", async () => {
    const f = fixture();
    const observed = await f.port.read();
    for (const [action, code] of [
      ["open_product", "action_bindings_required"],
      ["read_item_options", "action_bindings_required"],
      ["read_checkout", "action_bindings_required"],
      ["pay", "action_bindings_required"],
    ] as const) {
      await expect(f.runner.run({ action, operationId: `${action}-op`, observationRef: observed.observationRef, ...(action === "pay" ? { approvedCheckoutRef: "approval" } : {}) })).rejects.toThrow(code);
    }
    expect(f.runner.journal.read()).toEqual({});
  });

  it("refuses an ambiguous address control rather than guessing", async () => {
    const f = fixture();
    f.window.document.body.insertAdjacentHTML("afterbegin", `<button aria-label="Delivery address Home, Uus-Volta 6/1, Tallinn"></button>`);
    await expect(f.port.read()).rejects.toThrow("ambiguous_control");
  });

  it("does not claim a branch or query it did not see in the route", async () => {
    const f = fixture("/en/1-tallinn/");
    const observed = await f.port.read();
    expect(observed.view.branchId).toBeUndefined();
    expect(observed.view.searchResultQuery).toBeUndefined();
  });
});
