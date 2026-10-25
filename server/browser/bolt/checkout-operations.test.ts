import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OptionCardData } from "../../../shared/wire.ts";
import { boltPaymentAuthority, resolveBoltApproval } from "./approvals.ts";
import type { BoltView } from "./contracts.ts";
import {
  approvableCheckout,
  assertApprovalMatchesQuote,
  checkoutInspectionScript,
  readCheckoutQuote,
  requestCheckoutApproval,
  revalidateCheckoutApproval,
  verifyCheckoutApproval,
  type CheckoutHostFacts,
  type CheckoutQuote,
} from "./checkout-operations.ts";
import {
  E03_CHECKOUT,
  E12_CHECKOUT,
  BOLT_VENDOR_EVIDENCE,
  checkoutTransport,
  checkoutWindow,
  mutateFeeRow,
  mutatePayLabel,
  mutateTotal,
  type CheckoutFixture,
} from "./checkout-operations.fixtures.ts";
import { BoltRunner, checkoutHash, type BoltPort } from "./runner.ts";
import { BoltJournal, digest } from "./state.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "bolt-checkout-"));
  directories.push(directory);
  return directory;
}

async function readFixture(fixture: CheckoutFixture, host: Partial<CheckoutHostFacts> = {}) {
  const window = checkoutWindow(fixture);
  const quote = await readCheckoutQuote(checkoutTransport(window), {
    host: { signedIn: true, account: fixture.account, branchId: fixture.branchId, ...host },
  });
  return { window, quote };
}

function approvalStore() {
  const messages = new Map<string, Array<{ id: string; card?: OptionCardData }>>();
  return {
    messagesFor: (thread: string) => messages.get(thread) ?? [],
    appendMessage: (thread: string, message: { card: OptionCardData }) => {
      const existing = messages.get(thread) ?? [];
      const entry = { id: `message-${existing.length}`, card: message.card };
      messages.set(thread, [...existing, entry]);
      return entry;
    },
    patchMessage: (thread: string, id: string, patch: { card: OptionCardData }) => {
      Object.assign(messages.get(thread)!.find((message) => message.id === id)!, patch);
    },
  };
}

const scope = { botId: "donna", threadId: "user-thread", profileKey: "profile" };

function payFixture(quote: CheckoutQuote) {
  const checkout = quote.checkout!;
  let view: BoltView = {
    session: { signedIn: true, account: checkout.account },
    checkout,
    controls: { pay: "pay" },
  };
  const port: BoltPort = {
    guard: vi.fn(),
    read: vi.fn(async () => ({ url: quote.url, view: structuredClone(view), observationRef: digest(view) })),
    fill: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    click: vi.fn(async (ref) => {
      if (ref !== "pay") return;
      view = {
        ...view,
        order: {
          id: "fixture-order",
          state: "accepted",
          totalMinor: checkout.totalMinor,
          account: checkout.account,
          branchId: checkout.branchId,
          destination: checkout.destination,
          lines: structuredClone(checkout.lines),
        },
      };
    }),
  };
  const journal = new BoltJournal(temporaryDirectory());
  return { port, view: () => view, journal, checkout };
}

