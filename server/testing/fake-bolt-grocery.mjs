import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Window } from "happy-dom";

/**
 * Test-only legacy agent-browser MCP. The test ids and row/pay text come from
 * the public Bolt web bundle
 * https://food.bolt.eu/_expo/static/js/web/index-6c9f5a6981b9e8534582dd15d4cf5e0b.js
 * (sha256 df909f20f08346d8f1345e5dd65c645b06e7225a65862ab6205a58e0965c5965)
 * and the record-derived worker fixtures. The DOM is disposable; no Bolt
 * account, cart, checkout or payment is contacted.
 */
const ORIGIN = "https://food.bolt.eu";
const BRANCH_PATH = "/en/1-tallinn/p/28032-bolt-market-toompuiestee/";
const BRANCH_URL = `${ORIGIN}${BRANCH_PATH}`;
const DESTINATION = "Uus-Volta 6/1, Tallinn";
const callLog = process.env.BOLT_CALL_LOG;
const unknownAdd = process.env.BOLT_ADD_EFFECT_UNKNOWN === "1";
const hideBasket = process.env.BOLT_HIDE_BASKET === "1";
const startUrl = process.env.BOLT_START_URL || BRANCH_URL;

const dishes = [
  {
    key: "soup",
    name: "Presto, Organic Pumpkin Puree Soup with Coconut Milk, 300g",
    priceMinor: 329,
    unit: "10,97 €/kg",
  },
  {
    key: "jam",
    name: "Meie Mari, Raspberry Jam, 310g",
    priceMinor: 302,
    unit: "9,74 €/kg",
  },
];

const state = {
  page: new URL(startUrl).pathname.includes("/p/") ? "menu" : "landing",
  search: "",
  active: false,
  detail: null,
  detailQuantity: 1,
  basketOpen: false,
  lines: [],
  payClicks: 0,
};

const window = new Window({ url: startUrl });
let lastClickEffect = null;
let clickEffectError = null;

const money = (minor) => `${(minor / 100).toFixed(2).replace(".", ",")} €`;
const escape = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function record(entry) {
  if (callLog) appendFileSync(callLog, `${JSON.stringify(entry)}\n`);
}

function dishOf(line) {
  return dishes.find((dish) => dish.key === line.key);
}

function lineTotal(line) {
  return dishOf(line).priceMinor * line.quantity;
}

function subtotal() {
  return state.lines.reduce((total, line) => total + lineTotal(line), 0);
}

function checkoutTotal() {
  return subtotal() + 680 + 152 + 329;
}

function lineLabel(line) {
  const dish = dishOf(line);
  return `${dish.name}. Amount: ${line.quantity}. Price: ${money(lineTotal(line))}.`;
}

function header() {
  const basketButton = hideBasket || state.page !== "menu"
    ? ""
    : `<button data-testid="components.MainNavigationMenu.viewBasketButton" data-action="basket">View basket · ${money(subtotal())}</button>`;
  return `<header>
    <h1>Bolt Market Toompuiestee</h1>
    <button aria-label="Delivery address ${escape(DESTINATION)}"></button>
    ${state.page === "menu" ? `
      <input data-testid="screens.Search.searchInput.blurred" value="">
      <input data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input" value="${escape(state.search)}">
      <button data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.cancelButton" style="display:${state.active ? "inline" : "none"}">Cancel</button>
    ` : ""}
    ${basketButton}
  </header>`;
}

function cards() {
  if (state.page !== "menu") return "";
  const query = state.active ? state.search.trim().toLocaleLowerCase() : "";
  const visible = query
    ? dishes.filter((dish) => dish.name.toLocaleLowerCase().includes(query))
    : dishes;
  return `<section id="cards">${visible.map((dish) => `
    <button data-testid="components.GridMenuDishBase.view" aria-label=", ${escape(dish.name)}, ${money(dish.priceMinor)}" data-dish="${dish.key}">
      <div data-testid="components.GridMenuDishBase.button" data-action="open-product" data-dish="${dish.key}" tabindex="0">
        <div data-testid="components.GridMenuDishBase.title">${escape(dish.name)}</div>
        <div data-testid="components.GridMenuDishBase.price">${money(dish.priceMinor)}</div>
        <div data-testid="components.GridMenuDishBase.unitPrice">${escape(dish.unit)}</div>
      </div>
    </button>`).join("")}</section>`;
}

