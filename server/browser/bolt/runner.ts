import { BOLT_ACTIONS, BoltFault, requireBolt, type BoltCheckout, type BoltInput, type BoltLine, type BoltView } from "./contracts.ts";
import type { BoltAtomicOperations } from "./atomic.ts";
import { BoltJournal, digest, type BoltReceipt } from "./state.ts";

export interface BoltObservation {
  url: string;
  observationRef: string;
  view: BoltView;
}

/** Browser effects resolve only after native actionability checks. Refs come from the latest observation. */
export interface BoltPort {
  readonly effectsDispatched?: number;
  read(): Promise<BoltObservation>;
  click(ref: string): Promise<void>;
  fill(ref: string, value: string): Promise<void>;
  navigate(url: string): Promise<void>;
  guard(): void;
  supports?(action: BoltInput["action"]): boolean;
}

/** The host verifies a genuine user's approval, bound to this profile and exact checkout. No bot boolean grants payment authority. */
export interface BoltPaymentAuthority {
  /** The host-owned browser profile this authority is bound to. Never supplied by a bot call. */
  readonly scope?: { kind: "host_browser_profile"; profileKey: string };
  request?(checkout: BoltCheckout): Promise<string>;
  verify(approvalRef: string, checkoutHash: string): Promise<void>;
}

function configuration(line: BoltLine) {
  return { id: line.id, options: [...line.options].sort((a, b) => `${a.groupId}/${a.choiceId}`.localeCompare(`${b.groupId}/${b.choiceId}`)), comment: line.comment };
}

export function checkoutHash(checkout: BoltCheckout): string {
  return digest({ ...checkout, lines: checkout.lines.map(({ ref: _ref, edit: _edit, plus: _plus, minus: _minus, ...line }) => line) });
}

function configuredItem(view: BoltView): BoltLine {
  const item = view.item;
  requireBolt(item, "item_binding_required");
  requireBolt(item.groups.every((group) => group.min !== null && group.max !== null), "option_constraints_unknown");
  const options = item.groups.flatMap((group) => {
    const choices = group.choices.filter((choice) => group.mode === "quantity" ? (choice.quantity ?? 0) > 0 : choice.selected);
    const count = choices.reduce((total, choice) => total + (group.mode === "quantity" ? choice.quantity ?? 0 : 1), 0);
    requireBolt(count >= group.min! && count <= group.max!, "option_constraints_unsatisfied");
    requireBolt(choices.every((choice) => choice.available), "selected_option_unavailable");
    return choices.map((choice) => ({ groupId: group.id, groupLabel: group.label, choiceId: choice.id, choiceLabel: choice.label, quantity: group.mode === "quantity" ? choice.quantity! : 1 }));
  });
  return { ref: item.ref, id: item.id, name: item.name, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, comment: item.comment.text, options };
}

function lineCount(lines: BoltLine[], line: BoltLine): number {
  const key = digest(configuration(line));
  return lines.filter((candidate) => digest(configuration(candidate)) === key).reduce((total, candidate) => total + candidate.quantity, 0);
}

function selectionsFor(input: BoltInput, view: BoltView) {
  const groups = view.item?.groups;
  requireBolt(groups && input.selections, "item_options_and_selections_required");
  requireBolt(new Set(input.selections.map((selection) => selection.groupRef)).size === input.selections.length, "duplicate_group");
  requireBolt(input.selections.length === groups.length, "all_option_groups_required");
  return groups.map((group) => {
    const selection = input.selections!.find((candidate) => candidate.groupRef === group.ref);
    requireBolt(selection && group.min !== null && group.max !== null, "option_constraints_unknown");
    requireBolt(new Set(selection.choices.map((choice) => choice.choiceRef)).size === selection.choices.length, "duplicate_choice");
    for (const wanted of selection.choices) {
      const choice = group.choices.find((candidate) => candidate.ref === wanted.choiceRef);
      requireBolt(choice, "unknown_choice");
      requireBolt(wanted.quantity === 0 || choice.available, "choice_unavailable");
      requireBolt(wanted.quantity <= (group.mode === "quantity" ? choice.maxQuantity ?? 0 : 1), "choice_quantity_invalid");
    }
    const count = selection.choices.reduce((total, choice) => total + choice.quantity, 0);
    requireBolt(count >= group.min && count <= group.max && (group.mode !== "single" || count <= 1), "option_constraints_unsatisfied");
    return { group, wanted: new Map(selection.choices.map((choice) => [choice.choiceRef, choice.quantity])) };
  });
}

