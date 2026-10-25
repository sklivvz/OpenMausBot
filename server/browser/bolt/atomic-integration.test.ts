import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OptionCardData } from "../../../shared/wire.ts";
import { BoltAtomicOperations } from "./atomic.ts";
import { boltPaymentAuthority, resolveBoltApproval } from "./approvals.ts";
import { BasketFixture } from "./basket-fixture.ts";
import { BoltDomPort, type BoltDomTransport } from "./browser.ts";
import { E03_CHECKOUT, checkoutWindow, mutateFeeRow } from "./checkout-operations.fixtures.ts";
import { RECORDED_BINDINGS } from "./dom.ts";
import { BoltRunner } from "./runner.ts";
import { BoltJournal } from "./state.ts";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "bolt-atomic-"));
  directories.push(path);
  return path;
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

function checkoutPageTransport(window: ReturnType<typeof checkoutWindow>): BoltDomTransport {
  return {
    url: () => window.location.href,
    evaluate: async (script) => window.eval(script),
    click: async (selector) => {
      const element = window.document.querySelector(selector) as unknown as { click(): void } | null;
      if (!element) throw new Error(`missing ${selector}`);
      element.click();
    },
    fill: async (selector, value) => {
      const element = window.document.querySelector(selector) as unknown as { value: string } | null;
      if (!element) throw new Error(`missing ${selector}`);
      element.value = value;
    },
    navigate: async (url) => { window.history.replaceState({}, "", url.replace("https://food.bolt.eu", "")); },
  };
}

function runnerFor(transport: BoltDomTransport, hostProfile = "profile") {
  const path = directory();
  const port = new BoltDomPort(transport, RECORDED_BINDINGS, () => {}, "https://food.bolt.eu");
  const atomic = new BoltAtomicOperations({ transport, guard: () => {}, directory: path, host: { profileKey: hostProfile } });
  const store = approvalStore();
  const scope = { botId: "donna", threadId: "thread", profileKey: hostProfile };
  const authority = boltPaymentAuthority(store, scope);
  return { runner: new BoltRunner(port, new BoltJournal(path), authority, atomic), store, authority, path };
}

describe("atomic route receipts", () => {
  it("makes pay a journaled mutation: a lost reply stays pending and the same approval cannot pay twice", async () => {
    const window = checkoutWindow(E03_CHECKOUT);
    const { runner, store } = runnerFor(checkoutPageTransport(window), "fixture-account");
    const read = await runner.run({ action: "read_checkout" }) as { observationRef: string; status: string };
    expect(read.status).toBe("observed");
    const requested = await runner.run({ action: "request_payment_approval", observationRef: read.observationRef }) as { approvalRef: string; observationRef: string };
    resolveBoltApproval(store, "thread", requested.approvalRef, "allow");
    const paid = await runner.run({ action: "pay", operationId: "pay-1", observationRef: requested.observationRef, approvedCheckoutRef: requested.approvalRef }) as { status: string; receipt?: { status: string } };
    expect(paid.status).toBe("dispatched");
    expect(paid.receipt?.status).toBe("pending");
    const replay = await runner.run({ action: "pay", operationId: "pay-1", observationRef: requested.observationRef, approvedCheckoutRef: requested.approvalRef }) as { status: string };
    expect(replay.status).toBe("pending");
    await expect(runner.run({ action: "pay", operationId: "pay-2", observationRef: requested.observationRef, approvedCheckoutRef: requested.approvalRef })).rejects.toThrow(/unresolved_operation|approval_already_used/);
    expect(runner.journal.read()["pay-2"]).toBeUndefined();
    expect(Object.values(runner.journal.read()).filter((receipt) => receipt.input.action === "pay")).toHaveLength(1);
  });

  it("rejects a changed quote against the host approval before any click", async () => {
    const window = checkoutWindow(E03_CHECKOUT);
    const { runner, store } = runnerFor(checkoutPageTransport(window), "fixture-account");
    const read = await runner.run({ action: "read_checkout" }) as { observationRef: string };
    const requested = await runner.run({ action: "request_payment_approval", observationRef: read.observationRef }) as { approvalRef: string; observationRef: string };
    resolveBoltApproval(store, "thread", requested.approvalRef, "allow");
    mutateFeeRow(window, "Service fee", 153);
    const changed = await runner.run({ action: "read_checkout" }) as { observationRef: string; status: string };
    expect(changed.status).toBe("partial");
    await expect(runner.run({ action: "pay", operationId: "pay-changed", observationRef: changed.observationRef, approvedCheckoutRef: requested.approvalRef })).rejects.toThrow("checkout_quote_incomplete");
    expect(runner.journal.read()["pay-changed"]?.status).toBe("not_executed");
  });

  it("reconciles a lost basket response from observed state instead of replaying the click", async () => {
    const fixture = new BasketFixture({ start: "checkout", plusTestId: true });
    const line = fixture.lines.find((candidate) => candidate.key === "yogurt")!;
    let lose = false;
    const transport: BoltDomTransport = {
      ...fixture.transport,
      click: async (selector) => {
        await fixture.transport.click(selector);
        if (lose) {
          lose = false;
          throw new Error("lost reply");
        }
      },
      fill: async () => {},
      navigate: async () => {},
    };
    const { runner } = runnerFor(transport);
    const read = await runner.run({ action: "read_basket" }) as unknown as { observationRef: string; basket: { rows: Array<{ ref: string; name: string; quantity: number }>; basketTotalMinor: number } };
    const target = read.basket.rows.find((row) => row.name === line.name)!;
    const totalBefore = read.basket.basketTotalMinor;
    lose = true;
    await expect(runner.run({ action: "set_basket_quantity", operationId: "qty-1", observationRef: read.observationRef, targetRef: target.ref, expectedQuantity: 2, quantity: 3 })).rejects.toThrow("outcome_unknown");
    expect(runner.journal.read()["qty-1"]?.status).toBe("pending");
    const reconciled = await runner.run({ action: "reconcile_operation", operationId: "qty-1" }) as { status: string; view: { basket: Array<{ ref: string; quantity: number }> } };
    expect(reconciled.status).toBe("verified");
    expect(reconciled.view.basket.find((row) => row.ref === target.ref)?.quantity).toBe(3);
    expect((await runner.run({ action: "read_basket" }) as unknown as { basket: { basketTotalMinor: number } }).basket.basketTotalMinor).toBe(totalBefore + line.unitPriceMinor);
  });
});

