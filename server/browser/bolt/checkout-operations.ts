import { BoltFault, requireBolt, type BoltCheckout, type BoltLine } from "./contracts.ts";
import { checkoutHash, type BoltPaymentAuthority } from "./runner.ts";
import { digest } from "./state.ts";

export interface CheckoutTransport {
  url(): string | Promise<string>;
  evaluate(script: string): Promise<unknown>;
}

/**
 * Trusted facts from the host's browser profile and session.
 *
 * `profileKey` is the approval scope the host already binds to this browser
 * profile, for example the key used by BoltPaymentAuthority. It is not a claim
 * that Bolt exposed a provider account id. `providerAccountId` is present only
 * when a host session source proves it. Never populate any of these fields from
 * an agent_browser_bolt tool argument.
 */
export interface CheckoutHostFacts {
  scope: "host_browser_profile";
  profileKey: string;
  providerAccountId?: string;
  branchId?: string;
  paymentMethod?: string;
  courierComment?: string;
}

export interface CheckoutReadOptions {
  origin?: string;
  guard?: () => void;
  host?: CheckoutHostFacts;
}

export type CheckoutMode = "delivery" | "pickup" | "schedule" | "unknown";

export interface CheckoutDeliveryOption {
  ref: string;
  id: string;
  label: string;
  mode: CheckoutMode;
  eta: string | null;
  feeMinor: number | null;
  available: boolean;
  selected: boolean;
  control: string;
}

export interface CheckoutPaymentOption {
  ref: string;
  label: string;
  available: boolean;
  selected: boolean;
  control: string;
}

/** Line and option IDs are deterministic local observation keys; the rendered checkout does not expose provider item IDs. */
export interface CheckoutObservedLine {
  ref: string;
  id: string;
  name: string;
  quantity: number;
  lineTotalMinor: number;
  unitPriceMinor: number | null;
  options: Array<{ label: string; quantity: number }>;
  comment: string;
  raw: string;
}

export interface CheckoutFeeRow {
  label: string;
  amountMinor: number;
  kind: "subtotal" | "adjustment" | "total";
  raw: string;
}

export interface CheckoutUnparsedFeeRow {
  text: string;
  reason: "unparsed";
}

export interface CheckoutPayControl {
  ref: string;
  label: string;
  text: string;
  enabled: boolean;
}

export interface CheckoutQuote {
  status: "complete" | "partial";
  url: string;
  checkoutDetected: boolean;
  payControl?: CheckoutPayControl;
  destination?: string;
  deliveryOptions: CheckoutDeliveryOption[];
  selectedDeliveryOption?: CheckoutDeliveryOption;
  paymentOptions: CheckoutPaymentOption[];
  selectedPaymentMethod?: string;
  lines: CheckoutObservedLine[];
  feeRows: CheckoutFeeRow[];
  subtotalMinor?: number;
  adjustments: Array<{ label: string; amountMinor: number }>;
  discounts: Array<{ label: string; amountMinor: number }>;
  unparsedFeeRows: CheckoutUnparsedFeeRow[];
  totalMinor?: number;
  payableMinor?: number;
  paymentTotalMinor?: number;
  courierComment: string;
  branchId?: string;
  account?: string;
  accountScope?: "host_browser_profile";
  providerAccountId?: string;
  missing: string[];
  conflicts: string[];
  observedHash: string;
  quoteHash: string;
  checkout?: BoltCheckout;
  checkoutHash?: string;
}

export interface CheckoutApproval {
  approvalRef: string;
  checkoutHash: string;
  checkout: BoltCheckout;
}

interface RawRow { text: string }
interface RawChoice { label: string; text: string; selected: boolean; disabled: boolean; testid?: string; control?: string }
interface RawPay { selector: string; label: string; text: string; enabled: boolean }
interface RawSnapshot {
  url: string;
  checkoutDetected: boolean;
  pay?: RawPay;
  payCandidates: string[];
  destinationCandidates: string[];
  deliveryOptions: RawChoice[];
  paymentOptions: RawChoice[];
  paymentLabel?: string;
  feeContainerPresent: boolean;
  feeRows: RawRow[];
  totalRows: RawRow[];
  itemRows: string[];
  note?: string;
  rootText: string;
}