describe("atomic Bolt checkout quote", () => {
  it("reconstructs the E03 complete small-order checkout at exactly 1281 cents", async () => {
    const { quote } = await readFixture(E03_CHECKOUT);
    expect(quote.status).toBe("complete");
    expect(quote.missing).toEqual([]);
    expect(quote.conflicts).toEqual([]);
    expect(quote.destination).toBe("Work, Lift99 TELLISKIVI Hub, Telliskivi 60a/5, Kelmiküla, Tallinn");
    expect(quote.deliveryOptions).toHaveLength(3);
    expect(quote.selectedDeliveryOption?.label).toBe("Priority delivery, 15-35 min, Direct to you");
    expect(quote.subtotalMinor).toBe(120);
    expect(quote.adjustments).toEqual([
      { label: "Small order fee", amountMinor: 680 },
      { label: "Service fee", amountMinor: 152 },
      { label: "Delivery fee", amountMinor: 329 },
    ]);
    expect(quote.totalMinor).toBe(1281);
    expect(quote.payableMinor).toBe(1281);
    expect(quote.checkout).toMatchObject({
      account: "fixture-account",
      branchId: "123",
      currency: "EUR",
      destination: "Work, Lift99 TELLISKIVI Hub, Telliskivi 60a/5, Kelmiküla, Tallinn",
      fulfilment: "delivery",
      deliveryLabel: "Priority delivery, 15-35 min, Direct to you",
      deliveryEta: "15-35 min",
      paymentMethod: "•••• 2000",
      subtotalMinor: 120,
      totalMinor: 1281,
    });
    expect(quote.checkoutHash).toMatch(/^[a-f0-9]{64}$/);
    expect(quote.quoteHash).toBe(quote.checkoutHash);
    expect(quote.checkoutHash).toBe(checkoutHash(quote.checkout!));
  });

  it("reconstructs the E12 discounted checkout at 3138 cents with the signed discount preserved", async () => {
    const { quote } = await readFixture(E12_CHECKOUT);
    expect(quote.status).toBe("complete");
    expect(quote.deliveryOptions).toHaveLength(4);
    expect(quote.selectedDeliveryOption?.label).toBe("Priority delivery, 25-50 min, Direct to you");
    expect(quote.subtotalMinor).toBe(2800);
    expect(quote.discounts).toEqual([{ label: "Bolt Plus delivery discount", amountMinor: -400 }]);
    expect(quote.adjustments).toEqual([
      { label: "Service fee", amountMinor: 199 },
      { label: "Delivery fee", amountMinor: 539 },
      { label: "Bolt Plus delivery discount", amountMinor: -400 },
    ]);
    expect(quote.totalMinor).toBe(3138);
    expect(quote.payableMinor).toBe(3138);
    expect(quote.checkout!.lines[0]).toMatchObject({
      name: "Grilled mackerel",
      quantity: 1,
      unitPriceMinor: 2800,
      comment: "Please use minimal oil, no butter or creamy sauce; any sauce separately. If possible, about 150 g mackerel and 200 g boiled potatoes, plus the fresh vegetables. Thank you",
    });
    expect(quote.checkout!.lines[0].options.map((option) => option.choiceLabel)).toEqual(["Boiled potatoes", "Fresh vegetables"]);
    expect(quote.checkoutHash).toBe(checkoutHash(quote.checkout!));
  });

  it.each([1, 2, 3, 4])("handles %i dynamic delivery choices without inventing fees", async (count) => {
    const all = [
      { label: "Priority delivery, 15-35 min, Direct to you", selected: true },
      { label: "Standard delivery, 20-40 min" },
      { label: "Pickup, 10-15 min" },
      { label: "Schedule, Select time" },
    ];
    const fixture: CheckoutFixture = { ...E03_CHECKOUT, name: `E03-${count}`, delivery: all.slice(0, count) };
    const { quote } = await readFixture(fixture);
    expect(quote.deliveryOptions).toHaveLength(count);
    expect(quote.selectedDeliveryOption?.label).toBe("Priority delivery, 15-35 min, Direct to you");
    expect(quote.deliveryOptions.map((option) => option.feeMinor)).toEqual(Array.from({ length: count }, () => null));
    expect(quote.status).toBe("complete");
    expect(quote.totalMinor).toBe(1281);
  });

  it("treats the accessible CheckoutItem Price as the exact line total for quantity greater than one", async () => {
    const fixture: CheckoutFixture = {
      ...E03_CHECKOUT,
      name: "E03-qty-2",
      items: [{ name: "McToast™ Double Cheese", quantity: 2, lineTotalMinor: 240 }],
      fees: [
        { label: "Subtotal", amountMinor: 240 },
        { label: "Small order fee", amountMinor: 680 },
        { label: "Service fee", amountMinor: 152 },
        { label: "Delivery fee", amountMinor: 329 },
      ],
      totalMinor: 1401,
      payableMinor: 1401,
    };
    const { quote } = await readFixture(fixture);
    expect(quote.status).toBe("complete");
    expect(quote.lines[0]).toMatchObject({ quantity: 2, lineTotalMinor: 240, unitPriceMinor: 120 });
    expect(quote.checkout!.lines[0]).toMatchObject({ quantity: 2, unitPriceMinor: 120 });
    expect(quote.checkout!.subtotalMinor).toBe(240);
  });

  it("refuses to round a non-divisible line total into a fabricated unit price", async () => {
    const fixture: CheckoutFixture = {
      ...E03_CHECKOUT,
      name: "E03-non-divisible",
      items: [{ name: "Discounted line", quantity: 3, lineTotalMinor: 100 }],
      fees: [
        { label: "Subtotal", amountMinor: 100 },
        { label: "Service fee", amountMinor: 152 },
        { label: "Delivery fee", amountMinor: 329 },
      ],
      totalMinor: 581,
      payableMinor: 581,
    };
    const { quote } = await readFixture(fixture);
    expect(quote.status).toBe("partial");
    expect(quote.lines[0]).toMatchObject({ quantity: 3, lineTotalMinor: 100, unitPriceMinor: null });
    expect(quote.totalMinor).toBe(581);
    expect(quote.missing).toContain("unitPrice");
    expect(() => approvableCheckout(quote)).toThrow("checkout_quote_incomplete");
  });

  it("keeps an explicit zero fee as evidence instead of treating it as unobserved", async () => {
    const fixture: CheckoutFixture = {
      ...E03_CHECKOUT,
      name: "E03-zero-fee",
      fees: [
        { label: "Subtotal", amountMinor: 120 },
        { label: "Small order fee", amountMinor: 680 },
        { label: "Service fee", amountMinor: 152 },
        { label: "Delivery fee", amountMinor: 0 },
      ],
      totalMinor: 952,
      payableMinor: 952,
    };
    const { quote } = await readFixture(fixture);
    expect(quote.status).toBe("complete");
    expect(quote.feeRows).toContainEqual(expect.objectContaining({ label: "Delivery fee", amountMinor: 0 }));
    expect(quote.adjustments).toContainEqual({ label: "Delivery fee", amountMinor: 0 });
    expect(quote.totalMinor).toBe(952);
  });

  it("ignores unrelated product and basket fields that a monolithic profile would reject", async () => {
    const { window } = await readFixture(E03_CHECKOUT);
    window.document.body.insertAdjacentHTML("afterbegin", `
      <button data-testid="components.GridMenuDishBase.view" aria-label=", Fixture, 1,00 €"></button>
      <button data-testid="components.GridMenuDishBase.view" aria-label=", Fixture, 1,00 €"></button>
      <div data-testid="screens.Groceries.GroceriesScreen.activeBasketButton.loading"></div>
      <button aria-label="Delivery address">unrelated empty address control</button>`);
    const quote = await readCheckoutQuote(checkoutTransport(window), {
      host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId },
    });
    expect(quote.status).toBe("complete");
    expect(quote.totalMinor).toBe(1281);
  });

  it("invalidates a previous approval when the cart, fees or payable total change", async () => {
    const { window, quote: first } = await readFixture(E03_CHECKOUT);
    expect(first.status).toBe("complete");
    mutateFeeRow(window, "Service fee", 252);
    mutateTotal(window, 1381);
    mutatePayLabel(window, 1381);
    const second = await readCheckoutQuote(checkoutTransport(window), {
      host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId },
    });
    expect(second.status).toBe("complete");
    expect(second.totalMinor).toBe(1381);
    expect(second.checkoutHash).not.toBe(first.checkoutHash);
    expect(() => assertApprovalMatchesQuote(second, first.checkoutHash!)).toThrow("checkout_quote_changed");

    const store = approvalStore();
    const authority = boltPaymentAuthority(store, scope, () => 1000);
    const approval = await requestCheckoutApproval(authority, first);
    resolveBoltApproval(store, scope.threadId, approval.approvalRef, "allow", () => 1000);
    await expect(authority.verify(approval.approvalRef, first.checkoutHash!)).resolves.toBeUndefined();
    await expect(authority.verify(approval.approvalRef, second.checkoutHash!)).rejects.toThrow("scope_mismatch");
    await expect(verifyCheckoutApproval(authority, approval.approvalRef, second)).rejects.toThrow("scope_mismatch");
  });

  it("invalidates approval when the destination or selected payment method changes", async () => {
    const { window, quote: first } = await readFixture(E03_CHECKOUT);
    const options = { host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId } };
    window.document.querySelector('[aria-label^="Delivery address"]')!.setAttribute(
      "aria-label",
      "Delivery address Home, Other 1, Tallinn",
    );
    const changedAddress = await readCheckoutQuote(checkoutTransport(window), options);
    expect(changedAddress.status).toBe("complete");
    expect(changedAddress.destination).toBe("Home, Other 1, Tallinn");
    expect(changedAddress.checkoutHash).not.toBe(first.checkoutHash);

    const payment = window.document.querySelector('[data-testid^="OrderPaymentMethodTabs.tab."]')!;
    payment.setAttribute("aria-label", "Bank transfer");
    const changedPayment = await readCheckoutQuote(checkoutTransport(window), options);
    expect(changedPayment.status).toBe("complete");
    expect(changedPayment.selectedPaymentMethod).toBe("Bank transfer");
    expect(changedPayment.checkoutHash).not.toBe(changedAddress.checkoutHash);
    expect(() => assertApprovalMatchesQuote(changedPayment, first.checkoutHash!)).toThrow("checkout_quote_changed");
  });

  it("does not approve a quote missing the pay control, total row or fee rows", async () => {
    const noPay = await readFixture({ ...E03_CHECKOUT, includePay: false });
    expect(noPay.quote.status).toBe("partial");
    expect(noPay.quote.missing).toContain("payControl");
    expect(noPay.quote.totalMinor).toBe(1281);
    expect(() => approvableCheckout(noPay.quote)).toThrow("checkout_quote_incomplete");

    const noTotal = await readFixture({ ...E03_CHECKOUT, includeTotal: false });
    expect(noTotal.quote.status).toBe("partial");
    expect(noTotal.quote.missing).toContain("totalRow");
    expect(noTotal.quote.totalMinor).toBe(1281);

    const noFees = await readFixture({ ...E03_CHECKOUT, includeFees: false });
    expect(noFees.quote.status).toBe("partial");
    expect(noFees.quote.feeRows).toEqual([]);
    expect(noFees.quote.totalMinor).toBe(1281);
  });

  it("keeps useful quote data but withholds approval when authenticated host facts are missing", async () => {
    const { quote } = await readFixture(E03_CHECKOUT, { signedIn: false, account: "" });
    expect(quote.status).toBe("partial");
    expect(quote.totalMinor).toBe(1281);
    expect(quote.feeRows).toHaveLength(4);
    expect(quote.adjustments).toHaveLength(3);
    expect(quote.deliveryOptions).toHaveLength(3);
    expect(quote.missing).toEqual(expect.arrayContaining(["signedIn", "account"]));
    const store = approvalStore();
    const authority = boltPaymentAuthority(store, scope, () => 1000);
    const request = vi.spyOn(authority, "request");
    await expect(requestCheckoutApproval(authority, quote)).rejects.toThrow("checkout_quote_incomplete");
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects ambiguous address, pay and delivery targets instead of guessing", async () => {
    const address = await readFixture(E03_CHECKOUT);
    address.window.document.body.insertAdjacentHTML("afterbegin", '<div aria-label="Delivery address Home, Other 1, Tallinn"></div>');
    const ambiguousAddress = await readCheckoutQuote(checkoutTransport(address.window), {
      host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId },
    });
    expect(ambiguousAddress.status).toBe("partial");
    expect(ambiguousAddress.conflicts).toContain("destination_ambiguous");
    expect(ambiguousAddress.totalMinor).toBe(1281);

    const pay = await readFixture({ ...E03_CHECKOUT, extraPay: true });
    expect(pay.quote.status).toBe("partial");
    expect(pay.quote.conflicts).toContain("pay_control_ambiguous");

    const delivery = await readFixture(E03_CHECKOUT);
    delivery.window.document.querySelectorAll('[data-testid="components.Checkout.CheckoutDeliveryOptions.dispatchOption"]')[1]
      ?.setAttribute("aria-checked", "true");
    const ambiguousDelivery = await readCheckoutQuote(checkoutTransport(delivery.window), {
      host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId },
    });
    expect(ambiguousDelivery.status).toBe("partial");
    expect(ambiguousDelivery.conflicts).toContain("delivery_selection_ambiguous");
  });

  it("does not treat an unparsed or absent fee row as free", async () => {
    const unparsed = await readFixture(E03_CHECKOUT);
    const deliveryRow = [...unparsed.window.document.querySelectorAll('[data-testid="components.OrderFees.feeItem"]')]
      .find((row) => row.textContent?.includes("Delivery fee"));
    deliveryRow!.querySelector("span:last-child")!.textContent = "";
    const unparsedQuote = await readCheckoutQuote(checkoutTransport(unparsed.window), {
      host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId },
    });
    expect(unparsedQuote.status).toBe("partial");
    expect(unparsedQuote.missing).toContain("feeRowUnparsed");
    expect(unparsedQuote.unparsedFeeRows).toContainEqual({ text: "Delivery fee", reason: "unparsed" });
    expect(unparsedQuote.totalMinor).toBe(1281);
    expect(unparsedQuote.deliveryOptions.every((option) => option.feeMinor === null)).toBe(true);

    const noDeliveryFee = await readFixture({
      ...E03_CHECKOUT,
      fees: E03_CHECKOUT.fees.filter((fee) => fee.label !== "Delivery fee"),
      totalMinor: 952,
      payableMinor: 952,
    });
    expect(noDeliveryFee.quote.status).toBe("partial");
    expect(noDeliveryFee.quote.missing).toContain("deliveryFee");
    expect(noDeliveryFee.quote.totalMinor).toBe(952);
  });

  it("keeps an unknown unparsed fee row visible and blocks approval", async () => {
    const { window } = await readFixture(E03_CHECKOUT);
    window.document.querySelector('[data-testid="components.OrderFees.feesContainer"]')!.insertAdjacentHTML(
      "beforeend",
      '<div data-testid="components.OrderFees.feeItem"><span>Mystery charge</span></div>',
    );
    const quote = await readCheckoutQuote(checkoutTransport(window), {
      host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId },
    });
    expect(quote.status).toBe("partial");
    expect(quote.unparsedFeeRows).toContainEqual({ text: "Mystery charge", reason: "unparsed" });
    expect(quote.totalMinor).toBe(1281);
    expect(() => approvableCheckout(quote)).toThrow("checkout_quote_incomplete");
  });

  it("rejects mismatched total and pay-button amounts", async () => {
    const { window } = await readFixture(E03_CHECKOUT);
    mutatePayLabel(window, 1282);
    const quote = await readCheckoutQuote(checkoutTransport(window), {
      host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId },
    });
    expect(quote.status).toBe("partial");
    expect(quote.conflicts).toContain("payable_total_mismatch");
  });

  it("re-reads the page before verifying an approval and rejects a stale quote", async () => {
    const { window, quote } = await readFixture(E03_CHECKOUT);
    const store = approvalStore();
    const authority = boltPaymentAuthority(store, scope, () => 1000);
    const approval = await requestCheckoutApproval(authority, quote);
    resolveBoltApproval(store, scope.threadId, approval.approvalRef, "allow", () => 1000);
    const options = { host: { signedIn: true, account: E03_CHECKOUT.account, branchId: E03_CHECKOUT.branchId } };
    await expect(revalidateCheckoutApproval(checkoutTransport(window), options, approval.approvalRef, authority)).resolves.toMatchObject({ status: "complete" });

    mutateFeeRow(window, "Service fee", 252);
    mutateTotal(window, 1381);
    mutatePayLabel(window, 1381);
    await expect(revalidateCheckoutApproval(checkoutTransport(window), options, approval.approvalRef, authority)).rejects.toThrow("scope_mismatch");
  });

  it("binds the composed approval helper to the existing host authority", async () => {
    const { quote } = await readFixture(E03_CHECKOUT);
    const store = approvalStore();
    const authority = boltPaymentAuthority(store, scope, () => 1000);
    const approval = await requestCheckoutApproval(authority, quote);
    expect(approval.checkout).toEqual(quote.checkout);
    expect(approval.checkoutHash).toBe(quote.checkoutHash);
    resolveBoltApproval(store, scope.threadId, approval.approvalRef, "allow", () => 1000);
    await expect(verifyCheckoutApproval(authority, approval.approvalRef, quote)).resolves.toBeUndefined();
  });

  it("rejects reuse of an existing approval through the unchanged runner policy", async () => {
    const { quote } = await readFixture(E03_CHECKOUT);
    const store = approvalStore();
    const authority = boltPaymentAuthority(store, scope, () => 1000);
    const approval = await requestCheckoutApproval(authority, quote);
    resolveBoltApproval(store, scope.threadId, approval.approvalRef, "allow", () => 1000);

    const f = payFixture(quote);
    const runner = new BoltRunner(f.port, f.journal, authority);
    const input = {
      action: "pay" as const,
      operationId: "pay-once",
      observationRef: digest(f.view()),
      approvedCheckoutRef: approval.approvalRef,
    };
    expect((await runner.run(input)).status).toBe("verified");
    expect((await runner.run(input)).status).toBe("verified");
    await expect(runner.run({ ...input, operationId: "pay-reuse", observationRef: digest(f.view()) })).rejects.toThrow("approval_already_used");
    expect(f.port.click).toHaveBeenCalledExactlyOnceWith("pay");
  });

  it("records the vendor bundle provenance used for the atomic selectors", () => {
    expect(BOLT_VENDOR_EVIDENCE.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(BOLT_VENDOR_EVIDENCE.bytes).toBe(20_163_580);
    expect(BOLT_VENDOR_EVIDENCE.inspected.checkoutItemLineTotal).toBe(15_848_333);
    expect(BOLT_VENDOR_EVIDENCE.checkoutItemPriceSemantics).toContain("line total");
    expect(checkoutInspectionScript()).toContain('screens.OnePageCheckout.confirmSimpleButton');
    expect(checkoutInspectionScript()).toContain('components.OrderFees.feeItem');
    expect(checkoutInspectionScript()).toContain('components.Checkout.CheckoutDeliveryOptions.dispatchOption');
    expect(checkoutInspectionScript()).toContain('OrderPaymentMethodTabs.tab.');
  });
});