function detail() {
  if (!state.detail) return "";
  const dish = dishes.find((candidate) => candidate.key === state.detail);
  if (!dish) return "";
  const total = dish.priceMinor * state.detailQuantity;
  return `<section class="dish-sheet" data-detail="${dish.key}">
    <button data-testid="screens.Provider.Dish.DishBottomSheet.closeButton" data-action="close-product">Close</button>
    <div data-testid="components.ProviderDish.dishName">${escape(dish.name)}</div>
    <div data-testid="components.ProviderDish.dishPrice">${money(dish.priceMinor)}</div>
    <div data-testid="components.ProviderDish.additionalPriceInfo">${escape(dish.unit)}</div>
    <div data-testid="components.ProviderDish.dishCounter">
      <button data-testid="components.ProviderDish.dishCounter.minus" data-action="quantity-minus" aria-label="Decrease quantity"${state.detailQuantity <= 1 ? " disabled" : ""}>−</button>
      <span data-testid="components.ProviderDish.dishCounter.text">${state.detailQuantity}</span>
      <button data-testid="components.ProviderDish.dishCounter.plus" data-action="quantity-plus" aria-label="Increase quantity">+</button>
    </div>
    <div class="add-wrap">
      <h3>${escape(dish.name)}</h3>
      <button data-testid="components.ProviderDish.addButton" data-action="add" data-dish="${dish.key}" aria-label="Add ${state.detailQuantity} ${escape(dish.name)} to basket. Price: ${money(total)}.">Add ${money(total)}</button>
    </div>
  </section>`;
}

function rows() {
  return state.lines.map((line) => `
    <div class="checkout-row" data-key="${line.key}" aria-label="${escape(lineLabel(line))}">
      <div data-testid="components.CheckoutItem.checkoutItemCounter">
        <div role="button" tabindex="0" data-testid="components.CheckoutItem.checkoutItemCounter.plus" data-action="line-plus" data-key="${line.key}">+</div>
        <span data-testid="components.CheckoutItem.checkoutItemCounter.text">${line.quantity}</span>
        <div role="button" tabindex="0" data-testid="components.CheckoutItem.checkoutItemCounter.minus" data-action="line-minus" data-key="${line.key}">−</div>
      </div>
    </div>`).join("");
}

function checkout() {
  if (state.lines.length === 0) return "<div>Your basket is empty</div>";
  const delivery = [
    { label: "Priority delivery, 25-50 min, Direct to you", selected: true },
    { label: "Standard delivery, 35-55 min", selected: false },
  ];
  return `<div class="checkout">
    <div role="button" aria-label="Delivery address ${escape(DESTINATION)}"><div data-testid="screens.Checkout.checkoutDestinationRow">${escape(DESTINATION)}</div></div>
    <section id="checkout-items">${state.lines.map((line) => `<button data-testid="features.CheckoutItemRow.editButton2" aria-label="${escape(lineLabel(line))}">${escape(dishOf(line).name)}</button>`).join("")}</section>
    <div data-testid="components.Checkout.CheckoutDeliveryOptions.view">${delivery.map((option) => `
      <button data-testid="components.Checkout.CheckoutDeliveryOptions.dispatchOption" data-action="delivery" aria-label="${escape(option.label)}">
        <span data-testid="components.Checkout.CheckoutDeliveryOptions.radio${option.selected ? ":checked" : ""}"></span>
        <span>${escape(option.label)}</span>
      </button>`).join("")}</div>
    <div data-testid="OrderPaymentMethodTabs.tab.fixture_LOCAL_DELIMITER_card" role="button" aria-label="•••• 2000" aria-selected="true">•••• 2000</div>
    <textarea data-testid="components.OrderComment.noteInput"></textarea>
    <div data-testid="components.OrderFees.feesContainer">
      <div data-testid="components.OrderFees.feeItem"><span>Subtotal</span><span>${money(subtotal())}</span></div>
      <div data-testid="components.OrderFees.feeItem"><span>Small order fee</span><span>${money(680)}</span></div>
      <div data-testid="components.OrderFees.feeItem"><span>Service fee</span><span>${money(152)}</span></div>
      <div data-testid="components.OrderFees.feeItem"><span>Delivery fee</span><span>${money(329)}</span></div>
    </div>
    <div data-testid="screens.OnePageCheckout.totalPriceRow"><span>Total</span><span>${money(checkoutTotal())}</span></div>
    <button data-testid="screens.OnePageCheckout.confirmSimpleButton" data-action="pay" aria-label="Checkout button. Confirm order and pay ${money(checkoutTotal())}.">Place order</button>
  </div>`;
}

function basket() {
  if (!state.basketOpen) return "";
  return `<aside id="basket">${rows()}${checkout()}</aside>`;
}

function render() {
  const landing = `<main><h1>Bolt Food Tallinn</h1><button data-action="branch">Open Bolt Market</button></main>`;
  window.document.body.innerHTML = state.page === "landing"
    ? landing
    : `${header()}${cards()}${detail()}${basket()}`;
}

