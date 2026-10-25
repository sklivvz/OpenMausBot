import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.env.BOLT_CALL_LOG;
const record = (name) => { if (log) appendFileSync(log, `${name}\n`); };
let url = "https://food.bolt.eu/en/1-tallinn/p/70745-bolt-market/";
const view = {
  search: "",
  address: "Work, Lift99 TELLISKIVI Hub, Telliskivi 60a/5, Tallinn",
  products: [{
    ref: "products.0", id: "Presto, Organic Pumpkin Puree Soup with Coconut Milk, 300g",
    name: "Presto, Organic Pumpkin Puree Soup with Coconut Milk, 300g, 3,29 €",
    priceMinor: 329, saleDescription: "300g", saleQuantity: "300g", saleUnit: "g",
    displayedPriceBasis: "per_pack", open: "products.0.open",
  }],
  basketState: { loading: process.env.BOLT_BASKET_LOADING !== "0", ready: process.env.BOLT_BASKET_READY === "1", rowsAvailable: false, detail: "Basket", control: "basket" },
  fulfilmentOptions: [{
    ref: "fulfilment.0", id: "Priority delivery, 25-50 min", label: "Priority delivery, 25-50 min",
    available: true, selected: false, control: "fulfilment.0",
  }],
  deliveryOptions: [{
    ref: "delivery.0", id: "Priority delivery, 25-50 min", label: "Priority delivery, 25-50 min",
    feeMinor: null, eta: "25-50 min", available: true, selected: false, control: "delivery.0",
  }],
  controls: { search: "search", openBasket: "basket" },
};
const targets = {
  "products.0.open": { selector: "#product-0", enabled: true, signature: "button|product" },
  basket: { selector: "#basket", enabled: true, signature: "button|basket" },
  search: { selector: "#search", enabled: true, signature: "input|search" },
  "fulfilment.0": { selector: "#priority", enabled: true, signature: "button|priority" },
  "delivery.0": { selector: "#priority", enabled: true, signature: "button|priority" },
};

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "notifications/initialized") return;
  let result;
  if (message.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} } };
  else if (message.method === "tools/list") result = { tools: [{ name: "agent_browser_eval" }] };
  else if (message.method === "tools/call") {
    const name = message.params?.name;
    record(String(name));
    if (name === "agent_browser_get_url") result = { content: [{ type: "text", text: url }] };
    else if (name === "agent_browser_eval") result = { content: [{ type: "text", text: JSON.stringify({ url, view, targets }) }] };
    else if (name === "agent_browser_fill") {
      view.search = String(message.params?.arguments?.text ?? "");
      result = { content: [{ type: "text", text: JSON.stringify({ filled: message.params?.arguments?.selector }) }] };
    } else if (name === "agent_browser_click") result = { content: [{ type: "text", text: JSON.stringify({ clicked: message.params?.arguments?.selector }) }] };
    else if (name === "agent_browser_open") {
      url = String(message.params?.arguments?.url ?? url);
      view.url = url;
      view.branchId = /\/p\/(\d+)/.exec(url)?.[1];
      if (process.env.BOLT_BRANCH_CONFIRM === "1") view.overlay = "replacement";
      result = { content: [{ type: "text", text: JSON.stringify({ opened: url }) }] };
    }
    else result = { isError: true, content: [{ type: "text", text: `unexpected ${name}` }] };
  } else result = {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
});
