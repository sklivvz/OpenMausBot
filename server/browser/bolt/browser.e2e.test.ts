import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CdpPage } from "../cdp/page.ts";
import { FixtureServer } from "../cdp/testing/fixtures.ts";
import { CHROME, startChrome, type RunningChrome } from "../cdp/testing/real-chrome.ts";
import { BINDINGS, type BoltBindings, type DomNode } from "./contracts.ts";
import { BoltBrowserPort } from "./browser.ts";
import { BoltRunner } from "./runner.ts";
import { BoltJournal } from "./state.ts";
import { RECORDED_BINDINGS } from "./dom.ts";

const attr = (attribute: string, kind: DomNode["kind"] = "text"): DomNode => ({ kind, attribute });
const element = (selector: string, kind: DomNode["kind"] = "text"): DomNode => ({ kind, selector });
const choice: DomNode = { kind: "object", fields: {
  id: attr("id"), label: attr("aria-label"), available: attr("data-available", "boolean"), selected: attr("checked", "boolean"), priceMinor: attr("data-price", "number"), control: { kind: "control" },
} };
const bindings: BoltBindings = { version: 1, evidence: "Synthetic local HTML only; not evidence of Bolt's live option or checkout DOM.", root: { kind: "object", fields: {
  item: { kind: "object", selector: "#item", fields: {
    id: attr("data-id"), name: attr("data-name"), mode: attr("data-mode"), quantity: element("#quantity", "number"), unitPriceMinor: attr("data-price", "number"),
    plus: element("#plus", "control"), minus: element("#minus", "control"),
    groups: { kind: "list", selector: "fieldset", item: { kind: "object", fields: {
      id: attr("id"), label: attr("aria-label"), min: attr("data-min", "number"), max: attr("data-max", "number"), mode: attr("data-mode"),
      choices: { kind: "list", selector: "input", item: choice },
    } } },
    comment: { kind: "object", selector: "#comment", fields: { supported: attr("data-supported", "boolean"), text: attr("value"), maxLength: attr("maxlength", "number"), input: { kind: "control" } } },
  } },
  deliveryOptions: { kind: "list", selector: ".delivery", item: { kind: "object", fields: {
    id: attr("id"), label: attr("aria-label"), feeMinor: attr("data-fee", "number"), eta: attr("data-eta"), available: attr("data-available", "boolean"), selected: attr("checked", "boolean"), control: { kind: "control" },
  } } },
} } };

const html = `<!doctype html><meta charset="utf-8"><title>Synthetic Bolt operations</title>
<section id="item" data-mode="new" data-id="meal" data-name="Fixture meal" data-price="650">
  <fieldset id="size" aria-label="Size" data-min="1" data-max="1" data-mode="single">
    <label><input type="radio" name="size" id="small" aria-label="Small" data-available="true" data-price="0" checked>Small</label>
    <label><input type="radio" name="size" id="large" aria-label="Large" data-available="true" data-price="200">Large</label>
  </fieldset>
  <fieldset id="extras" aria-label="Extras" data-min="0" data-max="2" data-mode="multiple">
    <label><input type="checkbox" id="cheese" aria-label="Cheese" data-available="true" data-price="100">Cheese</label>
    <label><input type="checkbox" id="no-onion" aria-label="Remove onion" data-available="true" data-price="0">Remove onion</label>
  </fieldset>
  <button id="minus" onclick="document.querySelector('#quantity').textContent=Number(document.querySelector('#quantity').textContent)-1">−</button>
  <span id="quantity">1</span>
  <button id="plus" onclick="document.querySelector('#quantity').textContent=Number(document.querySelector('#quantity').textContent)+1">+</button>
  <textarea id="comment" data-supported="true" maxlength="200" aria-label="Item comment"></textarea>
</section>
${Array.from({ length: 4 }, (_, index) => `<label><input class="delivery" type="radio" name="delivery" id="delivery-${index}" aria-label="Delivery ${index}" data-fee="${index * 100}" data-eta="${30 - index * 5} min" data-available="true" ${index === 0 ? "checked" : ""}>Delivery ${index}</label>`).join("")}`;