function optionState(input: BoltInput, view: BoltView): boolean {
  try {
    return selectionsFor(input, view).every(({ group, wanted }) => group.choices.every((choice) => (group.mode === "quantity" ? choice.quantity : Number(choice.selected)) === (wanted.get(choice.ref) ?? 0)));
  } catch { return false; }
}

function choiceVerified(input: BoltInput, before: BoltView, after: BoltView): boolean {
  const field = input.action === "select_fulfilment" ? "fulfilmentOptions" : "deliveryOptions";
  const chosen = before[field]?.find((choice) => choice.ref === input.targetRef);
  const observed = after[field]?.find((choice) => choice.id === chosen?.id);
  if (!chosen || !observed || !observed.selected || !observed.available) return false;
  const { selected: _selected, ...previous } = chosen;
  const { selected: _nowSelected, ...current } = observed;
  return digest(previous) === digest(current) && after[field]?.filter((choice) => choice.selected).length === 1;
}

function sameItemStructure(before: BoltView, after: BoltView): boolean {
  const structure = (view: BoltView) => view.item && { id: view.item.id, groups: view.item.groups.map((group) => ({ ref: group.ref, id: group.id, min: group.min, max: group.max, mode: group.mode, choices: group.choices.map((choice) => ({ ref: choice.ref, id: choice.id, priceMinor: choice.priceMinor, available: choice.available, maxQuantity: choice.maxQuantity })) })) };
  return !!before.item && !!after.item && digest(structure(before)) === digest(structure(after));
}

function verified(input: BoltInput, before: BoltView, after: BoltView): boolean {
  switch (input.action) {
    case "open_branch": return new URL(input.branchUrl!).pathname.split("/p/")[1]?.split("/")[0]?.split("-")[0] === after.branchId;
    case "select_saved_address": return after.address === before.addresses?.find((address) => address.ref === input.targetRef)?.destination;
    case "open_product": return !!after.item && after.item.id === before.products?.find((product) => product.ref === input.targetRef)?.id;
    case "close_product": return !after.item && after.overlay === "none";
    case "open_basket": return !!after.basket && after.overlay === "basket";
    case "set_item_options": return sameItemStructure(before, after) && after.item?.quantity === before.item?.quantity && after.item?.comment.text === before.item?.comment.text && optionState(input, after);
    case "set_product_quantity": return sameItemStructure(before, after) && digest(after.item?.groups) === digest(before.item?.groups) && after.item?.comment.text === before.item?.comment.text && after.item?.quantity === input.quantity;
    case "set_item_comment": return sameItemStructure(before, after) && digest(after.item?.groups) === digest(before.item?.groups) && after.item?.quantity === before.item?.quantity && after.item?.comment.text === input.text;
    case "add_configured_product": {
      if (!after.basket || !before.basket) return false;
      const item = configuredItem(before);
      return lineCount(after.basket, item) === lineCount(before.basket, item) + item.quantity &&
        [...before.basket, ...after.basket].every((line) => digest(configuration(line)) === digest(configuration(item)) || lineCount(after.basket!, line) === lineCount(before.basket!, line));
    }
    case "set_basket_quantity": {
      const line = before.basket?.find((candidate) => candidate.ref === input.targetRef);
      if (!line || !after.basket) return false;
      return lineCount(after.basket, line) === lineCount(before.basket!, line) - line.quantity + input.quantity! &&
        [...before.basket!, ...after.basket].every((candidate) => digest(configuration(candidate)) === digest(configuration(line)) || lineCount(after.basket!, candidate) === lineCount(before.basket!, candidate));
    }
    case "select_fulfilment":
    case "select_delivery_option": return choiceVerified(input, before, after);
    case "pay": {
      const checkout = before.checkout;
      const order = after.order;
      if (!checkout || !order?.lines || order.id === before.order?.id) return false;
      const lines = (items: BoltLine[]) => items.map((line) => ({ ...configuration(line), quantity: line.quantity, unitPriceMinor: line.unitPriceMinor })).sort((a, b) => digest(a).localeCompare(digest(b)));
      return ["accepted", "confirmed", "preparing", "delivering", "delivered"].includes(order.state) && order.account === checkout.account && order.branchId === checkout.branchId && order.destination === checkout.destination && order.totalMinor === checkout.totalMinor && digest(lines(order.lines)) === digest(lines(checkout.lines));
    }
    default: return false;
  }
}

