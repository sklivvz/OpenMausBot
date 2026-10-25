import { Window } from "happy-dom";
import type { CheckoutTransport } from "./checkout-operations.ts";

export const BOLT_VENDOR_EVIDENCE = {
  url: "https://food.bolt.eu/_expo/static/js/web/index-6c9f5a6981b9e8534582dd15d4cf5e0b.js",
  sha256: "df909f20f08346d8f1345e5dd65c645b06e7225a65862ab6205a58e0965c5965",
  bytes: 20_163_580,
  inspected: {
    confirmSimpleButton: 15_823_024,
    checkoutItemCounter: 15_479_734,
    deliveryDispatchOption: 15_796_415,
    deliveryRadio: 15_799_850,
    orderFeeItem: 15_981_443,
    orderFeesContainer: 15_981_979,
    totalPriceRow: 15_978_404,
    paymentTabs: 16_059_005,
    checkoutItemRow: 15_851_099,
    checkoutItemLineTotal: 15_848_333,
    checkoutItemAccessibilityLabel: 15_849_589,
    checkoutDestinationRow: 15_945_626,
  },
  checkoutItemPriceSemantics: "CheckoutItemRow maps orderItem.total_price (the line total) into orderItemLabel.price; it does not expose a unit price. The module divides only when the exact integer line total is divisible by quantity.",
} as const;

export interface FixtureItem {
  name: string;
  quantity: number;
  lineTotalMinor: number;
  options?: string[];
  comment?: string;
}

export interface FixtureDelivery {
  label: string;
  selected?: boolean;
  disabled?: boolean;
}

export interface FixtureFee {
  label: string;
  amountMinor: number;
}

export interface CheckoutFixture {
  name: string;
  path: string;
  account: string;
  branchId: string;
  destination: string;
  items: FixtureItem[];
  delivery: FixtureDelivery[];
  fees: FixtureFee[];
  totalMinor: number;
  payableMinor: number;
  paymentMethod: string;
  note?: string;
  includeFees?: boolean;
  includePay?: boolean;
  includeTotal?: boolean;
  extraPay?: boolean;
}

export const E03_CHECKOUT: CheckoutFixture = {
  name: "E03",
  path: "/en/1-tallinn/checkout/123/",
  account: "fixture-account",
  branchId: "123",
  destination: "Work, Lift99 TELLISKIVI Hub, Telliskivi 60a/5, Kelmiküla, Tallinn",
  items: [{ name: "McToast™ Double Cheese", quantity: 1, lineTotalMinor: 120 }],
  delivery: [
    { label: "Priority delivery, 15-35 min, Direct to you", selected: true },
    { label: "Standard delivery, 20-40 min" },
    { label: "Pickup, 10-15 min", disabled: true },
  ],
  fees: [
    { label: "Subtotal", amountMinor: 120 },
    { label: "Small order fee", amountMinor: 680 },
    { label: "Service fee", amountMinor: 152 },
    { label: "Delivery fee", amountMinor: 329 },
  ],
  totalMinor: 1281,
  payableMinor: 1281,
  paymentMethod: "•••• 2000",
};

export const E12_CHECKOUT: CheckoutFixture = {
  name: "E12",
  path: "/en/1-tallinn/checkout/456/",
  account: "fixture-account",
  branchId: "456",
  destination: "Uus-Volta Tänav 6/1, Kalamaja, Tallinn",
  items: [{
    name: "Grilled mackerel",
    quantity: 1,
    lineTotalMinor: 2800,
    options: ["Boiled potatoes", "Fresh vegetables"],
    comment: "Please use minimal oil, no butter or creamy sauce; any sauce separately. If possible, about 150 g mackerel and 200 g boiled potatoes, plus the fresh vegetables. Thank you.",
  }],
  delivery: [
    { label: "Priority delivery, 25-50 min, Direct to you", selected: true },
    { label: "Standard delivery, 30-55 min" },
    { label: "Pickup, 15-20 min" },
    { label: "Schedule, Select time" },
  ],
  fees: [
    { label: "Subtotal", amountMinor: 2800 },
    { label: "Service fee", amountMinor: 199 },
    { label: "Delivery fee", amountMinor: 539 },
    { label: "Bolt Plus delivery discount", amountMinor: -400 },
  ],
  totalMinor: 3138,
  payableMinor: 3138,
  paymentMethod: "•••• 1002",
};

export const money = (minor: number) => `${minor < 0 ? "−" : ""}${(Math.abs(minor) / 100).toFixed(2).replace(".", ",")} €`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function itemAccessibleLabel(item: FixtureItem): string {
  const base = `${item.name}. Amount: ${item.quantity}. Price: ${money(item.lineTotalMinor)}.`;
  const options = item.options?.length ? ` Selected options: ${item.options.join(", ")}.` : "";
  const comment = item.comment ? ` Comment: ${item.comment}` : "";
  return `${base}${options}${comment}`;
}