(CHROME ? describe : describe.skip)("Bolt operations on an isolated real browser", () => {
  let fixtures: FixtureServer;
  let chrome: RunningChrome;
  let page: CdpPage;
  let directory: string;
  beforeAll(async () => {
    fixtures = await FixtureServer.start();
    chrome = await startChrome("bolt-mechanical");
    page = await chrome.browser.waitForPage();
    directory = mkdtempSync(join(tmpdir(), "bolt-real-browser-"));
  }, 120_000);
  afterAll(async () => {
    await chrome?.close();
    await fixtures?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("executes real radio, checkbox, quantity, textarea and dynamic delivery actions", async () => {
    const url = fixtures.page("/configuration", html);
    await page.navigate(url);
    const port = new BoltBrowserPort(page, BINDINGS.parse(bindings), () => {}, () => 5000, new URL(url).origin);
    const runner = new BoltRunner(port, new BoltJournal(join(directory, "configuration")));
    let observed = await port.read();
    const groups = observed.view.item!.groups;
    const result = await runner.run({ action: "set_item_options", operationId: "options", observationRef: observed.observationRef, selections: [
      { groupRef: groups[0].ref, choices: [{ choiceRef: groups[0].choices[1].ref, quantity: 1 }] },
      { groupRef: groups[1].ref, choices: [{ choiceRef: groups[1].choices[1].ref, quantity: 1 }] },
    ] });
    expect(result.status).toBe("verified");
    observed = await port.read();
    expect((await runner.run({ action: "set_item_comment", operationId: "comment", observationRef: observed.observationRef, text: "No salt, please" })).status).toBe("verified");
    observed = await port.read();
    expect((await runner.run({ action: "set_product_quantity", operationId: "quantity", observationRef: observed.observationRef, expectedQuantity: 1, quantity: 3 })).status).toBe("verified");
    observed = await port.read();
    expect(observed.view.deliveryOptions).toHaveLength(4);
    expect((await runner.run({ action: "select_delivery_option", operationId: "delivery", observationRef: observed.observationRef, targetRef: observed.view.deliveryOptions![3].ref })).status).toBe("verified");
    const final = await port.read();
    expect(final.view.item!.comment.text).toBe("No salt, please");
    expect(final.view.item!.quantity).toBe(3);
    expect(final.view.item!.groups[0].choices.map((option) => option.selected)).toEqual([false, true]);
    expect(final.view.item!.groups[1].choices.map((option) => option.selected)).toEqual([false, true]);
    expect(final.view.deliveryOptions!.map((option) => option.selected)).toEqual([false, false, false, true]);
  }, 30_000);

  it("reads recorded controls without inventing unavailable structural mappings", async () => {
    const url = fixtures.page("/recorded", `<input data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input" value="Soup"><button data-testid="components.MainNavigationMenu.viewBasketButton">Basket</button>`);
    await page.navigate(url);
    const port = new BoltBrowserPort(page, RECORDED_BINDINGS, () => {}, () => 5000, new URL(url).origin);
    const observed = await port.read();
    expect(observed.view.search).toBe("Soup");
    expect(observed.view.controls).toEqual({ search: "controls.search", openBasket: "controls.openBasket" });
    const runner = new BoltRunner(port, new BoltJournal(join(directory, "recorded")));
    await expect(runner.run({ action: "read_item_options" })).rejects.toThrow("item_binding_required");
  });

  it("rejects non-Bolt origins with production defaults", async () => {
    const port = new BoltBrowserPort(page, bindings, () => {}, () => 5000);
    await expect(port.read()).rejects.toThrow("bolt_origin_required");
  });

  it("rejects fresh-looking refs when fees changed between read and click", async () => {
    const url = fixtures.page("/stale", html);
    await page.navigate(url);
    const port = new BoltBrowserPort(page, bindings, () => {}, () => 5000, new URL(url).origin);
    const observed = await port.read();
    await page.evaluate(`document.querySelector('#delivery-3').setAttribute('data-fee','999')`);
    await expect(port.click(observed.view.deliveryOptions![3].control)).rejects.toThrow("page_changed_before_action");
    expect((await port.read()).view.deliveryOptions![3].selected).toBe(false);
  });
});
