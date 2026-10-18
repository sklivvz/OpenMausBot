import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { SELVER_CART_SNAPSHOT, SELVER_SESSION_CAPTURE } from "./selver-cart.ts";

function fixture(expireAtAccountCall = Number.POSITIVE_INFINITY) {
  const getters: Record<string, unknown> = {
    "user/isLoggedIn": true,
    "user/getUserToken": "synthetic-user-token",
    "cart/isCartConnected": true,
    "cart/getCartToken": "synthetic-cart-token",
  };
  const cartItems = [{ sku: "MILK", qty: 2 }];
  const store = { getters, state: { cart: { cartItems } } };
  const calls: string[] = [];
  const context = {
    location: { origin: "https://www.selver.ee" }, URL,
    document: { body: { innerText: "Tere, Marco Cecconi!" }, querySelector: () => ({ __vue__: { $store: store } }) },
    fetch: async (url: URL) => {
      calls.push(url.pathname);
      if (url.pathname.endsWith("/user/me") && calls.filter((path) => path.endsWith("/user/me")).length >= expireAtAccountCall) {
        return { ok: false, status: 401 };
      }
      const result = url.pathname.endsWith("/user/me")
        ? { firstname: "Marco", lastname: "Cecconi" }
        : url.pathname.endsWith("/totals")
        ? { grand_total: 4, items: [{ item_id: 10, price_incl_tax: 2 }] }
        : [{ sku: "MILK", qty: 2, item_id: 10 }];
      return { ok: true, json: async () => ({ code: 200, result }) };
    },
  };
  return { context, getters, cartItems, calls };
}

describe("server-observed Selver cart", () => {
  it("refuses to capture an expired browser token", async () => {
    const { context } = fixture();
    context.fetch = async () => ({ ok: false, status: 401 });
    await expect(runInNewContext(SELVER_SESSION_CAPTURE, context)).rejects.toThrow("account verification failed");
  });

  it("rejects a stale account label when Selver says the session is logged out", async () => {
    const { context, getters, calls } = fixture();
    getters["user/isLoggedIn"] = false;
    await expect(runInNewContext(SELVER_CART_SNAPSHOT, context)).rejects.toThrow("not authenticated");
    expect(calls).toEqual([]);
  });

  it("rejects a persisted cart that differs from the browser cart", async () => {
    const { context, cartItems } = fixture();
    cartItems[0]!.qty = 1;
    await expect(runInNewContext(SELVER_CART_SNAPSHOT, context)).rejects.toThrow("differs from persisted cart");
  });

  it("returns only the authenticated, stable cart and its total", async () => {
    const { context, calls } = fixture();
    const result = await runInNewContext(SELVER_CART_SNAPSHOT, context) as { signedInAs: string; totalEur: number; cart: unknown[] };
    expect(result.signedInAs).toBe("Marco Cecconi");
    expect(result.totalEur).toBe(4);
    expect(result.cart).toEqual([{ sku: "MILK", quantity: 2, unitPriceEur: 2 }]);
    expect(calls).toEqual(["/api/user/me", "/api/user/me", "/api/cart/pull", "/api/user/me", "/api/cart/pull", "/api/user/me", "/api/cart/totals"]);
  });

  it("does not request cart totals after account verification expires", async () => {
    const { context, calls } = fixture(4);
    await expect(runInNewContext(SELVER_CART_SNAPSHOT, context)).rejects.toThrow("Selver cart read failed");
    expect(calls.at(-1)).toBe("/api/user/me");
    expect(calls).not.toContain("/api/cart/totals");
  });
});