function receiptSummary(receipt: BoltReceipt) {
  const { operationId, status, startedAt, verifiedAt, verification, checkoutHash, orderId } = receipt;
  return { operationId, status, startedAt, verifiedAt, verification, checkoutHash, orderId };
}

const READ_FIELDS = {
  read_session: "session", list_saved_addresses: "addresses", read_item_options: "item", read_item_comment: "item", read_basket: "basket", list_fulfilment_options: "fulfilmentOptions", list_delivery_options: "deliveryOptions", read_checkout: "checkout", read_order: "order",
} as const;

export class BoltRunner {
  readonly port: BoltPort;
  readonly journal: BoltJournal;
  readonly authority?: BoltPaymentAuthority;
  readonly atomic?: BoltAtomicOperations;
  constructor(port: BoltPort, journal: BoltJournal, authority?: BoltPaymentAuthority, atomic?: BoltAtomicOperations) {
    this.port = port;
    this.journal = journal;
    this.authority = authority;
    this.atomic = atomic;
  }

  async run(input: BoltInput): Promise<Record<string, unknown>> {
    return this.journal.locked(async () => {
      this.port.guard();
      if (input.action === "reconcile_operation") {
        const receipt = input.operationId ? this.journal.read()[input.operationId] : undefined;
        if (receipt && this.atomic?.handles(receipt.input.action)) return this.reconcileAtomic(receipt);
      }
      const atomicAction = this.atomic?.handles(input.action) === true;
      if (input.action === "inspect" && this.atomic) {
        const generic = await this.port.read();
        try {
          const atomicView = await this.atomic.observe({ action: "search_branch" });
          return {
            status: "observed",
            supportedActions: BOLT_ACTIONS.filter((action) => this.atomic?.handles(action) === true || this.port.supports?.(action) !== false),
            url: atomicView.url,
            observationRef: atomicView.observationRef,
            view: { ...generic.view, ...atomicView.view },
          };
        } catch {
          return { status: "observed", supportedActions: BOLT_ACTIONS.filter((action) => this.port.supports?.(action) !== false), ...generic };
        }
      }
      const before = atomicAction ? await this.atomic!.observe(input) as BoltObservation : await this.port.read();
      const supported = atomicAction || this.port.supports?.(input.action) !== false;
      requireBolt(supported, "action_bindings_required");
      if (input.action === "inspect") return { status: "observed", supportedActions: BOLT_ACTIONS.filter((action) => this.atomic?.handles(action) === true || this.port.supports?.(action) !== false), ...before };
      if (atomicAction) return this.runAtomic(input, before);
      if (input.action === "request_payment_approval") {
        requireBolt(before.view.checkout && this.authority?.request, "checkout_approval_host_required");
        this.plan({ ...input, action: "pay" }, before.view);
        this.port.guard();
        const approvalRef = await this.authority.request(before.view.checkout);
        return { status: "awaiting_user_approval", approvalRef, checkoutHash: checkoutHash(before.view.checkout), ...before };
      }
      if (Object.hasOwn(READ_FIELDS, input.action)) {
        if (input.action === "read_basket" && before.view.basket === undefined && before.view.basketState) {
          return { status: "observed", url: before.url, observationRef: before.observationRef, view: { basketState: before.view.basketState }, basketRows: "unavailable" };
        }
        const field = READ_FIELDS[input.action as keyof typeof READ_FIELDS];
        requireBolt(before.view[field] !== undefined, `${field}_binding_required`);
        return { status: "observed", url: before.url, observationRef: before.observationRef, view: { [field]: before.view[field] }, ...(before.view.checkout ? { checkoutHash: checkoutHash(before.view.checkout) } : {}) };
      }
      const receipts = this.journal.read();
      requireBolt(input.operationId, "operation_id_required");
      const receipt = Object.hasOwn(receipts, input.operationId) ? receipts[input.operationId] : undefined;
      if (input.action === "reconcile_operation") {
        requireBolt(receipt, "operation_unknown");
        if (receipt.status === "pending" && verified(receipt.input, receipt.before, before.view)) {
          receipt.status = "verified";
          receipt.verifiedAt = new Date().toISOString();
          receipt.orderId = before.view.order?.id;
          this.journal.write(receipt);
        }
        return { status: receipt.status, receipt: receiptSummary(receipt), ...before };
      }
      if (receipt) {
        requireBolt(receipt.requestHash === digest(input), "operation_id_reused_for_different_request");
        return { status: receipt.status, receipt: receiptSummary(receipt), ...before };
      }
      requireBolt(!Object.values(receipts).some((entry) => entry.status === "pending"), "unresolved_operation_reconcile_required");
      let atomicRef: string | undefined;
      if (this.atomic) {
        try { atomicRef = (await this.atomic.observe({ action: "search_branch" })).observationRef; } catch { atomicRef = undefined; }
      }
      requireBolt(before.observationRef === input.observationRef || atomicRef === input.observationRef, "stale_observation");
      requireBolt(before.view.authenticationRequired !== true, "sign_in_required");
      requireBolt(before.view.overlay !== "replacement" && before.view.overlay !== "unknown", "overlay_requires_resolution");
      const effects = this.plan(input, before.view);
      if (input.action === "pay") {
        requireBolt(this.authority && input.approvedCheckoutRef && before.view.checkout, "trusted_checkout_approval_required");
        requireBolt(!Object.values(receipts).some((entry) => entry.status !== "not_executed" && entry.input.approvedCheckoutRef === input.approvedCheckoutRef), "approval_already_used");
        await this.authority.verify(input.approvedCheckoutRef, checkoutHash(before.view.checkout));
      }
      const intent: BoltReceipt = { operationId: input.operationId, requestHash: digest(input), input, before: before.view, status: "pending", startedAt: new Date().toISOString(), ...(before.view.checkout ? { checkoutHash: checkoutHash(before.view.checkout) } : {}) };
      this.journal.write(intent);
      const dispatchedBefore = this.port.effectsDispatched;
      try {
        for (const effect of effects) {
          this.port.guard();
          await effect();
        }
        if (input.action === "search_branch") {
          const after = await this.port.read();
          requireBolt(after.view.search === input.query, "search_input_not_applied");
          intent.status = "dispatched";
          intent.verification = "input_only";
          intent.verifiedAt = new Date().toISOString();
          this.journal.write(intent);
          return { status: "dispatched", verification: "input_only", searchResults: "unknown", receipt: receiptSummary(intent), ...after };
        }
        const after = await this.waitFor((view) => verified(input, before.view, view));
        if (input.action === "open_branch" && (after.view.overlay === "replacement" || after.view.basketState?.ready === true)) {
          intent.status = "pending";
          this.journal.write(intent);
          return { status: "blocked", code: "branch_change_confirmation_unhandled", receipt: receiptSummary(intent), ...after };
        }
        intent.status = "verified";
        intent.verifiedAt = new Date().toISOString();
        intent.orderId = after.view.order?.id;
        this.journal.write(intent);
        return { status: "verified", receipt: receiptSummary(intent), ...after };
      } catch (error) {
        if (dispatchedBefore !== undefined && this.port.effectsDispatched === dispatchedBefore) {
          intent.status = "not_executed";
          this.journal.write(intent);
        }
        if (!(error instanceof BoltFault)) throw new BoltFault("outcome_unknown_reconcile_required");
        throw error;
      }
    });
  }