function feeHtml(fee: FixtureFee): string {
  return `<div data-testid="components.OrderFees.feeItem"><span>${escapeHtml(fee.label)}</span><span>${money(fee.amountMinor)}</span></div>`;
}

function deliveryHtml(option: FixtureDelivery, index: number): string {
  const radio = option.selected
    ? `<span data-testid="components.Checkout.CheckoutDeliveryOptions.radio:checked"></span>`
    : option.disabled
      ? `<span data-testid="components.Checkout.CheckoutDeliveryOptions.radio:disabled"></span>`
      : `<span data-testid="components.Checkout.CheckoutDeliveryOptions.radio"></span>`;
  const disabled = option.disabled ? ` aria-disabled="true"` : "";
  return `<button data-testid="components.Checkout.CheckoutDeliveryOptions.dispatchOption" data-option-index="${index}" aria-label="${escapeHtml(option.label)}"${disabled}>${radio}<span>${escapeHtml(option.label)}</span></button>`;
}

export function checkoutFixtureHtml(checkout: CheckoutFixture): string {
  const includeFees = checkout.includeFees !== false;
  const includePay = checkout.includePay !== false;
  const includeTotal = checkout.includeTotal !== false;
  const addressLabel = checkout.name === "E12" ? `Delivery address: ${checkout.destination}` : `Delivery address ${checkout.destination}`;
  return `<main id="checkout">
    <div role="button" aria-label="${escapeHtml(addressLabel)}"><div data-testid="screens.Checkout.checkoutDestinationRow">${escapeHtml(checkout.destination)}</div></div>
    <section id="items">
      ${checkout.items.map((item) => `<button data-testid="features.CheckoutItemRow.editButton2" aria-label="${escapeHtml(itemAccessibleLabel(item))}">${escapeHtml(item.name)}</button>`).join("")}
    </section>
    <div data-testid="components.Checkout.CheckoutDeliveryOptions.view">
      ${checkout.delivery.map(deliveryHtml).join("")}
    </div>
    <div data-testid="OrderPaymentMethodTabs.tab.fixture_LOCAL_DELIMITER_card" role="button" aria-label="${escapeHtml(checkout.paymentMethod)}" aria-selected="true">${escapeHtml(checkout.paymentMethod)}</div>
    <div data-testid="OrderPaymentMethodTabs.tab.addCard" aria-label="Add card">Add card</div>
    <textarea data-testid="components.OrderComment.noteInput">${escapeHtml(checkout.note ?? "")}</textarea>
    ${includeFees ? `<div data-testid="components.OrderFees.feesContainer">${checkout.fees.map(feeHtml).join("")}</div>` : ""}
    ${includeTotal ? `<div data-testid="screens.OnePageCheckout.totalPriceRow"><span>Total</span><span>${money(checkout.totalMinor)}</span></div>` : ""}
    ${includePay ? `<button data-testid="screens.OnePageCheckout.confirmSimpleButton" aria-label="Checkout button. Confirm order and pay ${money(checkout.payableMinor)}.">Place order</button>` : ""}
    ${checkout.extraPay ? `<button data-testid="screens.OnePageCheckout.confirmSimpleButton" aria-label="Checkout button. Confirm order and pay ${money(checkout.payableMinor)}.">Place order</button>` : ""}
  </main>`;
}

export function checkoutWindow(checkout: CheckoutFixture): Window {
  const window = new Window({ url: `https://food.bolt.eu${checkout.path}` });
  window.document.body.innerHTML = checkoutFixtureHtml(checkout);
  return window;
}

export function checkoutTransport(window: Window): CheckoutTransport {
  return {
    url: () => window.location.href,
    evaluate: async (script) => window.eval(script),
  };
}

export function mutateFeeRow(window: Window, label: string, amountMinor: number): void {
  const rows = [...window.document.querySelectorAll('[data-testid="components.OrderFees.feeItem"]')];
  const row = rows.find((candidate) => candidate.textContent?.includes(label));
  if (!row) throw new Error(`missing fixture fee row ${label}`);
  const amount = row.querySelector("span:last-child");
  if (!amount) throw new Error(`missing fixture fee amount ${label}`);
  amount.textContent = money(amountMinor);
}

export function mutateTotal(window: Window, amountMinor: number): void {
  const total = window.document.querySelector('[data-testid="screens.OnePageCheckout.totalPriceRow"] span:last-child');
  if (!total) throw new Error("missing fixture total");
  total.textContent = money(amountMinor);
}

export function mutatePayLabel(window: Window, amountMinor: number): void {
  const pay = window.document.querySelector('[data-testid="screens.OnePageCheckout.confirmSimpleButton"]');
  if (!pay) throw new Error("missing fixture pay control");
  pay.setAttribute("aria-label", `Checkout button. Confirm order and pay ${money(amountMinor)}.`);
}