const DEFAULT_ORIGIN = "https://food.bolt.eu";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeLabel(value: string): string {
  return value.replace(/[\ue000-\uf8ff]/g, "").replace(/\s+/g, " ").trim().replace(/[.:;,\s]+$/, "");
}

function parseMoney(value: string): number | undefined {
  const match = /([\u2212\u2013-])?\s*(\d[\d\s\u00a0.,]*)\s*€/.exec(value);
  if (!match) return undefined;
  let number = match[2].replace(/[\s\u00a0]/g, "");
  const negative = match[1] !== undefined;
  if (!number) return undefined;
  if (/^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?$/.test(number)) {
    const decimal = /[.,](\d{1,2})$/.exec(number);
    const whole = number.replace(/[.,]\d{1,2}$/, "").replace(/[.,]/g, "");
    number = `${whole}${decimal ? `.${decimal[1]}` : ""}`;
  } else if (/^\d+[.,]\d{1,2}$/.test(number)) {
    number = number.replace(",", ".");
  } else if (!/^\d+$/.test(number)) {
    return undefined;
  }
  const cents = Math.round(Number(number) * 100);
  if (!Number.isSafeInteger(cents)) return undefined;
  return negative ? -cents : cents;
}

function moneyAtEnd(value: string): { label: string; amountMinor: number } | undefined {
  const match = /^([\s\S]*?)([\u2212\u2013-]?\s*\d[\d\s\u00a0.,]*\s*€)\s*$/.exec(value.trim());
  if (!match) return undefined;
  const amountMinor = parseMoney(match[2]);
  if (amountMinor === undefined) return undefined;
  const label = normalizeLabel(match[1]);
  return label ? { label, amountMinor } : undefined;
}

function modeOf(label: string): CheckoutMode {
  if (/^pickup\b/i.test(label)) return "pickup";
  if (/^schedule\b/i.test(label)) return "schedule";
  if (/delivery/i.test(label)) return "delivery";
  return "unknown";
}

function etaOf(label: string): string | null {
  const match = /(\d+(?:\s*[-\u2013]\s*\d+)?)\s*min\b/i.exec(label);
  return match ? `${match[1].replace(/\s*[-\u2013]\s*/, "-")} min` : null;
}

function parseDestination(label: string): string | undefined {
  const normalized = normalizeLabel(label);
  const match = /^Delivery address\s*:?\s+(.+)$/i.exec(normalized);
  return match?.[1]?.trim() || undefined;
}

function parsePayable(pay: RawPay | undefined): number | undefined {
  if (!pay) return undefined;
  return parseMoney(pay.label) ?? parseMoney(pay.text);
}

function parseFeeRow(row: RawRow): { label: string; amountMinor: number } | undefined {
  return moneyAtEnd(row.text);
}

function classifyFee(label: string): "subtotal" | "adjustment" | "total" {
  if (/^(subtotal|item total)$/i.test(label)) return "subtotal";
  if (/^total$/i.test(label)) return "total";
  return "adjustment";
}

function rowsFromText(value: string): RawRow[] {
  const lines = value.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rows: RawRow[] = [];
  let previous: string | undefined;
  for (const line of lines) {
    if (/^[\u2212\u2013-]?\s*\d[\d\s\u00a0.,]*\s*€$/.test(line)) {
      if (previous && /subtotal|item total|total|fee|discount|service|delivery|small order|surcharge|tip|promo|bag|packaging|charge/i.test(previous)) {
        rows.push({ text: `${previous}${line}` });
      }
    } else if (/(subtotal|item total|total|fee|discount|service|delivery|small order|surcharge|tip|promo|bag|packaging|charge)[^€]*[\u2212\u2013-]?\s*\d[\d\s\u00a0.,]*\s*€$/i.test(line) &&
      !/away from free|saving/i.test(line)) {
      rows.push({ text: line });
    }
    previous = line;
  }
  return rows;
}

