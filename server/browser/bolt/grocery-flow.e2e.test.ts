import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserRuntime, type BrowserSpawnSpec } from "../../browser-runtime.ts";
import { RuntimeRouter, type ChromeEngine } from "../engines.ts";
import { BoltFault, type BoltCheckout } from "./contracts.ts";
import { checkoutHash, type BoltPaymentAuthority } from "./runner.ts";

const PROFILE = "bot:qa-grocery";
const ORIGIN = "https://food.bolt.eu";
const BRANCH_URL = `${ORIGIN}/en/1-tallinn/p/28032-bolt-market-toompuiestee/`;
const SOUP = "Presto, Organic Pumpkin Puree Soup with Coconut Milk, 300g";
const JAM = "Meie Mari, Raspberry Jam, 310g";
const SEARCH = 'input[data-testid="screens.Provider.Menu.ProviderMenuStickySearch.searchInput.input"]';
const BASKET = 'button[data-testid="components.MainNavigationMenu.viewBasketButton"]';

const BINDINGS = {
  version: 1,
  evidence: "Vendor test ids from food.bolt.eu public bundle sha256 df909f20f08346d8f1345e5dd65c645b06e7225a65862ab6205a58e0965c5965; minimal host mapping for the disposable QA fixture.",
  root: {
    kind: "object",
    fields: {
      search: { kind: "text", selector: SEARCH, attribute: "value", first: true, optional: true },
      address: { kind: "text", selector: 'button[aria-label^="Delivery address "]', attribute: "aria-label", pattern: "^Delivery address\\s+(.+)$", group: 1, optional: true },
      products: {
        kind: "list",
        optional: true,
        selector: 'button[data-testid="components.GridMenuDishBase.view"]',
        item: {
          kind: "object",
          fields: {
            id: { kind: "text", attribute: "aria-label", pattern: "^,?\\s*(.+?)(?:,\\s*[0-9][0-9\\s.,]*€)?$", group: 1 },
            name: { kind: "text", attribute: "aria-label", pattern: "^,?\\s*(.+?)(?:,\\s*[0-9][0-9\\s.,]*€)?$", group: 1 },
            priceMinor: { kind: "money", attribute: "aria-label", pattern: "([0-9][0-9\\s.,]*€)\\s*$", group: 1, optional: true },
            open: { kind: "control" },
          },
        },
      },
      basketState: {
        kind: "object",
        optional: true,
        fields: {
          loading: { kind: "exists", selector: '[data-testid="screens.Groceries.GroceriesScreen.activeBasketButton.loading"]' },
          ready: { kind: "exists", selector: BASKET },
          rowsAvailable: { kind: "exists", selector: '[data-testid="components.CheckoutItem.checkoutItemCounter"]' },
          detail: { kind: "text", selector: BASKET, first: true, optional: true },
          control: { kind: "control", selector: BASKET, first: true, optional: true },
        },
      },
      controls: {
        kind: "object",
        fields: {
          search: { kind: "control", selector: SEARCH, first: true, optional: true },
          openBasket: { kind: "control", selector: BASKET, first: true, optional: true },
          add: { kind: "control", selector: '[data-testid="components.ProviderDish.addButton"]', optional: true },
          closeProduct: { kind: "control", selector: '[data-testid="screens.Provider.Dish.DishBottomSheet.closeButton"]', first: true, optional: true },
          pay: { kind: "control", selector: '[data-testid="screens.OnePageCheckout.confirmSimpleButton"]', optional: true },
        },
      },
    },
  },
};

type Call = {
  tool: string;
  arguments?: Record<string, unknown>;
  effect?: { kind?: string; key?: string };
  payClicks?: number;
};

type BoltResult = {
  raw: { isError?: boolean; content: Array<{ text: string }> };
  value: Record<string, unknown> & { status?: string; code?: string; receipt?: { operationId?: string; status?: string } };
};

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function authority() {
  const expected = new Map<string, string>();
  const used = new Set<string>();
  let issued = 0;
  return {
    scope: { kind: "host_browser_profile" as const, profileKey: PROFILE },
    requests: [] as Array<{ ref: string; hash: string }>,
    verifyCalls: [] as Array<{ ref: string; hash: string }>,
    async request(checkout: BoltCheckout) {
      const ref = `qa-approval-${++issued}`;
      const hash = checkoutHash(checkout);
      expected.set(ref, hash);
      this.requests.push({ ref, hash });
      return ref;
    },
    async verify(ref: string, hash: string) {
      this.verifyCalls.push({ ref, hash });
      if (used.has(ref)) throw new BoltFault("approval_already_used");
      const stored = expected.get(ref);
      if (!stored) throw new BoltFault("approval_unknown");
      if (stored !== hash) throw new BoltFault("checkout_quote_changed");
      used.add(ref);
    },
  } satisfies BoltPaymentAuthority & {
    scope: { kind: "host_browser_profile"; profileKey: string };
    requests: Array<{ ref: string; hash: string }>;
    verifyCalls: Array<{ ref: string; hash: string }>;
  };
}

