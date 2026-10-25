import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOLT_INPUT, type BoltInput, type BoltView } from "./contracts.ts";
import { BoltRunner, checkoutHash, type BoltPort } from "./runner.ts";
import { BoltJournal, digest } from "./state.ts";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function view(): BoltView {
  return {
    session: { signedIn: true, account: "fixture-user" }, branchId: "123", address: "Fixture address", overlay: "product", authenticationRequired: false,
    controls: { pay: "pay", openBasket: "openBasket", search: "search" },
    item: { ref: "item", id: "meal", name: "Fixture meal", mode: "new", quantity: 1, unitPriceMinor: 650,
      groups: [
        { ref: "size", id: "size", label: "Size", min: 1, max: 1, mode: "single", choices: [
          { ref: "small", id: "small", label: "Small", available: true, selected: true, priceMinor: 0, control: "small" },
          { ref: "large", id: "large", label: "Large", available: true, selected: false, priceMinor: 200, control: "large" },
        ] },
        { ref: "extras", id: "extras", label: "Extras", min: 0, max: 2, mode: "multiple", choices: [
          { ref: "cheese", id: "cheese", label: "Cheese", available: true, selected: false, priceMinor: 100, control: "cheese" },
          { ref: "remove-onion", id: "remove-onion", label: "Remove onion", available: true, selected: false, priceMinor: 0, control: "remove-onion" },
        ] },
        { ref: "sauce", id: "sauce", label: "Sauce", min: 0, max: 3, mode: "quantity", choices: [
          { ref: "dip", id: "dip", label: "Dip", available: true, selected: false, priceMinor: 50, quantity: 0, maxQuantity: 3, control: "dip", plus: "dip-plus", minus: "dip-minus" },
        ] },
      ],
      comment: { supported: true, text: "", maxLength: 200, input: "comment" }, plus: "plus", minus: "minus", add: "add", close: "close",
    },
    basket: [],
    deliveryOptions: Array.from({ length: 4 }, (_, index) => ({ ref: `delivery-${index}`, id: `delivery-${index}`, label: `Choice ${index}`, feeMinor: 100 + index * 100, eta: `${20 - index * 3} min`, available: true, selected: index === 0, control: `delivery-${index}` })),
  };
}

function fixture(initial = view()) {
  const directory = mkdtempSync(join(tmpdir(), "bolt-runner-"));
  directories.push(directory);
  const state = structuredClone(initial);
  const journal = new BoltJournal(directory);
  const port: BoltPort = {
    guard: vi.fn(),
    read: vi.fn(async () => ({ url: "https://food.bolt.eu/en/1-fixture/p/123/", view: structuredClone(state), observationRef: digest(state) })),
    navigate: vi.fn(async () => {}),
    fill: vi.fn(async (ref, text) => { if (ref === "comment") state.item!.comment.text = text; }),
    click: vi.fn(async (ref) => {
      if (ref === "plus") state.item!.quantity++;
      else if (ref === "minus") state.item!.quantity--;
      else if (ref === "dip-plus") state.item!.groups[2].choices[0].quantity!++;
      else if (ref === "dip-minus") state.item!.groups[2].choices[0].quantity!--;
      else if (ref.startsWith("delivery-")) state.deliveryOptions!.forEach((choice) => choice.selected = choice.ref === ref);
      else if (ref === "pay") state.order = { id: "fixture-order", state: "accepted", totalMinor: state.checkout!.totalMinor, account: state.checkout!.account, branchId: state.checkout!.branchId, destination: state.checkout!.destination, lines: structuredClone(state.checkout!.lines) };
      else if (ref === "add") {
        const item = state.item!;
        state.basket!.push({ ref: "basket.0", id: item.id, name: item.name, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, comment: item.comment.text, options: item.groups.flatMap((group) => group.choices.filter((choice) => group.mode === "quantity" ? choice.quantity! > 0 : choice.selected).map((choice) => ({ groupId: group.id, groupLabel: group.label, choiceId: choice.id, choiceLabel: choice.label, quantity: group.mode === "quantity" ? choice.quantity! : 1 }))) });
      } else {
        for (const group of state.item!.groups) {
          const choice = group.choices.find((candidate) => candidate.ref === ref);
          if (choice) {
            if (group.mode === "single") group.choices.forEach((candidate) => candidate.selected = false);
            choice.selected = !choice.selected;
          }
        }
      }
    }),
  };
  const authority = { verify: vi.fn(async () => {}) };
  const runner = new BoltRunner(port, journal, authority);
  const input = (action: BoltInput["action"], fields: Partial<BoltInput> = {}): BoltInput => ({ action, observationRef: digest(state), operationId: `op-${Object.keys(journal.read()).length}`, ...fields });
  return { state, journal, port, runner, authority, input };
}

