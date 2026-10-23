import { describe, expect, it } from "vitest";
import type { OptionCardData } from "../../../shared/wire.ts";
import { boltPaymentAuthority, resolveBoltApproval } from "./approvals.ts";
import type { BoltCheckout } from "./contracts.ts";
import { checkoutHash } from "./runner.ts";

const checkout: BoltCheckout = {
  account: "Fixture user", branchId: "123", currency: "EUR", destination: "Fixture address", fulfilment: "delivery", deliveryOptionId: "choice-3", deliveryLabel: "Observed choice", deliveryEta: "20 min", paymentMethod: "Fixture card", courierComment: "Door 2",
  lines: [{ ref: "line", id: "meal", name: "Fixture meal", quantity: 1, unitPriceMinor: 650, options: [{ groupId: "Ingredients", groupLabel: "Ingredients", choiceId: "No onion", choiceLabel: "No onion", quantity: 1 }], comment: "No salt" }], subtotalMinor: 650, adjustments: [{ label: "Delivery", amountMinor: 200 }], totalMinor: 850,
};

function fixture() {
  const messages = new Map<string, Array<{ id: string; card?: OptionCardData }>>();
  const store = {
    messagesFor: (thread: string) => messages.get(thread) ?? [],
    appendMessage: (thread: string, message: { card: OptionCardData }) => {
      const existing = messages.get(thread) ?? [];
      const entry = { id: `message-${existing.length}`, card: message.card };
      messages.set(thread, [...existing, entry]);
      return entry;
    },
    patchMessage: (thread: string, id: string, patch: { card: OptionCardData }) => { Object.assign(messages.get(thread)!.find((message) => message.id === id)!, patch); },
  };
  let now = 1000;
  const scope = { botId: "donna", threadId: "user-thread", profileKey: "profile" };
  const authority = boltPaymentAuthority(store, scope, () => now);
  return { store, authority, scope, advance: (ms: number) => now += ms, now: () => now };
}

describe("host-owned Bolt checkout approvals", () => {
  it("shows the actual meal, options, comments, delivery and full price and deduplicates pending cards", async () => {
    const f = fixture();
    const ref = await f.authority.request!(checkout);
    expect(await f.authority.request!(checkout)).toBe(ref);
    const card = f.store.messagesFor(f.scope.threadId)[0].card!;
    for (const text of ["Fixture meal", "No onion", "No salt", "Fixture address", "Door 2", "Observed choice", "€8.50", "€2.00"]) expect(card.subtitle).toContain(text);
    expect(card.answered).toBeUndefined();
    await expect(f.authority.verify(ref, checkoutHash(checkout))).rejects.toThrow("approval_not_granted");
    resolveBoltApproval(f.store, f.scope.threadId, ref, "allow", f.now);
    await expect(f.authority.verify(ref, checkoutHash(checkout))).resolves.toBeUndefined();
  });

  it("does not treat a denial, arbitrary answer or late answer as payment authority", async () => {
    for (const behavior of ["deny", "answer", "auto-approved"]) {
      const f = fixture();
      const ref = await f.authority.request!(checkout);
      resolveBoltApproval(f.store, f.scope.threadId, ref, behavior, f.now);
      await expect(f.authority.verify(ref, checkoutHash(checkout))).rejects.toThrow("approval_not_granted");
    }
    const f = fixture();
    const ref = await f.authority.request!(checkout);
    f.advance(600_001);
    expect(resolveBoltApproval(f.store, f.scope.threadId, ref, "allow", f.now)?.outcome).toBe("unavailable");
    await expect(f.authority.verify(ref, checkoutHash(checkout))).rejects.toThrow("approval_not_granted");
  });

  it("rejects changed checkout facts, another bot, another thread, another profile and expired approvals", async () => {
    const f = fixture();
    const ref = await f.authority.request!(checkout);
    resolveBoltApproval(f.store, f.scope.threadId, ref, "allow", f.now);
    const changed = structuredClone(checkout);
    changed.lines[0].options[0].choiceId = "Extra onion";
    await expect(f.authority.verify(ref, checkoutHash(changed))).rejects.toThrow("scope_mismatch");
    for (const change of [{ botId: "dude" }, { threadId: "private-thread" }, { profileKey: "another-profile" }]) {
      await expect(boltPaymentAuthority(f.store, { ...f.scope, ...change }, f.now).verify(ref, checkoutHash(checkout))).rejects.toThrow();
    }
    f.advance(600_001);
    await expect(f.authority.verify(ref, checkoutHash(checkout))).rejects.toThrow("approval_expired");
  });
});