function setup(env: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "bolt-grocery-"));
  const callLog = join(directory, "calls.jsonl");
  const bindingsPath = join(directory, "browser", "bolt", "dom-bindings.json");
  mkdirSync(dirname(bindingsPath), { recursive: true });
  writeFileSync(bindingsPath, JSON.stringify(BINDINGS));
  const spec: BrowserSpawnSpec = {
    command: process.execPath,
    args: [join(process.cwd(), "server", "testing", "fake-bolt-grocery.mjs")],
    env: { PATH: process.env.PATH ?? "", BOLT_CALL_LOG: callLog, ...env },
  };
  const runtime = new BrowserRuntime({ requestTimeoutMs: 8_000, takeoverTimeoutMs: 100, idleMs: 60_000 });
  const payment = authority();
  const router = new RuntimeRouter(runtime, {} as ChromeEngine, { dataDir: directory });
  cleanups.push(async () => {
    await runtime.closeAll();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    runtime,
    router,
    spec,
    payment,
    directory,
    calls: () => {
      if (!existsSync(callLog)) return [] as Call[];
      return readFileSync(callLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Call);
    },
  };
}

async function callBolt(router: RuntimeRouter, spec: BrowserSpawnSpec, payment: BoltPaymentAuthority, args: Record<string, unknown>): Promise<BoltResult> {
  const raw = await router.agentRpc("qa-grocery", spec, "tools/call", { name: "agent_browser_bolt", arguments: args }, undefined, undefined, payment) as BoltResult["raw"];
  let value: BoltResult["value"];
  try {
    value = JSON.parse(raw.content[0]!.text) as BoltResult["value"];
  } catch {
    value = { text: raw.content[0]?.text } as BoltResult["value"];
  }
  return { raw, value };
}

async function ok(router: RuntimeRouter, spec: BrowserSpawnSpec, payment: BoltPaymentAuthority, args: Record<string, unknown>): Promise<BoltResult["value"]> {
  const result = await callBolt(router, spec, payment, args);
  expect(result.raw.isError, JSON.stringify(result.value)).not.toBe(true);
  return result.value;
}

async function blocked(router: RuntimeRouter, spec: BrowserSpawnSpec, payment: BoltPaymentAuthority, args: Record<string, unknown>): Promise<BoltResult["value"]> {
  const result = await callBolt(router, spec, payment, args);
  expect(result.raw.isError, JSON.stringify(result.value)).toBe(true);
  return result.value;
}

function addClicks(calls: Call[], key: string): number {
  return calls.filter((call) => call.tool === "effect" && call.effect?.kind === "add" && call.effect.key === key).length;
}

function payClicks(calls: Call[]): number {
  return calls.filter((call) => call.tool === "effect" && call.effect?.kind === "pay").length;
}

async function reachSoupDetail(f: ReturnType<typeof setup>) {
  const inspected = await ok(f.router, f.spec, f.payment, { action: "inspect" });
  const opened = await ok(f.router, f.spec, f.payment, {
    action: "open_basket", operationId: "open-basket", observationRef: inspected.observationRef,
  });
  const baseline = await ok(f.router, f.spec, f.payment, { action: "read_basket", observationRef: opened.observationRef });
  expect(baseline).toMatchObject({ status: "observed", basketRows: "available", basket: { open: true, complete: true, emptyBasket: true, rows: [] } });
  const searched = await ok(f.router, f.spec, f.payment, {
    action: "search_branch", operationId: "search-soup", observationRef: baseline.observationRef, query: "soup",
  });
  expect(["verified", "dispatched"]).toContain(searched.status);
  const products = (searched.view as { products?: Array<{ ref: string; name: string }> }).products ?? [];
  expect(products).toHaveLength(1);
  expect(products[0]!.name).toContain("Pumpkin Puree Soup");
  const detail = await ok(f.router, f.spec, f.payment, {
    action: "open_product", operationId: "open-soup", observationRef: searched.observationRef, targetRef: products[0]!.ref,
  });
  expect((detail.view as { item?: { name?: string; quantity?: number } }).item).toMatchObject({ name: SOUP, quantity: 1 });
  return { inspected, opened, baseline, searched, detail, productRef: products[0]!.ref };
}