  private async reconcileAtomic(receipt: BoltReceipt): Promise<Record<string, unknown>> {
    const atomic = this.atomic!;
    if (receipt.status === "pending" && await atomic.reconcile(receipt.input, receipt.before, receipt.basketBaseline)) {
      receipt.status = "verified";
      receipt.verifiedAt = new Date().toISOString();
      this.journal.write(receipt);
    }
    const observed = await atomic.observe(receipt.input);
    return { status: receipt.status, receipt: receiptSummary(receipt), ...observed };
  }

  private async runAtomic(input: BoltInput, before: BoltObservation): Promise<Record<string, unknown>> {
    const atomic = this.atomic!;
    if (input.action === "request_payment_approval" || !atomic.isMutation(input.action)) {
      const outcome = await atomic.run(input, this.authority);
      return { ...outcome, observationRef: before.observationRef, url: before.url };
    }
    const receipts = this.journal.read();
    requireBolt(input.operationId, "operation_id_required");
    const receipt = Object.hasOwn(receipts, input.operationId) ? receipts[input.operationId] : undefined;
    if (receipt) {
      requireBolt(receipt.requestHash === digest(input), "operation_id_reused_for_different_request");
      return { status: receipt.status, receipt: receiptSummary(receipt), ...before };
    }
    requireBolt(!Object.values(receipts).some((entry) => entry.status === "pending"), "unresolved_operation_reconcile_required");
    requireBolt(before.observationRef === input.observationRef, "stale_observation");
    requireBolt(before.view.authenticationRequired !== true, "sign_in_required");
    requireBolt(before.view.overlay !== "replacement" && before.view.overlay !== "unknown", "overlay_requires_resolution");
    if (input.action === "pay") {
      requireBolt(this.authority && input.approvedCheckoutRef, "trusted_checkout_approval_required");
      requireBolt(!Object.values(receipts).some((entry) => entry.status !== "not_executed" && entry.input.approvedCheckoutRef === input.approvedCheckoutRef), "approval_already_used");
    }
    const intent: BoltReceipt = {
      operationId: input.operationId, requestHash: digest(input), input, before: before.view, status: "pending", startedAt: new Date().toISOString(),
      ...(input.action === "add_configured_product" ? { basketBaseline: await atomic.baselineFor() } : {}),
    };
    this.journal.write(intent);
    const effectsBefore = atomic.effectsDispatched;
    try {
      const outcome = await atomic.run(input, this.authority);
      if (input.action === "pay") {
        intent.checkoutHash = typeof outcome.checkoutHash === "string" ? outcome.checkoutHash : undefined;
        this.journal.write(intent);
        return { ...outcome, receipt: receiptSummary(intent) };
      }
      intent.status = outcome.status === "verified" || outcome.status === "observed" ? "verified" : "dispatched";
      if (intent.status === "verified") intent.verifiedAt = new Date().toISOString();
      if (typeof outcome.checkoutHash === "string") intent.checkoutHash = outcome.checkoutHash;
      this.journal.write(intent);
      return { ...outcome, receipt: receiptSummary(intent) };
    } catch (error) {
      if (atomic.effectsDispatched === effectsBefore) {
        intent.status = "not_executed";
        this.journal.write(intent);
      }
      if (!(error instanceof BoltFault)) throw new BoltFault("outcome_unknown_reconcile_required");
      throw error;
    }
  }