function rawSnapshot(value: unknown): RawSnapshot {
  if (!value || typeof value !== "object") throw new BoltFault("checkout_inspection_invalid");
  const record = value as Record<string, unknown>;
  const rawChoices = (input: unknown): RawChoice[] => asArray(input).flatMap((choice) => {
    if (!choice || typeof choice !== "object") return [];
    const item = choice as Record<string, unknown>;
    const label = asString(item.label);
    if (!label) return [];
    return [{
      label,
      text: asString(item.text) ?? label,
      selected: asBoolean(item.selected),
      disabled: asBoolean(item.disabled),
      testid: asString(item.testid),
      control: asString(item.control),
    }];
  });
  const pay = record.pay && typeof record.pay === "object" ? record.pay as Record<string, unknown> : undefined;
  return {
    url: asString(record.url) ?? "",
    checkoutDetected: asBoolean(record.checkoutDetected),
    pay: pay && asString(pay.selector) && asString(pay.label) !== undefined ? {
      selector: asString(pay.selector)!,
      label: asString(pay.label) ?? "",
      text: asString(pay.text) ?? "",
      enabled: asBoolean(pay.enabled),
    } : undefined,
    payCandidates: asArray(record.payCandidates).flatMap((candidate) => typeof candidate === "string" ? [candidate] : []),
    destinationCandidates: asArray(record.destinationCandidates).flatMap((candidate) => typeof candidate === "string" ? [candidate] : []),
    deliveryOptions: rawChoices(record.deliveryOptions),
    paymentOptions: rawChoices(record.paymentOptions),
    paymentLabel: asString(record.paymentLabel),
    feeContainerPresent: asBoolean(record.feeContainerPresent),
    feeRows: asArray(record.feeRows).flatMap((row) => row && typeof row === "object" && typeof (row as { text?: unknown }).text === "string" ? [{ text: (row as { text: string }).text }] : []),
    totalRows: asArray(record.totalRows).flatMap((row) => row && typeof row === "object" && typeof (row as { text?: unknown }).text === "string" ? [{ text: (row as { text: string }).text }] : []),
    itemRows: asArray(record.itemRows).flatMap((row) => typeof row === "string" ? [row] : []),
    note: asString(record.note),
    rootText: asString(record.rootText) ?? "",
  };
}