describe("the real agent_browser_bolt grocery workflow over a legacy agent-browser MCP", () => {
  it("discovers the tool and runs the full separate-call cart and checkout workflow", { timeout: 30_000 }, async () => {
    const f = setup();
    const listed = await f.router.agentRpc("qa-grocery", f.spec, "tools/list", {}) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toContain("agent_browser_bolt");

    const inspected = await ok(f.router, f.spec, f.payment, { action: "inspect" });
    expect(inspected).toMatchObject({ status: "observed" });
    expect(inspected.supportedActions).toEqual(expect.arrayContaining([
      "inspect", "open_basket", "search_branch", "open_product", "set_product_quantity",
      "add_configured_product", "read_basket", "set_basket_quantity", "read_checkout",
      "request_payment_approval", "pay", "reconcile_operation",
    ]));
    expect((inspected.view as { branchId?: string }).branchId).toBe("28032");

    const opened = await ok(f.router, f.spec, f.payment, {
      action: "open_basket", operationId: "open-basket", observationRef: inspected.observationRef,
    });
    const baseline = await ok(f.router, f.spec, f.payment, { action: "read_basket", observationRef: opened.observationRef });
    expect(baseline).toMatchObject({
      status: "observed", basketRows: "available",
      basket: { open: true, complete: true, emptyBasket: true, basketTotalMinor: 0, rows: [] },
    });

    const searched = await ok(f.router, f.spec, f.payment, {
      action: "search_branch", operationId: "search-soup", observationRef: baseline.observationRef, query: "soup",
    });
    const soupCards = (searched.view as { products?: Array<{ ref: string; name: string; priceMinor?: number }> }).products ?? [];
    expect(soupCards).toHaveLength(1);
    expect(soupCards[0]).toMatchObject({ name: SOUP, priceMinor: 329 });

    const detail = await ok(f.router, f.spec, f.payment, {
      action: "open_product", operationId: "open-soup", observationRef: searched.observationRef, targetRef: soupCards[0]!.ref,
    });
    expect((detail.view as { item?: { name?: string; quantity?: number } }).item).toMatchObject({ name: SOUP, quantity: 1 });
    const two = await ok(f.router, f.spec, f.payment, {
      action: "set_product_quantity", operationId: "qty-soup-2", observationRef: detail.observationRef, quantity: 2,
    });
    expect((two.view as { item?: { quantity?: number } }).item?.quantity).toBe(2);

    const addArgs = {
      action: "add_configured_product", operationId: "add-soup", observationRef: two.observationRef,
    };
    const added = await ok(f.router, f.spec, f.payment, addArgs);
    expect(added).toMatchObject({ status: "verified" });
    expect((added.view as { basket?: Array<Record<string, unknown>> }).basket).toEqual([
      expect.objectContaining({ name: SOUP, quantity: 2, unitPriceMinor: 329, lineTotalMinor: 658, priceBasis: "line_total" }),
    ]);
    expect(f.calls().filter((call) => call.tool === "agent_browser_click").length).toBeGreaterThan(0);
    expect(f.calls().some((call) => call.tool === "agent_browser_eval")).toBe(true);
    expect(f.calls().some((call) => call.tool === "agent_browser_get_url")).toBe(true);
    expect(f.calls().some((call) => call.tool === "agent_browser_fill")).toBe(true);

    const replay = await ok(f.router, f.spec, f.payment, addArgs);
    expect(replay).toMatchObject({ status: "verified", receipt: { operationId: "add-soup" } });
    expect(addClicks(f.calls(), "soup")).toBe(1);

    const basketOne = await ok(f.router, f.spec, f.payment, { action: "read_basket", observationRef: replay.observationRef });
    expect(basketOne).toMatchObject({
      status: "observed", basketRows: "available",
      basket: {
        open: true, complete: true, emptyBasket: false, basketTotalMinor: 658,
        rows: [expect.objectContaining({ name: SOUP, quantity: 2, priceMinor: 658 })],
      },
    });
    const soupLine = ((basketOne.basket as { rows: Array<{ ref: string; name: string }> }).rows).find((row) => row.name === SOUP)!;

    const closed = await ok(f.router, f.spec, f.payment, {
      action: "close_product", operationId: "close-soup", observationRef: basketOne.observationRef,
    });
    expect((closed.view as { item?: unknown }).item).toBeUndefined();

    const searchedJam = await ok(f.router, f.spec, f.payment, {
      action: "search_branch", operationId: "search-jam", observationRef: closed.observationRef, query: "jam",
    });
    const jamCards = (searchedJam.view as { products?: Array<{ ref: string; name: string; priceMinor?: number }> }).products ?? [];
    expect(jamCards).toHaveLength(1);
    expect(jamCards[0]).toMatchObject({ name: JAM, priceMinor: 302 });
    const jamDetail = await ok(f.router, f.spec, f.payment, {
      action: "open_product", operationId: "open-jam", observationRef: searchedJam.observationRef, targetRef: jamCards[0]!.ref,
    });
    const jamAdded = await ok(f.router, f.spec, f.payment, {
      action: "add_configured_product", operationId: "add-jam", observationRef: jamDetail.observationRef,
    });
    expect(jamAdded).toMatchObject({ status: "verified" });
    expect((jamAdded.view as { basket?: Array<Record<string, unknown>> }).basket).toEqual([
      expect.objectContaining({ name: SOUP, quantity: 2, lineTotalMinor: 658 }),
      expect.objectContaining({ name: JAM, quantity: 1, lineTotalMinor: 302 }),
    ]);

    const basketTwo = await ok(f.router, f.spec, f.payment, { action: "read_basket", observationRef: jamAdded.observationRef });
    expect(basketTwo).toMatchObject({
      basket: { basketTotalMinor: 960, rows: [
        expect.objectContaining({ name: SOUP, quantity: 2, priceMinor: 658 }),
        expect.objectContaining({ name: JAM, quantity: 1, priceMinor: 302 }),
      ] },
    });
    const jamLine = ((basketTwo.basket as { rows: Array<{ ref: string; name: string }> }).rows).find((row) => row.name === JAM)!;

    const increased = await ok(f.router, f.spec, f.payment, {
      action: "set_basket_quantity", operationId: "qty-soup-3", observationRef: basketTwo.observationRef,
      targetRef: soupLine.ref, expectedQuantity: 2, quantity: 3,
    });
    expect(increased).toMatchObject({
      status: "verified", basketChange: { changed: { name: SOUP, from: 2, to: 3 } },
      view: { basket: [
        expect.objectContaining({ name: SOUP, quantity: 3, lineTotalMinor: 987 }),
        expect.objectContaining({ name: JAM, quantity: 1, lineTotalMinor: 302 }),
      ], basketState: { detail: expect.stringContaining("12,89") } },
    });

    const removed = await ok(f.router, f.spec, f.payment, {
      action: "set_basket_quantity", operationId: "remove-jam", observationRef: increased.observationRef,
      targetRef: jamLine.ref, expectedQuantity: 1, quantity: 0,
    });
    expect(removed).toMatchObject({
      status: "verified", basketChange: { changed: { name: JAM, from: 1, to: 0 } },
      view: { basket: [expect.objectContaining({ name: SOUP, quantity: 3, lineTotalMinor: 987 })], basketState: { detail: expect.stringContaining("9,87") } },
    });

    const closedJam = await ok(f.router, f.spec, f.payment, {
      action: "close_product", operationId: "close-jam", observationRef: removed.observationRef,
    });
    const checkout = await ok(f.router, f.spec, f.payment, { action: "read_checkout", observationRef: closedJam.observationRef });
    expect(checkout).toMatchObject({ status: "observed", checkoutStatus: "complete" });
    const quote = checkout.quote as {
      status: string; subtotalMinor: number; totalMinor: number; payableMinor: number;
      adjustments: Array<{ label: string; amountMinor: number }>;
      checkout: BoltCheckout; payControl: { label: string; enabled: boolean };
      missing: string[]; conflicts: string[];
    };
    expect(quote.status).toBe("complete");
    expect(quote.missing).toEqual([]);
    expect(quote.conflicts).toEqual([]);
    expect(quote.subtotalMinor).toBe(987);
    expect(quote.adjustments).toEqual([
      { label: "Small order fee", amountMinor: 680 },
      { label: "Service fee", amountMinor: 152 },
      { label: "Delivery fee", amountMinor: 329 },
    ]);
    expect(quote.totalMinor).toBe(2148);
    expect(quote.payableMinor).toBe(2148);
    expect(quote.payControl).toMatchObject({ enabled: true, label: expect.stringContaining("21,48") });
    expect(quote.checkout).toMatchObject({
      account: PROFILE, accountScope: "host_browser_profile", currency: "EUR", branchId: "28032",
      destination: "Uus-Volta 6/1, Tallinn", paymentMethod: "•••• 2000",
      lines: [expect.objectContaining({ name: SOUP, quantity: 3, unitPriceMinor: 329 })],
      subtotalMinor: 987, totalMinor: 2148,
    });

    const approval = await ok(f.router, f.spec, f.payment, {
      action: "request_payment_approval", operationId: "approve-1", observationRef: checkout.observationRef,
    });
    expect(approval).toMatchObject({ status: "awaiting_user_approval", approvalRef: expect.stringMatching(/^qa-approval-/) });
    expect(f.payment.requests).toEqual([{ ref: approval.approvalRef, hash: approval.checkoutHash }]);

    const cheaper = await ok(f.router, f.spec, f.payment, {
      action: "set_basket_quantity", operationId: "qty-soup-2-after-approval", observationRef: approval.observationRef,
      targetRef: soupLine.ref, expectedQuantity: 3, quantity: 2,
    });
    expect((cheaper.view as { basketState?: { detail?: string } }).basketState?.detail).toContain("6,58");
    const cheaperQuote = await ok(f.router, f.spec, f.payment, { action: "read_checkout", observationRef: cheaper.observationRef });
    expect((cheaperQuote.quote as { totalMinor?: number }).totalMinor).toBe(1819);
    const stale = await blocked(f.router, f.spec, f.payment, {
      action: "pay", operationId: "pay-stale-approval", observationRef: cheaperQuote.observationRef,
      approvedCheckoutRef: approval.approvalRef,
    });
    expect(stale).toMatchObject({ status: "blocked", code: "checkout_quote_changed" });
    expect(payClicks(f.calls())).toBe(0);

    const fresh = await ok(f.router, f.spec, f.payment, {
      action: "request_payment_approval", operationId: "approve-2", observationRef: cheaper.observationRef,
    });
    const paid = await ok(f.router, f.spec, f.payment, {
      action: "pay", operationId: "pay-approved", observationRef: fresh.observationRef,
      approvedCheckoutRef: fresh.approvalRef,
    });
    expect(paid).toMatchObject({ status: "dispatched", receipt: { operationId: "pay-approved", status: "pending" } });
    expect(payClicks(f.calls())).toBe(1);

    const secondPay = await blocked(f.router, f.spec, f.payment, {
      action: "pay", operationId: "pay-same-approval", observationRef: paid.observationRef,
      approvedCheckoutRef: fresh.approvalRef,
    });
    expect(["unresolved_operation_reconcile_required", "approval_already_used"]).toContain(secondPay.code);
    expect(payClicks(f.calls())).toBe(1);
  });

  it("dispatches agent_browser_open for the legacy branch navigation tool", { timeout: 20_000 }, async () => {
    const f = setup({ BOLT_START_URL: `${ORIGIN}/en/1-tallinn/`, BOLT_HIDE_BASKET: "1" });
    const inspected = await ok(f.router, f.spec, f.payment, { action: "inspect" });
    const opened = await ok(f.router, f.spec, f.payment, {
      action: "open_branch", operationId: "open-branch", observationRef: inspected.observationRef, branchUrl: BRANCH_URL,
    });
    expect(opened).toMatchObject({ status: "verified", url: BRANCH_URL });
    expect((opened.view as { branchId?: string }).branchId).toBe("28032");
    expect(f.calls()).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: "agent_browser_open", arguments: expect.objectContaining({ url: BRANCH_URL }) }),
    ]));
  });

  it("does not dispatch a second add when an add outcome is unknown", { timeout: 20_000 }, async () => {
    const f = setup({ BOLT_ADD_EFFECT_UNKNOWN: "1" });
    const reached = await reachSoupDetail(f);
    const two = await ok(f.router, f.spec, f.payment, {
      action: "set_product_quantity", operationId: "qty-soup-2", observationRef: reached.detail.observationRef, quantity: 2,
    });
    const addArgs = { action: "add_configured_product", operationId: "add-unknown", observationRef: two.observationRef };
    const unknown = await blocked(f.router, f.spec, f.payment, addArgs);
    expect(unknown).toMatchObject({ status: "blocked", code: "outcome_unknown_reconcile_required" });
    expect(addClicks(f.calls(), "soup")).toBe(1);

    const replay = await ok(f.router, f.spec, f.payment, addArgs);
    expect(replay).toMatchObject({ status: "pending", receipt: { operationId: "add-unknown", status: "pending" } });
    expect(addClicks(f.calls(), "soup")).toBe(1);

    const retry = await blocked(f.router, f.spec, f.payment, {
      action: "add_configured_product", operationId: "add-new-id", observationRef: replay.observationRef,
    });
    expect(retry).toMatchObject({ status: "blocked", code: "unresolved_operation_reconcile_required" });
    expect(addClicks(f.calls(), "soup")).toBe(1);
  });
});
