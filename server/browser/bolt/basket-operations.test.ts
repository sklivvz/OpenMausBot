import { describe, expect, it } from "vitest";
import { BoltBasketOperations, type BoltBasketSnapshot } from "./basket-operations.ts";
import { BASKET_FIXTURE_EVIDENCE, BasketFixture } from "./basket-fixture.ts";

const PADS = "Selver, Vatipadjad, ümmargused, 80 tk";

function makeOperations(fixture: BasketFixture, options: { timeoutMs?: number; pollMs?: number } = {}) {
  return new BoltBasketOperations(fixture.transport, { timeoutMs: options.timeoutMs ?? 500, pollMs: options.pollMs ?? 5 });
}

async function controlFor(operations: BoltBasketOperations, name: string) {
  const controls = await operations.readAddControls();
  const found = controls.filter((control) => control.name === name);
  expect(found).toHaveLength(1);
  return found[0];
}

function quantities(snapshot: BoltBasketSnapshot): Record<string, number> {
  return Object.fromEntries(snapshot.rows.map((row) => [row.name, row.quantity]));
}

function lineFor(snapshot: BoltBasketSnapshot, name: string, comment: string | null = null) {
  return snapshot.rows.find((row) => row.name === name && row.comment === comment);
}

describe("atomic Bolt basket operations on recorded-shape fixtures", () => {
  it("does not infer an empty basket when fallback navigation exposes no basket state", async () => {
    const fixture = new BasketFixture({ start: "menu", lines: [], hideEmptyBasketEntry: true });
    const operations = new BoltBasketOperations({ ...fixture.transport, navigate: async () => {} }, { timeoutMs: 20, pollMs: 2 });
    await expect(operations.open()).rejects.toThrow("verification_incomplete_reconcile_required");
    expect(fixture.addClicks).toBe(0);
  });

  it("does not derive a checkout route from an unrelated page", async () => {
    const fixture = new BasketFixture({ start: "menu", lines: [], hideEmptyBasketEntry: true });
    fixture.window.history.replaceState({}, "", "https://food.bolt.eu/");
    let navigated = false;
    const operations = new BoltBasketOperations({ ...fixture.transport, navigate: async () => { navigated = true; } });
    await expect(operations.open()).rejects.toThrow("basket_entry_not_found");
    expect(navigated).toBe(false);
  });

  it("reads exact scoped rows with extended line totals and records provider/basis unknowns", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const snapshot = await makeOperations(fixture).read();

    expect(snapshot.open).toBe(true);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.errors).toEqual([]);
    expect(snapshot.observedCounters).toBe(3);
    expect(snapshot.checkoutId).toBe("200420");
    expect(snapshot.branchId).toBe("200420");
    expect(snapshot.basketTotalMinor).toBe(842);
    expect(snapshot.basketTotalSource).toBe("basket_button");
    expect(snapshot.basketEntry?.testId).toBe("components.MainNavigationMenu.viewBasketButton");
    expect(snapshot.rows).toHaveLength(3);

    const yogurt = snapshot.rows.filter((row) => row.name === "Tere, Kreeka jogurt maitsestamata, 350 g");
    expect(yogurt.map((row) => [row.quantity, row.comment, row.priceMinor, row.priceText, row.priceBasis, row.unitPriceMinor])).toEqual([
      [2, null, 352, "3,52 €", "line_total", null],
      [1, "lactose free", 176, "1,76 €", "line_total", null],
    ]);
    expect(new Set(yogurt.map((row) => row.ref)).size).toBe(2);
    expect(snapshot.rows.every((row) => row.providerItemId === null)).toBe(true);
    expect(snapshot.rows.every((row) => row.priceProvenance === "total_price_or_original_price")).toBe(true);
    expect(snapshot.rows.every((row) => row.observedTestIds.includes("components.CheckoutItem.checkoutItemCounter"))).toBe(true);
    expect(snapshot.rows.every((row) => row.controls.plus?.text === "structural")).toBe(true);
    expect(snapshot.unknowns).toEqual(expect.arrayContaining(["provider_item_id_not_observed", "line_total_may_be_original_price"]));
    expect(BASKET_FIXTURE_EVIDENCE.e04).toContain("024893db-c1c5-4665-ae32-5f886ce3120d");
    expect(BASKET_FIXTURE_EVIDENCE.bundle).toContain("index-6c9f5a");
  });

  it("opens the basket from the observed main navigation control while other view entries coexist", async () => {
    const fixture = new BasketFixture({ start: "menu" });
    const operations = makeOperations(fixture);
    const before = await operations.read();
    expect(before.open).toBe(false);
    expect(before.rows).toEqual([]);
    expect(before.basketEntry?.testId).toBe("components.MainNavigationMenu.viewBasketButton");

    const result = await operations.open();
    expect(result.status).toBe("verified");
    expect(result.alreadyOpen).toBe(false);
    expect(result.effectDispatched).toBe(true);
    expect(result.after.open).toBe(true);
    expect(result.after.rows).toHaveLength(3);
    expect(fixture.basketMainClicks).toBe(1);
    expect(fixture.basketGroceryClicks).toBe(0);
    expect(fixture.basketStickyClicks).toBe(0);
    expect(operations.effectsDispatched).toBe(1);
  });

  it("opens a uniquely labelled basket button without a test id or price", async () => {
    const fixture = new BasketFixture({ start: "menu", lines: [] });
    const buttons = [...fixture.window.document.querySelectorAll("[data-action^=basket-]")];
    for (const button of buttons.slice(1)) button.remove();
    buttons[0]!.removeAttribute("data-testid");
    buttons[0]!.textContent = "View basket";
    const operations = makeOperations(fixture);
    expect((await operations.read()).basketEntry).toMatchObject({ testId: "accessible:view-basket", priceMinor: null });
    expect((await operations.open()).after.emptyBasket).toBe(true);
    expect(fixture.basketMainClicks).toBe(1);
  });

  it("does not choose between ambiguous labelled basket buttons", async () => {
    const fixture = new BasketFixture({ start: "menu", lines: [] });
    for (const button of fixture.window.document.querySelectorAll("[data-action^=basket-]")) button.removeAttribute("data-testid");
    const operations = makeOperations(fixture);
    expect((await operations.read()).errors).toContain("basket_entry_ambiguous");
    await expect(operations.open()).rejects.toThrow();
    expect(fixture.clicks).toEqual([]);
  });

  it("returns a no-op open result when the checkout is already open", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const result = await makeOperations(fixture).open();
    expect(result.alreadyOpen).toBe(true);
    expect(result.effectDispatched).toBe(false);
    expect(fixture.clicks).toEqual([]);
  });

  it("adds one simple grocery, proves the exact basket delta, then increases, decreases and removes the intended line", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const operations = makeOperations(fixture);
    const baseline = await operations.read();
    const baselineQuantities = quantities(baseline);

    fixture.showMenu();
    const pads = await controlFor(operations, PADS);
    expect(pads.quantity).toBe(1);
    expect(pads.quantitySource).toBe("aria_label");
    expect(pads.priceMinor).toBe(167);
    expect(pads.priceBasis).toBe("add_total");
    expect(pads.priceSource).toBe("control");
    expect(pads.asUpdate).toBe(false);

    const added = await operations.add({ controlRef: pads.ref, expectedName: PADS, baseline });
    expect(added.status).toBe("verified");
    expect(added.effectDispatched).toBe(true);
    expect(added.baseline).toBe("observed");
    expect(added.changed).toMatchObject({ name: PADS, from: 0, to: 1, addedQuantity: 1 });
    expect(added.total).toMatchObject({ beforeMinor: 842, afterMinor: 1009, lineDeltaMinor: 167, observedDeltaMinor: 167, verified: true });
    expect(added.preservedRows).toBe(true);
    expect(quantities(added.after)).toMatchObject(baselineQuantities);
    const addedLine = additionsLine(added.after);
    expect(addedLine.quantity).toBe(1);
    expect(addedLine.priceMinor).toBe(167);
    expect(fixture.addClicks).toBe(1);

    const increased = await operations.setQuantity({ lineRef: addedLine.ref, expectedQuantity: 1, quantity: 3 });
    expect(increased.status).toBe("verified");
    expect(increased.changed).toMatchObject({ from: 1, to: 3 });
    expect(increased.after.rows.find((row) => row.name === PADS)?.quantity).toBe(3);
    expect(increased.after.rows.find((row) => row.name === PADS)?.priceMinor).toBe(501);
    expect(quantities(increased.after)).toMatchObject({ ...baselineQuantities, [PADS]: 3 });
    expect(increased.total).toMatchObject({ lineDeltaMinor: 334, observedDeltaMinor: 334, verified: true });
    expect(fixture.plusClicks).toBe(2);

    const decreased = await operations.setQuantity({ lineRef: includedRef(increased.after, PADS), expectedQuantity: 3, quantity: 1 });
    expect(decreased.changed).toMatchObject({ from: 3, to: 1 });
    expect(decreased.after.rows.find((row) => row.name === PADS)?.priceMinor).toBe(167);
    expect(quantities(decreased.after)).toMatchObject({ ...baselineQuantities, [PADS]: 1 });
    expect(decreased.total).toMatchObject({ lineDeltaMinor: -334, observedDeltaMinor: -334, verified: true });
    expect(fixture.minusClicks).toBe(2);

    const removed = await operations.setQuantity({ lineRef: includedRef(decreased.after, PADS), expectedQuantity: 1, quantity: 0 });
    expect(removed.changed).toMatchObject({ from: 1, to: 0 });
    expect(removed.after.rows.some((row) => row.name === PADS)).toBe(false);
    expect(quantities(removed.after)).toEqual(baselineQuantities);
    expect(removed.total).toMatchObject({ lineDeltaMinor: -167, observedDeltaMinor: -167, verified: true });
    expect(removed.preservedRows).toBe(true);
    expect(fixture.minusClicks).toBe(3);

    const reread = await operations.read();
    expect(quantities(reread)).toEqual(baselineQuantities);
    expect(reread.basketTotalMinor).toBe(842);
  });

  it("keeps the line ref stable across a legitimate quantity change at quantity above one", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const operations = makeOperations(fixture);
    const before = await operations.read();
    const target = lineFor(before, "Tere, Kreeka jogurt maitsestamata, 350 g", null)!;
    expect(target.quantity).toBe(2);
    expect(target.priceMinor).toBe(352);

    const result = await operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 3 });
    const after = result.after.rows.find((row) => row.ref === target.ref)!;
    expect(after.ref).toBe(target.ref);
    expect(after.quantity).toBe(3);
    expect(after.priceMinor).toBe(528);
    expect(result.total).toMatchObject({ lineDeltaMinor: 176, observedDeltaMinor: 176, verified: true });
  });

  it("edits only the intended same-name line and leaves the other comment-distinct row untouched", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const operations = makeOperations(fixture);
    const before = await operations.read();
    const target = before.rows.find((row) => row.comment === "lactose free");
    expect(target).toBeDefined();
    const other = before.rows.find((row) => row.name === target!.name && row.comment === null);
    expect(other?.quantity).toBe(2);

    const result = await operations.setQuantity({ lineRef: target!.ref, expectedQuantity: 1, quantity: 2 });
    expect(result.after.rows.find((row) => row.ref === target!.ref)?.quantity).toBe(2);
    expect(result.after.rows.find((row) => row.ref === other!.ref)?.quantity).toBe(2);
    expect(result.after.rows.find((row) => row.name === "Selveri Köök, Kana-nuudlisupp, 400 g")?.quantity).toBe(1);
    expect(result.total).toMatchObject({ beforeMinor: 842, afterMinor: 1018, lineDeltaMinor: 176, observedDeltaMinor: 176, verified: true });
  });

  it("refuses an ambiguous duplicate basket line before dispatching any effect", async () => {
    const fixture = new BasketFixture({ start: "checkout", duplicateCommentLine: true });
    const operations = makeOperations(fixture);
    const snapshot = await operations.read();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.rows.filter((row) => row.ambiguous)).toHaveLength(2);
    const ambiguous = snapshot.rows.find((row) => row.ambiguous)!;

    await expect(operations.setQuantity({ lineRef: ambiguous.ref, expectedQuantity: 1, quantity: 2 })).rejects.toMatchObject({ code: "basket_line_ambiguous" });
    expect(fixture.clicks).toEqual([]);
    expect(fixture.plusClicks).toBe(0);
  });

  it("refuses a target when the plus control cannot be uniquely discovered", async () => {
    const fixture = new BasketFixture({ start: "checkout", plusAmbiguous: true });
    const operations = makeOperations(fixture);
    const snapshot = await operations.read();
    const target = snapshot.rows.find((row) => row.quantity === 2)!;
    expect(target.controls.plus).toBeNull();
    expect(target.warnings).toContain("quantity_plus_ambiguous");

    await expect(operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 3 })).rejects.toMatchObject({ code: "quantity_increase_control_ambiguous" });
    expect(fixture.plusClicks).toBe(0);
    expect(fixture.clicks).toEqual([]);
  });

  it("accepts the bundle-derived plus test id when it is present, without treating it as an item id", async () => {
    const fixture = new BasketFixture({ start: "checkout", plusTestId: true });
    const operations = makeOperations(fixture);
    const snapshot = await operations.read();
    const target = snapshot.rows.find((row) => row.quantity === 2)!;
    expect(target.controls.plus?.text).toBe("testid");
    const result = await operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 3 });
    expect(result.after.rows.find((row) => row.ref === target.ref)?.quantity).toBe(3);
    expect(fixture.plusClicks).toBe(1);
    expect(fixture.clicks[0]?.testId).toBe("components.CheckoutItem.checkoutItemCounter.plus");
  });

  it("refuses the Update control before adding and refuses when the observed add price is unknown", async () => {
    const fixture = new BasketFixture({ start: "menu" });
    const operations = makeOperations(fixture);
    const yogurt = await controlFor(operations, "Tere, Kreeka jogurt maitsestamata, 350 g");
    expect(yogurt.asUpdate).toBe(true);
    await expect(operations.add({ controlRef: yogurt.ref, expectedName: yogurt.name! })).rejects.toMatchObject({ code: "add_control_is_update" });
    expect(fixture.addClicks).toBe(0);

    const mysteryFixture = new BasketFixture({ start: "menu", mysteryProduct: true });
    const mysteryOps = makeOperations(mysteryFixture);
    const mystery = await controlFor(mysteryOps, "Mystery item");
    expect(mystery.priceMinor).toBeNull();
    await expect(mysteryOps.add({ controlRef: mystery.ref, expectedName: "Mystery item" })).rejects.toMatchObject({ code: "add_price_unknown" });
    expect(mysteryFixture.addClicks).toBe(0);
  });

  it("falls back to the recorded product label price when the Add control has no price", async () => {
    const fixture = new BasketFixture({ start: "menu", noControlPrice: true });
    const control = await controlFor(makeOperations(fixture), PADS);
    expect(control.priceMinor).toBe(167);
    expect(control.priceSource).toBe("product_label");
    expect(control.asUpdate).toBe(false);
    expect(control.quantity).toBe(1);
    expect(control.quantitySource).toBe("aria_label");
  });

  it("adds the observed configured quantity and verifies that exact quantity delta", async () => {
    const fixture = new BasketFixture({ start: "checkout", addQuantity: 2 });
    const operations = makeOperations(fixture);
    const baseline = await operations.read();
    fixture.showMenu();
    const pads = await controlFor(operations, PADS);
    expect(pads.quantity).toBe(2);
    expect(pads.priceMinor).toBe(334);

    const added = await operations.add({ controlRef: pads.ref, expectedName: PADS, baseline });
    expect(added.changed).toMatchObject({ from: 0, to: 2, addedQuantity: 2 });
    expect(added.after.rows.find((row) => row.name === PADS)?.quantity).toBe(2);
    expect(added.after.rows.find((row) => row.name === PADS)?.priceMinor).toBe(334);
    expect(added.total).toMatchObject({ lineDeltaMinor: 334, observedDeltaMinor: 334, verified: true });
    expect(fixture.addClicks).toBe(1);
  });

  it("adds to an explicitly empty basket even when no basket-entry total exists", async () => {
    const fixture = new BasketFixture({ start: "checkout", lines: [], hideEmptyBasketEntry: true });
    const operations = makeOperations(fixture);
    const baseline = await operations.read();
    expect(baseline.open).toBe(true);
    expect(baseline.emptyBasket).toBe(true);
    expect(baseline.complete).toBe(true);
    expect(baseline.rows).toEqual([]);
    expect(baseline.basketTotalMinor).toBeNull();
    expect(baseline.basketTotalSource).toBe("empty_basket");

    fixture.showMenu();
    expect((await operations.read()).basketEntry).toBeNull();
    const pads = await controlFor(operations, PADS);
    const added = await operations.add({ controlRef: pads.ref, expectedName: PADS, baseline });
    expect(added.status).toBe("verified");
    expect(added.baseline).toBe("empty_basket");
    expect(added.changed).toMatchObject({ from: 0, to: 1, addedQuantity: 1 });
    expect(added.total).toMatchObject({ beforeMinor: 0, afterMinor: 167, lineDeltaMinor: 167, observedDeltaMinor: 167, verified: true });
    expect(added.preservedRows).toBe(true);
  });

  it("returns a limited result, not a fabricated initial quantity, when no baseline was observed", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const operations = makeOperations(fixture);
    fixture.showMenu();
    const pads = await controlFor(operations, PADS);
    const added = await operations.add({ controlRef: pads.ref, expectedName: PADS });
    expect(added.status).toBe("verified_limited");
    expect(added.baseline).toBe("unknown");
    expect(added.changed.from).toBeNull();
    expect(added.changed.to).toBe(1);
    expect(added.preservedRows).toBe("unknown");
    expect(added.total.observedDeltaMinor).toBe(167);
    expect(added.warnings).toContain("baseline_absent_current_quantity_unknown");
  });

  it("refuses an add when the basket total changed after the baseline observation", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const operations = makeOperations(fixture);
    const baseline = await operations.read();
    fixture.lines[0].quantity++;
    fixture.showMenu();
    const pads = await controlFor(operations, PADS);

    await expect(operations.add({ controlRef: pads.ref, expectedName: PADS, baseline })).rejects.toMatchObject({ code: "basket_changed_before_add" });
    expect(fixture.addClicks).toBe(0);
  });

  it("marks a malformed row incomplete and blocks mutation instead of treating the basket as empty or complete", async () => {
    const fixture = new BasketFixture({ start: "checkout", malformedRow: true });
    const operations = makeOperations(fixture);
    const snapshot = await operations.read();
    expect(snapshot.complete).toBe(false);
    expect(snapshot.rows).toHaveLength(3);
    expect(snapshot.observedCounters).toBe(4);
    expect(snapshot.errors).toEqual(expect.arrayContaining(["row_container_missing"]));
    expect(snapshot.emptyBasket).toBe(false);
    const target = snapshot.rows.find((row) => row.quantity === 2)!;

    await expect(operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 3 })).rejects.toMatchObject({ code: "basket_observation_incomplete" });
    expect(fixture.clicks).toEqual([]);
  });

  it("records a parsed zero-quantity row as a removed fact without blocking the remaining basket", async () => {
    const fixture = new BasketFixture({ start: "checkout", zeroQuantityRow: true });
    const operations = makeOperations(fixture);
    const snapshot = await operations.read();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.rows).toHaveLength(3);
    expect(snapshot.zeroQuantityRows).toBe(1);
    expect(snapshot.observedCounters).toBe(4);
    expect(snapshot.unknowns).toContain("zero_quantity_rows_present");
    expect(snapshot.rows.some((row) => row.name === "Removed fixture line")).toBe(false);
    const target = snapshot.rows.find((row) => row.quantity === 2)!;
    const result = await operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 1 });
    expect(result.after.rows.find((row) => row.ref === target.ref)?.quantity).toBe(1);
    expect(result.after.zeroQuantityRows).toBe(1);
  });

  it("refuses an add whose baseline row set is incomplete", async () => {
    const incomplete = new BasketFixture({ start: "checkout", malformedRow: true });
    const operations = makeOperations(incomplete);
    const baseline = await operations.read();
    incomplete.showMenu();
    const pads = await controlFor(operations, PADS);
    await expect(operations.add({ controlRef: pads.ref, expectedName: PADS, baseline })).rejects.toMatchObject({ code: "basket_baseline_incomplete" });
    expect(incomplete.addClicks).toBe(0);
  });

  it("refuses a decrease when the discovered minus control is disabled", async () => {
    const fixture = new BasketFixture({ start: "checkout", minusDisabledAtOne: true });
    const operations = makeOperations(fixture);
    const snapshot = await operations.read();
    const target = snapshot.rows.find((row) => row.quantity === 1 && row.comment)!;
    expect(target.controls.minus.enabled).toBe(false);

    await expect(operations.setQuantity({ lineRef: target.ref, expectedQuantity: 1, quantity: 0 })).rejects.toMatchObject({ code: "quantity_decrease_control_disabled" });
    expect(fixture.minusClicks).toBe(0);
    expect(fixture.clicks).toEqual([]);
  });

  it("does not replay an add whose outcome is not observed", async () => {
    const fixture = new BasketFixture({ start: "checkout", ignoreAdd: true });
    const operations = makeOperations(fixture, { timeoutMs: 60, pollMs: 5 });
    const baseline = await operations.read();
    fixture.showMenu();
    const pads = await controlFor(operations, PADS);

    await expect(operations.add({ controlRef: pads.ref, expectedName: PADS, baseline })).rejects.toMatchObject({ code: "verification_incomplete_reconcile_required" });
    expect(fixture.addClicks).toBe(1);
  });

  it("runs the journal hooks before and after each dispatched effect", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const seen: string[] = [];
    const operations = new BoltBasketOperations(fixture.transport, {
      timeoutMs: 500,
      pollMs: 5,
      hooks: {
        beforeEffect: (effect) => { seen.push(`before:${effect.kind}:${fixture.plusClicks}:${fixture.clicks.length}`); },
        afterEffect: (effect, outcome) => { seen.push(`after:${effect.kind}:${outcome}`); },
      },
    });
    const snapshot = await operations.read();
    const target = snapshot.rows.find((row) => row.quantity === 2)!;
    await operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 3 });
    expect(seen).toEqual(["before:increase_quantity:0:0", "after:increase_quantity:dispatched"]);
  });

  it("does not replay a quantity change whose outcome is not observed", async () => {
    const fixture = new BasketFixture({ start: "checkout", ignorePlus: true });
    const operations = makeOperations(fixture, { timeoutMs: 60, pollMs: 5 });
    const snapshot = await operations.read();
    const target = snapshot.rows.find((row) => row.quantity === 2)!;

    await expect(operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 3 })).rejects.toMatchObject({ code: "verification_incomplete_reconcile_required" });
    expect(fixture.plusClicks).toBe(1);
  });

  it("edits one row without requiring a complete checkout or a basket-total control", async () => {
    const fixture = new BasketFixture({ start: "checkout", hideBasketEntry: true });
    const operations = makeOperations(fixture);
    const snapshot = await operations.read();
    expect(snapshot.complete).toBe(true);
    expect(snapshot.basketTotalMinor).toBeNull();
    expect(snapshot.rows).toHaveLength(3);
    const target = snapshot.rows.find((row) => row.quantity === 2)!;
    const result = await operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 1 });
    expect(result.status).toBe("verified_limited");
    expect(result.after.rows.find((row) => row.ref === target.ref)?.quantity).toBe(1);
    expect(result.total.observedDeltaMinor).toBeNull();
    expect(result.warnings).toContain("basket_total_unavailable");
  });

  it("returns a verified no-op without dispatching for an unchanged quantity", async () => {
    const fixture = new BasketFixture({ start: "checkout" });
    const operations = makeOperations(fixture);
    const snapshot = await operations.read();
    const target = snapshot.rows.find((row) => row.quantity === 2)!;
    const result = await operations.setQuantity({ lineRef: target.ref, expectedQuantity: 2, quantity: 2 });
    expect(result.effectDispatched).toBe(false);
    expect(result.warnings).toContain("quantity_unchanged");
    expect(fixture.clicks).toEqual([]);
  });
});

function includedRef(snapshot: BoltBasketSnapshot, name: string): string {
  const row = snapshot.rows.find((candidate) => candidate.name === name);
  expect(row).toBeDefined();
  return row!.ref;
}

function additionsLine(snapshot: BoltBasketSnapshot) {
  const row = snapshot.rows.find((candidate) => candidate.name === PADS);
  expect(row).toBeDefined();
  return row!;
}
