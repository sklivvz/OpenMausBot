import { randomUUID } from "node:crypto";
import type { OptionCardData } from "../../../shared/wire.ts";
import { requireBolt, type BoltCheckout } from "./contracts.ts";
import { checkoutHash, type BoltPaymentAuthority } from "./runner.ts";

interface ApprovalStore {
  messagesFor(threadId: string): Array<{ id: string; card?: OptionCardData }>;
  appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: OptionCardData }): { id: string };
  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardData }): unknown;
}

const money = (cents: number) => `€${(cents / 100).toFixed(2)}`;

function summary(checkout: BoltCheckout): string {
  return [
    `Approval profile (host browser identity): ${checkout.account}. Branch: ${checkout.branchId}.${checkout.providerAccountId ? ` Provider account: ${checkout.providerAccountId}.` : " No provider account id was observed; approval is scoped to the host browser profile."}`,
    ...checkout.lines.map((line) => `${line.quantity} × ${line.name}, ${money(line.unitPriceMinor)} each. Options: ${line.options.map((option) => `${option.groupLabel}: ${option.choiceLabel} × ${option.quantity}`).join(", ") || "none"}. Item comment: ${JSON.stringify(line.comment)}.`),
    `To: ${checkout.destination}. ${checkout.fulfilment}; ${checkout.deliveryLabel}; ${checkout.deliveryEta}.`,
    `Courier comment: ${JSON.stringify(checkout.courierComment)}. Payment: ${checkout.paymentMethod}.`,
    `Subtotal ${money(checkout.subtotalMinor)}. ${checkout.adjustments.map((adjustment) => `${adjustment.label}: ${money(adjustment.amountMinor)}`).join("; ")}. Total ${money(checkout.totalMinor)}.`,
    "Approval applies only to this exact checkout for 10 minutes. Any changed item, option, comment, destination, delivery quote or total needs a new approval.",
  ].join("\n");
}

export function boltPaymentAuthority(store: ApprovalStore, scope: { threadId: string; botId: string; profileKey: string }, now = Date.now): BoltPaymentAuthority {
  return {
    scope: { kind: "host_browser_profile", profileKey: scope.profileKey },
    async request(checkout) {
      const hash = checkoutHash(checkout);
      const existing = store.messagesFor(scope.threadId).find((message) => {
        const request = message.card?.boltCheckoutRequest;
        return request?.checkoutHash === hash && request.botId === scope.botId && request.profileKey === scope.profileKey && request.expiresAt > now() && !message.card?.answered;
      });
      if (existing?.card?.requestId) return existing.card.requestId;
      const requestId = randomUUID();
      store.appendMessage(scope.threadId, { role: "bot", kind: "options", card: {
        requestId, tool: "bolt_food_payment", requestType: "permission", title: `Approve Bolt order — ${money(checkout.totalMinor)}?`, subtitle: summary(checkout), options: ["Approve this order", "Do not order"],
        boltCheckoutRequest: { checkoutHash: hash, botId: scope.botId, profileKey: scope.profileKey, expiresAt: now() + 10 * 60_000 },
      } });
      return requestId;
    },
    async verify(approvalRef, hash) {
      const message = store.messagesFor(scope.threadId).find((candidate) => candidate.card?.requestId === approvalRef);
      const request = message?.card?.boltCheckoutRequest;
      requireBolt(request && message?.card?.answered === "allow", "checkout_approval_not_granted");
      requireBolt(request.botId === scope.botId && request.profileKey === scope.profileKey && request.checkoutHash === hash, "checkout_approval_scope_mismatch");
      requireBolt(request.expiresAt > now(), "checkout_approval_expired");
    },
  };
}

/** Call only after the host authenticates the person answering a card. Bot tool calls cannot resolve it. */
export function resolveBoltApproval(store: ApprovalStore, threadId: string, requestId: string, behavior: string, now = Date.now) {
  const message = store.messagesFor(threadId).find((candidate) => candidate.card?.requestId === requestId && candidate.card.boltCheckoutRequest);
  if (!message?.card?.boltCheckoutRequest) return null;
  const card = message.card;
  if (!card.answered) {
    const answered = card.boltCheckoutRequest!.expiresAt <= now() ? "unavailable" : behavior === "allow" ? "allow" : "deny";
    store.patchMessage(threadId, message.id, { card: { ...card, answered } });
    return { ok: true as const, outcome: answered === "allow" ? "allowed-once" : answered === "deny" ? "rejected" : "unavailable" };
  }
  return { ok: true as const, outcome: card.answered === "allow" ? "allowed-once" : "rejected", alreadySettled: true };
}