  private async waitFor(predicate: (view: BoltView) => boolean): Promise<BoltObservation> {
    for (let attempt = 0; attempt < 30; attempt++) {
      this.port.guard();
      const observation = await this.port.read();
      if (predicate(observation.view)) return observation;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new BoltFault("verification_incomplete_reconcile_required");
  }

  private plan(input: BoltInput, view: BoltView): Array<() => Promise<void>> {
    const click = (ref: string | undefined) => {
      requireBolt(ref, "control_binding_required");
      return () => this.port.click(ref);
    };
    switch (input.action) {
      case "open_branch": {
        requireBolt(input.branchUrl, "branch_url_required");
        const url = new URL(input.branchUrl);
        requireBolt(url.origin === "https://food.bolt.eu" && !url.username && !url.password && /^\/en\/[^/]+\/p\/\d+(?:-[^/]+)?\/$/.test(url.pathname) && !url.search && !url.hash, "branch_url_invalid");
        requireBolt(view.basketState, "basket_state_unavailable");
        requireBolt(!view.basketState.loading, "basket_still_loading");
        requireBolt(!view.basketState.ready, "active_basket_preserved_refuse_branch_change");
        requireBolt(view.basket?.length !== undefined ? view.basket.length === 0 : true, "empty_basket_required_before_branch_change");
        return [() => this.port.navigate(url.href)];
      }
      case "select_saved_address": {
        const address = view.addresses?.find((candidate) => candidate.ref === input.targetRef);
        requireBolt(address, "saved_address_not_found");
        return [click(address.control)];
      }
      case "search_branch": {
        requireBolt(input.query !== undefined && view.branchId && view.controls?.search, "branch_search_binding_required");
        return [() => this.port.fill(view.controls!.search, input.query!)];
      }
      case "open_product": {
        const product = view.products?.find((candidate) => candidate.ref === input.targetRef);
        requireBolt(product?.id, "product_identity_required");
        return [click(product.open)];
      }
      case "close_product": return [click(view.item?.close ?? view.controls?.closeProduct)];
      case "open_basket": return [click(view.controls?.openBasket)];
      case "set_item_comment": {
        const comment = view.item?.comment;
        requireBolt(comment?.supported && comment.input && input.text !== undefined, "item_comment_unsupported");
        requireBolt(comment.maxLength !== null && input.text.length <= comment.maxLength, "comment_length_invalid");
        return [() => this.port.fill(comment.input!, input.text!), ...(comment.save ? [click(comment.save)] : [])];
      }
      case "set_product_quantity":
      case "set_basket_quantity": {
        const item = input.action === "set_product_quantity" ? view.item : view.basket?.find((line) => line.ref === input.targetRef);
        requireBolt(item && input.quantity !== undefined && item.quantity === input.expectedQuantity, "quantity_precondition_failed");
        requireBolt(input.action !== "set_product_quantity" || input.quantity > 0, "product_quantity_must_be_positive");
        const step = input.quantity > item.quantity ? 1 : -1;
        const control = step > 0 ? item.plus : item.minus;
        if (input.quantity !== item.quantity) requireBolt(control, "quantity_control_missing");
        return Array.from({ length: Math.abs(input.quantity - item.quantity) }, (_, index) => async () => {
          const current = await this.port.read();
          const observed = input.action === "set_product_quantity" ? current.view.item : current.view.basket?.find((line) => line.ref === input.targetRef);
          requireBolt(observed?.id === item.id && observed.quantity === item.quantity + step * index, "quantity_changed_during_operation");
          if (input.action === "set_basket_quantity") requireBolt(digest(configuration(observed as BoltLine)) === digest(configuration(item as BoltLine)), "basket_line_changed_during_operation");
          await this.port.click(step > 0 ? observed.plus! : observed.minus!);
          await this.waitFor((next) => {
            const line = input.action === "set_product_quantity" ? next.item : next.basket?.find((candidate) => candidate.ref === input.targetRef);
            return item.quantity + step * (index + 1) === 0 ? !!next.basket && lineCount(next.basket, item as BoltLine) === lineCount(view.basket!, item as BoltLine) - item.quantity : line?.id === item.id && line.quantity === item.quantity + step * (index + 1);
          });
        });
      }
      case "set_item_options": {
        const selections = selectionsFor(input, view);
        return [async () => {
          for (const { group, wanted } of selections) {
            const choices = [...group.choices].sort((a, b) => (wanted.get(a.ref) ?? 0) - (wanted.get(b.ref) ?? 0));
            for (const choice of choices) {
              const target = wanted.get(choice.ref) ?? 0;
              for (let attempt = 0; attempt < 101; attempt++) {
                this.port.guard();
                const current = await this.port.read();
                requireBolt(sameItemStructure(view, current.view), "item_changed_during_operation");
                const observed = current.view.item?.groups.find((candidate) => candidate.id === group.id)?.choices.find((candidate) => candidate.id === choice.id);
                requireBolt(observed, "option_changed_during_operation");
                const count = group.mode === "quantity" ? observed.quantity : Number(observed.selected);
                requireBolt(count !== undefined, "option_quantity_unknown");
                if (count === target || (group.mode === "single" && target === 0 && [...wanted.values()].some((value) => value > 0))) break;
                const control = group.mode === "quantity" ? (target > count ? observed.plus : observed.minus) : observed.control;
                requireBolt(control && attempt < 100, "option_control_missing");
                await this.port.click(control);
                await this.waitFor((next) => {
                  const updated = next.item?.groups.find((candidate) => candidate.id === group.id)?.choices.find((candidate) => candidate.id === choice.id);
                  return (group.mode === "quantity" ? updated?.quantity : Number(updated?.selected)) === (group.mode === "quantity" ? count + Math.sign(target - count) : target);
                });
              }
            }
          }
        }];
      }
      case "add_configured_product": {
        const item = configuredItem(view);
        requireBolt(view.item?.mode === "new", "new_item_required_for_add");
        requireBolt(item.quantity > 0 && view.basket, "basket_baseline_required");
        return [click(view.item?.add)];
      }
      case "select_fulfilment":
      case "select_delivery_option": {
        const choices = input.action === "select_fulfilment" ? view.fulfilmentOptions : view.deliveryOptions;
        const choice = choices?.find((candidate) => candidate.ref === input.targetRef);
        requireBolt(choice?.available, "choice_unavailable");
        return choice.selected ? [] : [click(choice.control)];
      }
      case "pay": {
        requireBolt(view.session?.signedIn && view.session.account === view.checkout?.account && view.checkout, "checkout_identity_unverified");
        const checkout = view.checkout;
        requireBolt(checkout.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0) === checkout.subtotalMinor, "checkout_line_prices_do_not_reconcile");
        requireBolt(checkout.subtotalMinor + checkout.adjustments.reduce((total, adjustment) => total + adjustment.amountMinor, 0) === checkout.totalMinor, "checkout_totals_do_not_reconcile");
        requireBolt(checkout.lines.every((line) => line.quantity > 0), "empty_checkout_line");
        return [click(view.controls?.pay)];
      }
      default: throw new BoltFault("unsupported_action");
    }
  }
}