function parseLines(raw: string[]): { lines: CheckoutObservedLine[]; failed: string[] } {
  const lines: CheckoutObservedLine[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  for (const label of raw) {
    const normalized = normalizeLabel(label);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const match = /^(.*?)\.\s*Amount:\s*(\d+)\.\s*Price:\s*([\u2212\u2013-]?\s*\d[\d\s\u00a0.,]*\s*€)\.?(?:\s*Selected options:\s*(.*?))?(?:\.\s*Comment:\s*(.*))?$/.exec(normalized);
    if (!match) {
      failed.push(normalized);
      continue;
    }
    const name = match[1].trim();
    const quantity = Number(match[2]);
    const lineTotalMinor = parseMoney(match[3]);
    if (!name || !Number.isSafeInteger(quantity) || quantity <= 0 || lineTotalMinor === undefined) {
      failed.push(normalized);
      continue;
    }
    const optionsText = match[4]?.trim();
    const options = optionsText ? optionsText.split(/,\s*/).reduce<Array<{ label: string; quantity: number }>>((all, option) => {
      const previous = all.find((candidate) => candidate.label === option);
      if (previous) previous.quantity++;
      else all.push({ label: option, quantity: 1 });
      return all;
    }, []) : [];
    const comment = match[5]?.trim() ?? "";
    const index = lines.length;
    lines.push({
      ref: `checkout-line-${index}`,
      id: `checkout-line-${index}`,
      name,
      quantity,
      lineTotalMinor,
      unitPriceMinor: lineTotalMinor % quantity === 0 ? lineTotalMinor / quantity : null,
      options,
      comment,
      raw: normalized,
    });
  }
  return { lines, failed };
}

function toBoltLine(line: CheckoutObservedLine): BoltLine {
  requireBolt(line.unitPriceMinor !== null, "checkout_line_unit_price_unknown");
  return {
    ref: line.ref,
    id: line.id,
    name: line.name,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    options: line.options.flatMap((option) => Array.from({ length: option.quantity }, () => ({
      groupId: "observed-selected-options",
      groupLabel: "Selected options",
      choiceId: option.label,
      choiceLabel: option.label,
      quantity: 1,
    }))),
    comment: line.comment,
  };
}

/** Reads only checkout facts from the current page. It never clicks, fills, navigates or pays. */
export async function readCheckoutQuote(transport: CheckoutTransport, options: CheckoutReadOptions = {}): Promise<CheckoutQuote> {
  const origin = options.origin ?? DEFAULT_ORIGIN;
  options.guard?.();
  const url = await transport.url();
  checkOrigin(url, origin);
  const rawValue = await transport.evaluate(checkoutInspectionScript());
  options.guard?.();
  if (typeof rawValue === "string") {
    try {
      return await readFromRaw(JSON.parse(rawValue) as unknown, url, options);
    } catch (error) {
      if (error instanceof BoltFault) throw error;
      throw new BoltFault("checkout_inspection_invalid");
    }
  }
  return readFromRaw(rawValue, url, options);
}

async function readFromRaw(value: unknown, url: string, options: CheckoutReadOptions): Promise<CheckoutQuote> {
  const raw = rawSnapshot(value);
  checkOrigin(raw.url || url, options.origin ?? DEFAULT_ORIGIN);

  const destinationCandidates = [...new Set(raw.destinationCandidates.map(parseDestination).filter((value): value is string => !!value))];
  const destination = destinationCandidates.length === 1 ? destinationCandidates[0] : undefined;

  const deliveryOptions: CheckoutDeliveryOption[] = raw.deliveryOptions.map((choice, index) => ({
    ref: `delivery-${index}`,
    id: choice.label,
    label: choice.label,
    mode: modeOf(choice.label),
    eta: etaOf(choice.label),
    feeMinor: moneyAtEnd(choice.text)?.amountMinor ?? null,
    available: !choice.disabled,
    selected: choice.selected,
    control: choice.control ?? `delivery-${index}`,
  }));
  const selectedDelivery = deliveryOptions.filter((choice) => choice.selected);

  const paymentOptions: CheckoutPaymentOption[] = raw.paymentOptions.map((choice, index) => ({
    ref: `payment-${index}`,
    label: choice.label,
    available: !choice.disabled,
    selected: choice.selected,
    control: choice.control ?? `payment-${index}`,
  }));
  const selectedPayments = paymentOptions.filter((choice) => choice.selected);

  const parsedLines = parseLines(raw.itemRows);
  const lines = parsedLines.lines;

  const parsedRows: Array<{ row: CheckoutFeeRow } | { error: string }> = [];
  for (const row of raw.feeRows) {
    const parsed = parseFeeRow(row);
    if (parsed) parsedRows.push({ row: { ...parsed, kind: classifyFee(parsed.label), raw: row.text } });
    else parsedRows.push({ error: row.text });
  }
  if (raw.feeRows.length === 0) {
    for (const row of rowsFromText(raw.rootText)) {
      const parsed = parseFeeRow(row);
      if (parsed) parsedRows.push({ row: { ...parsed, kind: classifyFee(parsed.label), raw: row.text } });
    }
  }
  const feeRows: CheckoutFeeRow[] = [];
  const unparsedRows: string[] = [];
  for (const entry of parsedRows) {
    if ("row" in entry) feeRows.push(entry.row);
    else unparsedRows.push(entry.error);
  }
  const subtotalRows = feeRows.filter((row) => row.kind === "subtotal");
  const adjustmentRows = feeRows.filter((row) => row.kind === "adjustment");
  const totalRows = feeRows.filter((row) => row.kind === "total");

  const observedTotalRows = raw.totalRows.flatMap((row) => {
    const parsed = parseFeeRow(row);
    return parsed ? [parsed.amountMinor] : [];
  });
  const totalCandidates = [...new Set([...totalRows.map((row) => row.amountMinor), ...observedTotalRows])];
  const totalMinor = totalCandidates.length === 1 ? totalCandidates[0] : undefined;
  const payableMinor = parsePayable(raw.pay);
  const paymentLabel = raw.paymentLabel ? normalizeLabel(raw.paymentLabel) : undefined;
  const paymentTotalMinor = paymentLabel ? parseMoney(paymentLabel) : undefined;
  const selectedPaymentMethod = selectedPayments.length === 1
    ? selectedPayments[0].label
    : paymentLabel
      ? /^Selected payment method:\s*(.+?)(?:\.\s|$)/i.exec(paymentLabel)?.[1]?.trim()
      : undefined;

  const discounts = adjustmentRows.filter((row) => row.amountMinor < 0 || /discount|promo|coupon|saving/i.test(row.label));
  const missing = new Set<string>();
  const conflicts = new Set<string>();

  if (!raw.checkoutDetected) missing.add("checkout");
  if (!raw.pay) missing.add("payControl");
  if (raw.payCandidates.length > 1 && new Set(raw.payCandidates).size > 1) conflicts.add("pay_control_ambiguous");
  if (destinationCandidates.length === 0) missing.add("destination");
  if (destinationCandidates.length > 1) conflicts.add("destination_ambiguous");
  if (deliveryOptions.length === 0) missing.add("deliveryOptions");
  if (selectedDelivery.length === 0) missing.add("selectedDeliveryOption");
  if (selectedDelivery.length > 1) conflicts.add("delivery_selection_ambiguous");
  if (selectedDelivery.length === 1 && selectedDelivery[0].mode === "unknown") missing.add("deliveryMode");
  if (selectedDelivery.length === 1 && selectedDelivery[0].eta === null && selectedDelivery[0].mode !== "schedule") missing.add("deliveryEta");
  if (selectedDelivery.length === 1 && selectedDelivery[0].mode === "schedule") missing.add("scheduledSlot");
  if (unparsedRows.length > 0) missing.add("feeRowUnparsed");
  if (subtotalRows.length === 0) missing.add("subtotal");
  if (subtotalRows.length > 1) conflicts.add("subtotal_rows_ambiguous");
  if (totalCandidates.length === 0) {
    if (payableMinor !== undefined) {
      // The pay control is an exact accessible total even when the total row is unavailable.
      totalCandidates.push(payableMinor);
    } else {
      missing.add("total");
    }
  }
  if (observedTotalRows.length === 0 && totalRows.length === 0) missing.add("totalRow");
  if (totalCandidates.length > 1) conflicts.add("total_rows_disagree");
  if (totalMinor !== undefined && payableMinor !== undefined && totalMinor !== payableMinor) conflicts.add("payable_total_mismatch");
  if (paymentTotalMinor !== undefined && totalMinor !== undefined && paymentTotalMinor !== totalMinor) conflicts.add("payment_total_mismatch");
  if (paymentOptions.length > 0 && selectedPayments.length === 0 && !selectedPaymentMethod) missing.add("paymentMethod");
  if (selectedPayments.length > 1) conflicts.add("payment_method_ambiguous");
  if (lines.length === 0) missing.add("lines");
  if (parsedLines.failed.length > 0) missing.add("lineFacts");
  if (lines.some((line) => line.unitPriceMinor === null)) missing.add("unitPrice");
  if (lines.length > 0 && subtotalRows.length === 1) {
    const lineTotal = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
    if (lineTotal !== subtotalRows[0].amountMinor) conflicts.add("line_totals_do_not_reconcile");
  }
  const subtotalMinor = subtotalRows.length === 1 ? subtotalRows[0].amountMinor : undefined;
  const effectiveTotal = totalCandidates.length === 1 ? totalCandidates[0] : totalMinor;
  if (subtotalMinor !== undefined && effectiveTotal !== undefined) {
    const adjustmentTotal = adjustmentRows.reduce((sum, row) => sum + row.amountMinor, 0);
    if (subtotalMinor + adjustmentTotal !== effectiveTotal) conflicts.add("totals_do_not_reconcile");
  }
  if (selectedDelivery.length === 1 && selectedDelivery[0].mode === "delivery" &&
      !adjustmentRows.some((row) => /delivery/i.test(row.label)) &&
      selectedDelivery[0].feeMinor === null) {
    missing.add("deliveryFee");
  }

  const host = options.host;
  if (host?.scope !== "host_browser_profile") missing.add("hostBrowserProfile");
  if (!host?.profileKey?.trim()) missing.add("approvalProfile");
  const routeBranch = /\/checkout\/(\d+)(?:\/|$)/.exec(url)?.[1] ?? /\/p\/(\d+)(?:-|\/|$)/.exec(url)?.[1];
  const branchId = host?.branchId ?? routeBranch;
  if (!branchId) missing.add("branchId");
  if (host?.branchId && routeBranch && host.branchId !== routeBranch) conflicts.add("branch_route_mismatch");
  if (host?.paymentMethod && selectedPaymentMethod && host.paymentMethod !== selectedPaymentMethod) conflicts.add("payment_method_mismatch");
  const finalPaymentMethod = selectedPaymentMethod ?? host?.paymentMethod;
  if (!finalPaymentMethod) missing.add("paymentMethod");
  const courierComment = raw.note ?? host?.courierComment ?? "";

  const observed = {
    destination,
    branchId,
    account: host?.profileKey,
    accountScope: host?.scope,
    providerAccountId: host?.providerAccountId,
    deliveryOptions: deliveryOptions.map(({ control: _control, ref: _ref, ...choice }) => choice),
    selectedDeliveryOption: selectedDelivery.length === 1 ? selectedDelivery[0].id : undefined,
    paymentOptions: paymentOptions.map(({ control: _control, ref: _ref, ...choice }) => choice),
    paymentMethod: finalPaymentMethod,
    lines,
    subtotalMinor,
    adjustments: adjustmentRows.map(({ label, amountMinor }) => ({ label, amountMinor })),
    unparsedFeeRows: unparsedRows.map((text) => ({ text, reason: "unparsed" as const })),
    totalMinor: effectiveTotal,
    payableMinor: payableMinor ?? effectiveTotal,
    paymentTotalMinor,
    courierComment,
  };
  const observedHash = digest(observed);

  let checkout: BoltCheckout | undefined;
  if (missing.size === 0 && conflicts.size === 0 && destination && subtotalMinor !== undefined && effectiveTotal !== undefined &&
      selectedDelivery.length === 1 && finalPaymentMethod && branchId && host?.profileKey && lines.length > 0) {
    checkout = {
      account: host.profileKey,
      accountScope: "host_browser_profile",
      ...(host?.providerAccountId ? { providerAccountId: host.providerAccountId } : {}),
      branchId,
      currency: "EUR",
      destination,
      fulfilment: selectedDelivery[0].mode,
      deliveryOptionId: selectedDelivery[0].id,
      deliveryLabel: selectedDelivery[0].label,
      deliveryEta: selectedDelivery[0].eta ?? "",
      paymentMethod: finalPaymentMethod,
      courierComment,
      lines: lines.map(toBoltLine),
      subtotalMinor,
      adjustments: adjustmentRows.map(({ label, amountMinor }) => ({ label, amountMinor })),
      totalMinor: effectiveTotal,
    };
  }
  const status = missing.size === 0 && conflicts.size === 0 && checkout ? "complete" : "partial";
  const hash = checkout ? checkoutHash(checkout) : observedHash;
  return {
    status,
    url: raw.url,
    checkoutDetected: raw.checkoutDetected,
    payControl: raw.pay ? { ref: raw.pay.selector, label: raw.pay.label, text: raw.pay.text, enabled: raw.pay.enabled } : undefined,
    destination,
    deliveryOptions,
    selectedDeliveryOption: selectedDelivery.length === 1 ? selectedDelivery[0] : undefined,
    paymentOptions,
    selectedPaymentMethod: finalPaymentMethod,
    lines,
    feeRows,
    subtotalMinor,
    adjustments: adjustmentRows.map(({ label, amountMinor }) => ({ label, amountMinor })),
    discounts: discounts.map(({ label, amountMinor }) => ({ label, amountMinor })),
    unparsedFeeRows: unparsedRows.map((text) => ({ text, reason: "unparsed" as const })),
    totalMinor: effectiveTotal,
    payableMinor: payableMinor ?? effectiveTotal,
    paymentTotalMinor,
    courierComment,
    branchId,
    account: host?.profileKey,
    accountScope: host?.scope,
    ...(host?.providerAccountId ? { providerAccountId: host.providerAccountId } : {}),
    missing: [...missing].sort(),
    conflicts: [...conflicts].sort(),
    observedHash,
    quoteHash: hash,
    ...(checkout ? { checkout, checkoutHash: hash } : {}),
  };
}

function checkOrigin(value: string, origin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BoltFault("checkout_origin_required");
  }
  requireBolt(parsed.origin === origin && !parsed.username && !parsed.password, "checkout_origin_required");
}