window.document.body.addEventListener("click", (event) => {
  const target = event.target;
  if (!target || typeof target.closest !== "function") return;
  const element = target.closest("[data-action]");
  const action = element?.getAttribute("data-action");
  if (!action) return;
  if (action === "branch") {
    state.page = "menu";
    window.history.replaceState({}, "", BRANCH_URL);
    lastClickEffect = { kind: "branch" };
    render();
    return;
  }
  if (action === "basket") {
    state.basketOpen = true;
    lastClickEffect = { kind: "open-basket" };
    render();
    return;
  }
  if (action === "open-product") {
    state.detail = element.getAttribute("data-dish");
    state.detailQuantity = 1;
    lastClickEffect = { kind: "open-product", key: state.detail };
    render();
    return;
  }
  if (action === "close-product") {
    state.detail = null;
    lastClickEffect = { kind: "close-product" };
    render();
    return;
  }
  if (action === "quantity-plus" || action === "quantity-minus") {
    state.detailQuantity = Math.max(1, state.detailQuantity + (action === "quantity-plus" ? 1 : -1));
    lastClickEffect = { kind: action };
    render();
    return;
  }
  if (action === "add") {
    const key = element.getAttribute("data-dish");
    lastClickEffect = { kind: "add", key };
    if (unknownAdd) {
      clickEffectError = "fixture add effect unknown";
      return;
    }
    const line = state.lines.find((candidate) => candidate.key === key);
    if (line) line.quantity += state.detailQuantity;
    else state.lines.push({ key, quantity: state.detailQuantity });
    render();
    return;
  }
  if (action === "line-plus" || action === "line-minus") {
    const key = element.getAttribute("data-key");
    const line = state.lines.find((candidate) => candidate.key === key);
    if (!line) return;
    line.quantity += action === "line-plus" ? 1 : -1;
    if (line.quantity <= 0) state.lines = state.lines.filter((candidate) => candidate.key !== key);
    lastClickEffect = { kind: action, key };
    render();
    return;
  }
  if (action === "pay") {
    state.payClicks++;
    lastClickEffect = { kind: "pay" };
    return;
  }
  if (action === "delivery") {
    lastClickEffect = { kind: "delivery" };
    return;
  }
});

function ok(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fail(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function callTool(name, args) {
  if (name === "agent_browser_get_url") return ok(window.location.href);
  if (name === "agent_browser_eval") {
    try {
      const value = window.eval(String(args.script));
      return ok(value === undefined ? null : value);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
  if (name === "agent_browser_open") {
    const url = String(args.url);
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN) return fail("fixture rejects non-Bolt origin");
    state.page = parsed.pathname.includes("/p/") ? "menu" : "landing";
    state.search = "";
    state.active = false;
    state.detail = null;
    window.history.replaceState({}, "", url);
    render();
    return ok({ opened: url });
  }
  if (name === "agent_browser_snapshot") {
    return ok({ url: window.location.href, text: `${window.document.body.textContent || ""}`.trim().slice(0, 4000) });
  }
  if (name === "agent_browser_click") {
    const selector = String(args.selector);
    const element = window.document.querySelector(selector);
    if (!element) return fail(`fixture missing selector ${selector}`);
    clickEffectError = null;
    lastClickEffect = null;
    if (typeof element.click === "function") element.click();
    if (clickEffectError) return fail(clickEffectError);
    return ok({ clicked: selector, effect: lastClickEffect });
  }
  if (name === "agent_browser_fill") {
    const selector = String(args.selector);
    const element = window.document.querySelector(selector);
    if (!element) return fail(`fixture missing selector ${selector}`);
    const value = String(args.text ?? "");
    if (element.getAttribute("data-testid")?.startsWith("screens.Provider.Menu.ProviderMenuStickySearch.searchInput.")) {
      state.search = value;
      state.active = true;
      render();
    } else {
      element.value = value;
      element.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
    return ok({ filled: selector, value });
  }
  return fail(`fixture does not implement ${name}`);
}

render();

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === "notifications/initialized") return;
  let result;
  if (message.method === "initialize") {
    result = { protocolVersion: "2024-11-05", capabilities: { tools: {} } };
  } else if (message.method === "tools/list") {
    result = {
      tools: [
        { name: "agent_browser_get_url", inputSchema: { type: "object", properties: {} } },
        { name: "agent_browser_eval", inputSchema: { type: "object", properties: { script: { type: "string" } } } },
        { name: "agent_browser_open", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
        { name: "agent_browser_click", inputSchema: { type: "object", properties: { selector: { type: "string" } } } },
        { name: "agent_browser_fill", inputSchema: { type: "object", properties: { selector: { type: "string" }, text: { type: "string" } } } },
        { name: "agent_browser_snapshot", inputSchema: { type: "object", properties: {} } },
      ],
    };
  } else if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    record({ tool: name, ...(name === "agent_browser_eval" ? {} : { arguments: args }) });
    result = callTool(name, args);
    if (name === "agent_browser_click") {
      record({ tool: "effect", effect: lastClickEffect, payClicks: state.payClicks, lines: state.lines.map((line) => ({ key: line.key, quantity: line.quantity, totalMinor: lineTotal(line) })) });
    }
  } else {
    result = {};
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
});