function injectYogurtDetail(fixture: BasketFixture): void {
  for (const button of fixture.window.document.querySelectorAll('[data-testid="components.ProviderDish.addButton"]')) button.remove();
  fixture.window.document.body.insertAdjacentHTML("beforeend", `
    <section data-detail="yogurt">
      <button data-testid="screens.Provider.Dish.DishBottomSheet.closeButton"></button>
      <div data-testid="components.ProviderDish.dishName">Tere, Kreeka jogurt maitsestamata, 350 g</div>
      <div data-testid="components.ProviderDish.dishPrice">1,76 €</div>
      <div data-testid="components.ProviderDish.dishCounter">
        <button data-testid="components.ProviderDish.dishCounter.minus" disabled>−</button>
        <span data-testid="components.ProviderDish.dishCounter.text">1</span>
        <button data-testid="components.ProviderDish.dishCounter.plus">+</button>
      </div>
      <div class="add-wrap"><h3>Tere, Kreeka jogurt maitsestamata, 350 g</h3>
        <button data-testid="components.ProviderDish.addButton" data-action="add-yogurt" aria-label="Add 1 Tere, Kreeka jogurt maitsestamata, 350 g to basket. Price: 1,76 €.">Add 1,76 €</button>
      </div>
    </section>`);
}