/** Returns the existing approval-gate checkout only for a complete, reconciling quote. */
export function approvableCheckout(quote: CheckoutQuote): { checkout: BoltCheckout; checkoutHash: string } {
  requireBolt(quote.status === "complete" && quote.checkout && quote.checkoutHash, "checkout_quote_incomplete");
  return { checkout: quote.checkout, checkoutHash: quote.checkoutHash };
}

/** Composes with the host-owned authority. It requests an approval; it never pays. */
export async function requestCheckoutApproval(authority: BoltPaymentAuthority, quote: CheckoutQuote): Promise<CheckoutApproval> {
  const { checkout, checkoutHash: hash } = approvableCheckout(quote);
  requireBolt(authority.request, "checkout_approval_host_required");
  const approvalRef = await authority.request(checkout);
  return { approvalRef, checkoutHash: hash, checkout };
}

/**
 * Delegates to the existing host authority. Pass a quote read immediately
 * before pay; a caller-supplied or stale quote is not sufficient for payment.
 */
export async function verifyCheckoutApproval(authority: BoltPaymentAuthority, approvalRef: string, quote: CheckoutQuote): Promise<void> {
  const { checkoutHash: hash } = approvableCheckout(quote);
  await authority.verify(approvalRef, hash);
}

/**
 * Re-reads the page and verifies the approval against that fresh cart, fee,
 * address and payment-method observation. It still performs no payment.
 */