const selections = [
  { groupRef: "size", choices: [{ choiceRef: "large", quantity: 1 }] },
  { groupRef: "extras", choices: [{ choiceRef: "remove-onion", quantity: 1 }] },
  { groupRef: "sauce", choices: [{ choiceRef: "dip", quantity: 2 }] },
];

function checkout(state: BoltView) {
  state.checkout = { account: "fixture-user", branchId: "123", currency: "EUR", destination: "Fixture address", fulfilment: "delivery", deliveryOptionId: "delivery-0", deliveryLabel: "Choice 0", deliveryEta: "20 min", paymentMethod: "Fixture card", courierComment: "Door 2", lines: [{ ref: "basket.0", id: "meal", name: "Meal", quantity: 1, unitPriceMinor: 650, options: [], comment: "No onions" }], subtotalMinor: 650, adjustments: [{ label: "Delivery", amountMinor: 200 }, { label: "Discount", amountMinor: -100 }], totalMinor: 750 };
}

describe("Bolt mechanical operations", () => {
  it("rejects bot approval booleans and arbitrary selector input", () => {
    expect(BOLT_INPUT.strict().safeParse({ action: "pay", approved: true }).success).toBe(false);
    expect(BOLT_INPUT.strict().safeParse({ action: "set_item_options", selector: "button" }).success).toBe(false);
  });

  it("selects required choices, ingredient removal and counted extras, verifying each click", async () => {
    const f = fixture();
    const result = await f.runner.run(f.input("set_item_options", { selections }));
    expect(result.status).toBe("verified");
    expect(f.state.item!.groups[0].choices.map((choice) => choice.selected)).toEqual([false, true]);
    expect(f.state.item!.groups[1].choices[1].selected).toBe(true);
    expect(f.state.item!.groups[2].choices[0].quantity).toBe(2);
    expect(f.port.click).toHaveBeenCalledTimes(4);
  });

  it.each([
    [{ ...selections[0], choices: [] }, ...selections.slice(1)],
    [selections[0], selections[1]],
    [selections[0], selections[1], { groupRef: "sauce", choices: [{ choiceRef: "dip", quantity: 4 }] }],
    [selections[0], selections[1], { groupRef: "sauce", choices: [{ choiceRef: "invented", quantity: 1 }] }],
  ])("rejects invalid complete option selections before any effect: %j", async (...value) => {
    const f = fixture();
    await expect(f.runner.run(f.input("set_item_options", { selections: value as BoltInput["selections"] }))).rejects.toThrow();
    expect(f.port.click).not.toHaveBeenCalled();
    expect(f.journal.read()).toEqual({});
  });

  it("rejects unavailable choices", async () => {
    const f = fixture();
    f.state.item!.groups[0].choices[1].available = false;
    await expect(f.runner.run(f.input("set_item_options", { selections }))).rejects.toThrow("choice_unavailable");
    expect(f.port.click).not.toHaveBeenCalled();
  });

  it("preserves item comments and options when adding the exact line", async () => {
    const f = fixture();
    await f.runner.run(f.input("set_item_options", { selections }));
    await f.runner.run(f.input("set_item_comment", { text: "No salt, please" }));
    await f.runner.run(f.input("set_product_quantity", { quantity: 2, expectedQuantity: 1 }));
    const input = f.input("add_configured_product");
    const result = await f.runner.run(input);
    expect(result.status).toBe("verified");
    expect(f.state.basket![0]).toMatchObject({ comment: "No salt, please", quantity: 2, options: [{ groupId: "size", choiceId: "large", quantity: 1 }, { groupId: "extras", choiceId: "remove-onion", quantity: 1 }, { groupId: "sauce", choiceId: "dip", quantity: 2 }] });
    const calls = vi.mocked(f.port.click).mock.calls.length;
    await f.runner.run(input);
    expect(f.port.click).toHaveBeenCalledTimes(calls);
  });

  it("keeps unsupported and oversized comments out of the cart", async () => {
    const f = fixture();
    await expect(f.runner.run(f.input("set_item_comment", { text: "x".repeat(201) }))).rejects.toThrow("comment_length_invalid");
    f.state.item!.comment.supported = false;
    await expect(f.runner.run(f.input("set_item_comment", { text: "No salt" }))).rejects.toThrow("item_comment_unsupported");
    expect(f.port.fill).not.toHaveBeenCalled();
  });

  it("uses all four observed delivery choices without assuming names", async () => {
    const f = fixture();
    await f.runner.run(f.input("select_delivery_option", { targetRef: "delivery-3" }));
    expect(f.state.deliveryOptions!.filter((choice) => choice.selected).map((choice) => choice.id)).toEqual(["delivery-3"]);
    expect(f.port.click).toHaveBeenCalledExactlyOnceWith("delivery-3");
  });

  it("rejects a stale delivery quote and quantity precondition", async () => {
    const f = fixture();
    const input = f.input("select_delivery_option", { targetRef: "delivery-3" });
    f.state.deliveryOptions![3].feeMinor = (f.state.deliveryOptions![3].feeMinor ?? 0) + 1;
    await expect(f.runner.run(input)).rejects.toThrow("stale_observation");
    await expect(f.runner.run(f.input("set_product_quantity", { quantity: 3, expectedQuantity: 2 }))).rejects.toThrow("quantity_precondition_failed");
    expect(f.port.click).not.toHaveBeenCalled();
  });

  it("dispatches search with input-only evidence and does not claim fresh results", async () => {
    const f = fixture();
    f.state.search = "old";
    f.state.searchResultQuery = "old";
    f.state.searchPending = false;
    f.state.products = [];
    f.port.fill = vi.fn(async (_ref, value) => { f.state.search = value; f.state.searchPending = true; });
    const result = await f.runner.run(f.input("search_branch", { query: "soup" })) as { status: string; verification?: string; searchResults?: string };
    expect(result.status).toBe("dispatched");
    expect(result.verification).toBe("input_only");
    expect(result.searchResults).toBe("unknown");
  });

  it("refuses a branch change while the recorded basket is still loading", async () => {
    const f = fixture();
    delete f.state.basket;
    f.state.basketState = { loading: true, ready: false, rowsAvailable: false };
    await expect(f.runner.run(f.input("open_branch", { branchUrl: "https://food.bolt.eu/en/1-fixture/p/456/" }))).rejects.toThrow("basket_still_loading");
    expect(f.port.navigate).not.toHaveBeenCalled();
  });

  it("persists an uncertain add and blocks retries under fresh IDs", async () => {
    const f = fixture();
    vi.mocked(f.port.click).mockRejectedValue(new Error("lost reply"));
    const input = f.input("add_configured_product");
    await expect(f.runner.run(input)).rejects.toThrow("outcome_unknown");
    const restarted = new BoltRunner(f.port, new BoltJournal(f.journal.directory));
    expect((await restarted.run(input)).status).toBe("pending");
    await expect(restarted.run(f.input("add_configured_product"))).rejects.toThrow("unresolved_operation");
    expect(f.port.click).toHaveBeenCalledTimes(1);
  });

  it("reconciles a successful add after its reply was lost without replay", async () => {
    const f = fixture();
    const original = f.port.click;
    f.port.click = vi.fn(async (ref) => { await original(ref); throw new Error("lost reply"); });
    const input = f.input("add_configured_product");
    await expect(f.runner.run(input)).rejects.toThrow("outcome_unknown");
    expect((await f.runner.run({ action: "reconcile_operation", operationId: input.operationId })).status).toBe("verified");
    expect(f.port.click).toHaveBeenCalledTimes(1);
  });

  it("requires host payment authority and binds approval to exact total, address, options and comments", async () => {
    const f = fixture();
    checkout(f.state);
    const runner = new BoltRunner(f.port, f.journal);
    await expect(runner.run(f.input("pay", { approvedCheckoutRef: "approval" }))).rejects.toThrow("trusted_checkout_approval_required");
    expect(f.port.click).not.toHaveBeenCalled();
    const expected = checkoutHash(f.state.checkout!);
    f.authority.verify.mockImplementation(async (_id?: string, hash?: string) => { if (hash !== expected) throw new Error("not approved"); });
    f.state.checkout!.lines[0].comment = "Changed";
    await expect(f.runner.run(f.input("pay", { approvedCheckoutRef: "approval" }))).rejects.toThrow("not approved");
    expect(f.port.click).not.toHaveBeenCalled();
  });

  it("pays once, verifies the order, and never reuses an approval", async () => {
    const f = fixture();
    checkout(f.state);
    const input = f.input("pay", { approvedCheckoutRef: "approval" });
    expect((await f.runner.run(input)).status).toBe("verified");
    expect((await f.runner.run(input)).status).toBe("verified");
    await expect(f.runner.run(f.input("pay", { approvedCheckoutRef: "approval" }))).rejects.toThrow("approval_already_used");
    expect(f.port.click).toHaveBeenCalledExactlyOnceWith("pay");
  });

  it("rejects misleading checkout totals and a different signed-in account", async () => {
    const f = fixture();
    checkout(f.state);
    f.state.checkout!.totalMinor++;
    await expect(f.runner.run(f.input("pay", { approvedCheckoutRef: "approval" }))).rejects.toThrow("totals_do_not_reconcile");
    f.state.session!.account = "someone-else";
    await expect(f.runner.run(f.input("pay", { approvedCheckoutRef: "approval" }))).rejects.toThrow("identity_unverified");
    expect(f.port.click).not.toHaveBeenCalled();
  });

  it("preserves a durable pending payment if stopped before the click", async () => {
    const f = fixture();
    checkout(f.state);
    vi.mocked(f.port.guard).mockImplementation(() => { if (Object.keys(f.journal.read()).length) throw new Error("stopped"); });
    await expect(f.runner.run(f.input("pay", { approvedCheckoutRef: "approval" }))).rejects.toThrow("outcome_unknown");
    expect(f.port.click).not.toHaveBeenCalled();
    expect(Object.values(f.journal.read())[0].status).toBe("pending");
  });

  it("cannot lose the payment receipt through a prototype-named operation ID", async () => {
    const f = fixture();
    checkout(f.state);
    const input = f.input("pay", { operationId: "__proto__", approvedCheckoutRef: "approval" });
    await f.runner.run(input);
    await f.runner.run(input);
    expect(Object.hasOwn(f.journal.read(), "__proto__")).toBe(true);
    expect(f.port.click).toHaveBeenCalledTimes(1);
  });

  it("does not confuse editing an existing line with adding another", async () => {
    const f = fixture();
    f.state.item!.mode = "edit";
    await expect(f.runner.run(f.input("add_configured_product"))).rejects.toThrow("new_item_required_for_add");
    expect(f.port.click).not.toHaveBeenCalled();
  });

  it("distinguishes lines with different comments when a removal shifts their DOM refs", async () => {
    const f = fixture();
    f.state.basket = [
      { ref: "basket.0", id: "meal", name: "Meal", quantity: 1, unitPriceMinor: 650, options: [], comment: "No salt", minus: "first-minus" },
      { ref: "basket.1", id: "meal", name: "Meal", quantity: 1, unitPriceMinor: 650, options: [], comment: "Extra salt", minus: "second-minus" },
    ];
    f.port.click = vi.fn(async (ref) => {
      expect(ref).toBe("first-minus");
      f.state.basket!.shift();
      f.state.basket![0].ref = "basket.0";
    });
    expect((await f.runner.run(f.input("set_basket_quantity", { targetRef: "basket.0", expectedQuantity: 1, quantity: 0 }))).status).toBe("verified");
    expect(f.state.basket).toHaveLength(1);
    expect(f.state.basket[0].comment).toBe("Extra salt");
  });
});