describe("add and reconcile against an existing baseline line", () => {
  it.each([true, false])("opens an unpriced basket and adds the first item (add aria label=%s)", async (hasAriaLabel) => {
    const fixture = new BasketFixture({ start: "menu", hideEmptyBasketEntry: true, lines: [
      { key: "yogurt", name: "Tere, Kreeka jogurt maitsestamata, 350 g", quantity: 0, unitPriceMinor: 176 },
    ] });
    const navigated: string[] = [];
    const { runner } = runnerFor({ ...fixture.transport, fill: async () => {}, navigate: async (url) => {
      navigated.push(url);
      fixture.showCheckout();
    } });
    const closed = await runner.run({ action: "read_basket" }) as { observationRef: string };
    const opened = await runner.run({ action: "open_basket", observationRef: closed.observationRef, operationId: "open-empty" }) as unknown as { basket: { emptyBasket: boolean } };
    expect(opened.basket.emptyBasket).toBe(true);
    expect(navigated).toEqual(["https://food.bolt.eu/en/1-tallinn/checkout/200420/?source=menu_screen"]);
    fixture.showMenu();
    injectYogurtDetail(fixture);
    if (!hasAriaLabel) fixture.window.document.querySelector('[data-action="add-yogurt"]')!.removeAttribute("aria-label");
    const product = await runner.run({ action: "read_item_options" }) as { observationRef: string };
    const added = await runner.run({ action: "add_configured_product", operationId: "first-item", observationRef: product.observationRef });
    expect(added.status).toBe("verified");
    expect(fixture.addClicks).toBe(1);
    expect(fixture.lines[0].quantity).toBe(1);
    expect((await runner.run({ action: "add_configured_product", operationId: "first-item", observationRef: product.observationRef })).status).toBe("verified");
    expect(fixture.addClicks).toBe(1);
  });

  it("verifies the configured quantity delta instead of treating the whole line total as a new line", async () => {
    const fixture = new BasketFixture({ start: "checkout", plusTestId: true });
    const { runner } = runnerFor({ ...fixture.transport, fill: async () => {}, navigate: async () => {} });
    const baseline = await runner.run({ action: "read_basket" }) as unknown as { observationRef: string; basket: { basketTotalMinor: number } };
    fixture.showMenu();
    injectYogurtDetail(fixture);
    const product = await runner.run({ action: "read_item_options" }) as unknown as { observationRef: string };
    const added = await runner.run({ action: "add_configured_product", operationId: "add-existing", observationRef: product.observationRef }) as unknown as {
      status: string;
      view: { basket: Array<{ name: string; quantity: number; lineTotalMinor: number }> };
    };
    expect(added.status).toBe("verified");
    expect(added.view.basket).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Tere, Kreeka jogurt maitsestamata, 350 g", quantity: 3, lineTotalMinor: 528 }),
    ]));
    expect((await runner.run({ action: "read_basket" }) as unknown as { basket: { basketTotalMinor: number } }).basket.basketTotalMinor).toBe(baseline.basket.basketTotalMinor + 176);
  });

  it("reconciles a lost add from the receipt baseline without requiring the product sheet to stay open", async () => {
    const fixture = new BasketFixture({ start: "checkout", plusTestId: true });
    let lose = false;
    const transport: BoltDomTransport = {
      ...fixture.transport,
      click: async (selector) => {
        await fixture.transport.click(selector);
        if (lose) {
          lose = false;
          throw new Error("lost reply");
        }
      },
      fill: async () => {},
      navigate: async () => {},
    };
    const { runner } = runnerFor(transport);
    await runner.run({ action: "read_basket" });
    fixture.showMenu();
    injectYogurtDetail(fixture);
    const product = await runner.run({ action: "read_item_options" }) as unknown as { observationRef: string };
    lose = true;
    await expect(runner.run({ action: "add_configured_product", operationId: "add-lost", observationRef: product.observationRef })).rejects.toThrow("outcome_unknown");
    expect(fixture.window.document.querySelector('[data-testid="components.ProviderDish.dishName"]')).toBeNull();
    const reconciled = await runner.run({ action: "reconcile_operation", operationId: "add-lost" }) as { status: string };
    expect(reconciled.status).toBe("verified");
    expect(fixture.addClicks).toBe(1);
  });

  it("reconciles removal at zero only when every other row is unchanged", async () => {
    const fixture = new BasketFixture({ start: "checkout", plusTestId: true });
    let lose = false;
    const transport: BoltDomTransport = {
      ...fixture.transport,
      click: async (selector) => {
        await fixture.transport.click(selector);
        if (lose) {
          lose = false;
          throw new Error("lost reply");
        }
      },
      fill: async () => {},
      navigate: async () => {},
    };
    const { runner } = runnerFor(transport);
    const read = await runner.run({ action: "read_basket" }) as unknown as { observationRef: string; basket: { rows: Array<{ ref: string; name: string; quantity: number }> } };
    const target = read.basket.rows.find((row) => row.name.includes("Kana-nuudlisupp"))!;
    lose = true;
    await expect(runner.run({ action: "set_basket_quantity", operationId: "remove-lost", observationRef: read.observationRef, targetRef: target.ref, expectedQuantity: 1, quantity: 0 })).rejects.toThrow("outcome_unknown");
    expect((await runner.run({ action: "reconcile_operation", operationId: "remove-lost" }) as { status: string }).status).toBe("verified");
    expect(fixture.minusClicks).toBe(1);
  });
});