export async function revalidateCheckoutApproval(
  transport: CheckoutTransport,
  options: CheckoutReadOptions,
  approvalRef: string,
  authority: BoltPaymentAuthority,
): Promise<CheckoutQuote> {
  const quote = await readCheckoutQuote(transport, options);
  await verifyCheckoutApproval(authority, approvalRef, quote);
  return quote;
}

export function assertApprovalMatchesQuote(quote: CheckoutQuote, approvedCheckoutHash: string): void {
  const { checkoutHash: hash } = approvableCheckout(quote);
  requireBolt(hash === approvedCheckoutHash, "checkout_quote_changed");
}

/**
 * Atomic discovery against the vendor web test IDs observed in
 * https://food.bolt.eu/_expo/static/js/web/index-6c9f5a6981b9e8534582dd15d4cf5e0b.js
 * (sha256 df909f20...). Only visible checkout candidates are read.
 */
export function checkoutInspectionScript(): string {
  return `(() => {
    const visible = (element) => !!element && element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    const text = (element) => ((element.innerText || element.textContent || '')).trim();
    const attr = (element, name) => element.getAttribute(name);
    const unique = (elements) => [...new Set(elements)];
    const query = (selector) => [...document.querySelectorAll(selector)].filter(visible);
    const cssPath = (element) => {
      const parts = [];
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        let index = 1;
        for (let previous = node.previousElementSibling; previous; previous = previous.previousElementSibling) index++;
        parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + index + ')');
      }
      return parts.join(' > ');
    };
    const selected = (element) => {
      if (attr(element, 'aria-checked') === 'true' || attr(element, 'aria-selected') === 'true' || attr(element, 'data-selected') === 'true') return true;
      if (element.querySelector('[data-testid$="radio:checked"], [data-testid$="radio:checked:disabled"]')) return true;
      return /(^|\\s)(selected|active)(\\s|$)/i.test(attr(element, 'class') || '');
    };
    const disabled = (element) => element.disabled === true || attr(element, 'aria-disabled') === 'true' ||
      !!element.querySelector('[data-testid$="radio:disabled"], [data-testid$="radio:checked:disabled"]');
    const payById = query('[data-testid="screens.OnePageCheckout.confirmSimpleButton"]');
    const payElements = payById.length ? payById : query('button, [role="button"]').filter((element) =>
      /checkout button|confirm order and pay/i.test(attr(element, 'aria-label') || '') || /^place order$/i.test(text(element)));
    const pay = payElements.length === 1 ? payElements[0] : undefined;
    const destinationCandidates = [];
    for (const element of query('[data-testid="screens.Checkout.checkoutDestinationRow"]')) {
      let label = '';
      for (let node = element; node && !label; node = node.parentElement) {
        const candidate = attr(node, 'aria-label');
        if (candidate && /^Delivery address\\b/i.test(candidate)) label = candidate;
      }
      label = label || attr(element, 'aria-label') || text(element);
      if (label) destinationCandidates.push(label);
    }
    for (const element of query('[aria-label^="Delivery address "], [aria-label^="Delivery address:"]')) destinationCandidates.push(attr(element, 'aria-label'));
    const deliveryOptions = [];
    const deliveryElements = query('[data-testid="components.Checkout.CheckoutDeliveryOptions.dispatchOption"]');
    const deliveryFallback = deliveryElements.length ? [] : query('button[aria-label*="delivery"], button[aria-label^="Pickup"], button[aria-label^="Schedule"]');
    for (const element of unique([...deliveryElements, ...deliveryFallback])) {
      const label = attr(element, 'aria-label') || text(element);
      if (!label) continue;
      deliveryOptions.push({ label, text: text(element), selected: selected(element), disabled: disabled(element), testid: attr(element, 'data-testid'), control: cssPath(element) });
    }
    const paymentOptions = [];
    for (const element of query('[data-testid^="OrderPaymentMethodTabs.tab."]')) {
      const testid = attr(element, 'data-testid') || '';
      if (/\\.(addCard|showAll)$/.test(testid)) continue;
      const label = attr(element, 'aria-label') || text(element);
      if (!label) continue;
      paymentOptions.push({ label, text: text(element), selected: selected(element), disabled: disabled(element), testid, control: cssPath(element) });
    }
    const paymentLabel = query('[aria-label^="Selected payment method:"]').map((element) => attr(element, 'aria-label')).filter(Boolean)[0];
    const feeContainers = query('[data-testid="components.OrderFees.feesContainer"]');
    const feeRows = [];
    for (const container of feeContainers) {
      for (const row of [...container.querySelectorAll('[data-testid="components.OrderFees.feeItem"]')].filter(visible)) feeRows.push({ text: text(row) });
    }
    const totalRows = [];
    for (const selector of ['[data-testid="screens.OnePageCheckout.totalPriceRow"]', '[data-testid="screens.OnePageCheckout.finalTotalPriceRow"]']) {
      for (const row of query(selector)) totalRows.push({ text: text(row) });
    }
    const itemRows = [];
    for (const row of query('[data-testid="features.CheckoutItemRow.editButton2"]')) {
      const label = attr(row, 'aria-label') || text(row);
      if (label) itemRows.push(label);
    }
    if (itemRows.length === 0) {
      for (const row of query('[data-testid="components.CheckoutItem.touchableContainer"]')) {
        const label = attr(row, 'aria-label') || text(row);
        if (label) itemRows.push(label);
      }
    }
    const noteElement = query('[data-testid="components.OrderComment.noteInput"]')[0];
    const note = noteElement ? (noteElement.value !== undefined ? noteElement.value : text(noteElement)) : undefined;
    let root = pay || document.body;
    for (let depth = 0; depth < 8 && root.parentElement; depth++) {
      root = root.parentElement;
      const content = text(root);
      if (content.length > 120 && /(Subtotal|Item total|Total)/.test(content) && /€/.test(content)) break;
    }
    const checkoutDetected = payElements.length > 0 || feeContainers.length > 0 || totalRows.length > 0 ||
      destinationCandidates.length > 0 || deliveryOptions.length > 0;
    return {
      url: location.href,
      checkoutDetected,
      ...(pay ? { pay: { selector: cssPath(pay), label: attr(pay, 'aria-label') || '', text: text(pay), enabled: !disabled(pay) } } : {}),
      payCandidates: payElements.map(cssPath),
      destinationCandidates,
      deliveryOptions,
      paymentOptions,
      ...(paymentLabel ? { paymentLabel } : {}),
      feeContainerPresent: feeContainers.length > 0,
      feeRows,
      totalRows,
      itemRows,
      ...(note !== undefined ? { note } : {}),
      rootText: text(root).slice(0, 12000),
    };
  })()`;
}
