import type { TimeAllocation, TimeAllocationExtension } from "../shared/wire.ts";

export type { TimeAllocation, TimeAllocationExtension };

export type TimeAllocationKind = "duration" | "deadline";
export type TimeAllocationState = "within" | "at_risk" | "missed";

export interface TimeAllocationParseOptions {
  now: number;
  messageId?: string;
  /** An explicit zone for a local-looking deadline. Never guessed from the host. */
  timeZone?: string;
}

const UNIT_MS: Record<string, number> = {
  s: 1_000, sec: 1_000, secs: 1_000, second: 1_000, seconds: 1_000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
};

const MAX_ALLOCATION_MS = 30 * 24 * 60 * 60_000;
const UNIT_PATTERN = "seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h";
const AMOUNT_PATTERN = "-?\\d+(?:\\.\\d+)?";
// Only a directive that actually assigns time counts. A stray duration in
// ambient prose (a meeting, a wait, a historical estimate) is not a deadline.
const DURATION_PATTERNS = [
  new RegExp(`\\byou(?:'ve| have)(?: got)?\\s+(${AMOUNT_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "i"),
  new RegExp(`\\b(?:finish|complete|deliver|send|post|reply|respond|return|do|work|wrap up)\\b[^.!?\\n]{0,60}?\\b(?:in|within)\\s+(${AMOUNT_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "i"),
  new RegExp(`\\b(?:in|within)\\s+(${AMOUNT_PATTERN})\\s*(${UNIT_PATTERN})\\b[^.!?\\n]{0,40}?\\b(?:you must|please|finish|complete|deliver|send|post|reply|respond|return)\\b`, "i"),
  new RegExp(`\\b(?:deadline|time limit)(?:\\s+is)?\\s*:?\\s*(${AMOUNT_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "i"),
  new RegExp(`\\b(?:extension|another|additional|extra|more time)\\b[^.!?\\n]{0,40}?\\b(${AMOUNT_PATTERN})\\s*(${UNIT_PATTERN})\\b`, "i"),
];

const EXTENSION = /\b(?:extension|another|additional|extra|more time)\b/i;
const NEGATED_EXTENSION = /\b(?:no|not|without|deny|denied|refuse|refused)\s+(?:an?\s+)?(?:extension|more time|additional time)\b/i;
const NEW_OBJECTIVE = /\b(?:new|another|different)\s+(?:objective|task|job|request|assignment|project)\b/i;
const CONTINUATION = /\b(?:status|continue|resume|clarif|follow.?up|update on)\b/i;
const ISO_DEADLINE = /\b(?:by|before|deadline(?:\s+is)?|due(?:\s+at)?)\s+(\d{4}-\d{2}-\d{2}[T ][0-9:]+(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b/i;
const ISO_WITHOUT_ZONE = /\b(?:by|before|deadline(?:\s+is)?|due(?:\s+at)?)\s+(\d{4}-\d{2}-\d{2}[T ][0-9:]+(?:\.\d+)?)\b/i;
const CLOCK_DEADLINE = /\b(?:by|before|deadline(?:\s+is)?|due(?:\s+at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(UTC|GMT|Z)\b/i;

function deadlineForClock(now: number, hour: number, minute: number, meridiem: string | undefined): number | null {
  let h = hour;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    h = h % 12 + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  if (h > 23 || minute > 59) return null;
  const date = new Date(now);
  const candidate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, minute, 0, 0);
  // A time already passed means the next occurrence. This is a clock rule, not
  // a model estimate, and the source line records which day it chose.
  return candidate <= now ? candidate + 24 * 60 * 60_000 : candidate;
}

/** Parses only an explicit person allocation. Ambient prose such as "in five minutes" is not one. */
export function parseExplicitTimeAllocation(text: string, options: TimeAllocationParseOptions): TimeAllocation | null {
  const sourceText = text.replace(/\s+/g, " ").trim();
  if (!sourceText) return null;
  const now = options.now;
  if (!Number.isFinite(now)) return null;

  const iso = ISO_DEADLINE.exec(sourceText);
  if (iso) {
    const deadlineAt = Date.parse(iso[1]!);
    if (Number.isFinite(deadlineAt)) return allocationFromDeadline(sourceText, options, deadlineAt, "deadline");
  }
  // A date-time without an explicit zone is not an unambiguous timestamp.
  if (ISO_WITHOUT_ZONE.test(sourceText)) return null;

  const clock = CLOCK_DEADLINE.exec(sourceText);
  if (clock) {
    const deadlineAt = deadlineForClock(now, Number(clock[1]), Number(clock[2] ?? "0"), clock[3]);
    if (deadlineAt !== null) return allocationFromDeadline(sourceText, options, deadlineAt, "deadline", (clock[4] ?? "UTC").toUpperCase());
  }

  const duration = DURATION_PATTERNS.map(pattern => pattern.exec(sourceText)).find(Boolean);
  if (!duration) return null;
  const amount = Number(duration[1]);
  const unit = UNIT_MS[duration[2]!.toLowerCase()];
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  const ms = amount * unit;
  if (!Number.isFinite(ms) || ms > MAX_ALLOCATION_MS) return null;
  return allocationFromDeadline(sourceText, options, now + ms, "duration");
}

function allocationFromDeadline(
  sourceText: string,
  options: TimeAllocationParseOptions,
  deadlineAt: number,
  kind: TimeAllocationKind,
  timeZone?: string,
): TimeAllocation {
  return {
    ...(options.messageId ? { sourceMessageId: options.messageId } : {}),
    sourceText,
    sourceAt: options.now,
    startedAt: options.now,
    deadlineAt,
    originalDeadlineAt: deadlineAt,
    allocatedMs: Math.max(0, deadlineAt - options.now),
    kind,
    ...(timeZone ? { timeZone } : {}),
  };
}

export function remainingMs(allocation: Pick<TimeAllocation, "deadlineAt">, now: number): number {
  return allocation.deadlineAt - now;
}

/** Reserve covers integration and verification, not an arbitrary safety margin. */
export function timeAllocationState(
  allocation: Pick<TimeAllocation, "deadlineAt" | "allocatedMs">,
  now: number,
  reserveMs = 0,
): TimeAllocationState {
  const remaining = remainingMs(allocation, now);
  if (remaining <= 0) return "missed";
  const reserve = Math.max(0, reserveMs);
  if (remaining <= reserve || remaining <= Math.max(0, allocation.allocatedMs) * 0.2) return "at_risk";
  return "within";
}

function isStartDeadline(allocation: Pick<TimeAllocation, "sourceText">): boolean {
  return /\byou(?:'ve| have)(?: got)?\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\s+to\s+(?:start|begin)\b/i.test(allocation.sourceText)
    && !/\b(?:stop|finish|complete|end|until)\b/i.test(allocation.sourceText);
}

/** Time allocations are delivery commitments; missing one never stops authorized work or revokes authority. */
export function canStartEffect(
  _allocation: (Pick<TimeAllocation, "deadlineAt" | "allocatedMs"> & Partial<Pick<TimeAllocation, "sourceText">>) | undefined,
  _now: number,
): boolean {
  return true;
}

export function isExtension(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  return EXTENSION.test(clean) && !NEGATED_EXTENSION.test(clean);
}

/** A genuinely new request is an explicit identity statement, not a status ping or a continuation. */
export function isExplicitNewObjective(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  return NEW_OBJECTIVE.test(clean) && !CONTINUATION.test(clean);
}

/** Apply a person's time statement without letting an ordinary follow-up reset the clock. */
export function updateTimeAllocation(
  current: TimeAllocation | undefined,
  text: string,
  parsed: TimeAllocation | null,
  now: number,
): TimeAllocation | null {
  if (!parsed) return current && isExplicitNewObjective(text) ? null : current ?? null;
  if (!current) return parsed;
  if (isExtension(text)) return applyTimeExtension(current, parsed, now);
  if (isExplicitNewObjective(text)) return parsed;
  return current;
}

/** Only a person's explicit new allocation extends a deadline; the original stays recorded. */
export function applyTimeExtension(
  current: TimeAllocation,
  parsed: TimeAllocation,
  now: number,
): TimeAllocation {
  const proposed = parsed.kind === "duration" ? now + parsed.allocatedMs : parsed.deadlineAt;
  const deadlineAt = Math.max(current.deadlineAt, proposed);
  return {
    ...current,
    deadlineAt,
    allocatedMs: current.allocatedMs + Math.max(0, deadlineAt - current.deadlineAt),
    extensions: [...(current.extensions ?? []), {
      ...(parsed.sourceMessageId ? { sourceMessageId: parsed.sourceMessageId } : {}),
      sourceText: parsed.sourceText,
      at: now,
      previousDeadlineAt: current.deadlineAt,
      deadlineAt,
    }],
  };
}

/** A child runs inside the parent's window; its own start never moves the deadline. */
export function inheritedTimeAllocation(parent: TimeAllocation): TimeAllocation {
  return { ...parent, extensions: parent.extensions ? parent.extensions.map(extension => ({ ...extension })) : undefined };
}

export function timeAllocationLine(allocation: TimeAllocation, now: number, reserveMs = 0): string {
  const state = timeAllocationState(allocation, now, reserveMs);
  const deadline = new Date(allocation.deadlineAt).toISOString();
  if (isStartDeadline(allocation)) {
    return `START COMMITMENT (${state}): ${allocation.sourceText} Start deadline ${deadline}. Preserve this commitment and report a missed start honestly. This is not a completion deadline, a stop instruction or a limit on authority: continue the next authorized operation without asking for a new time allocation. Purchase approvals and explicit stops remain in force.`;
  }
  if (state === "missed") {
    return `TIME ALLOCATION (missed): ${allocation.sourceText} Deadline ${deadline} has passed. This is a missed delivery commitment, not a stop instruction or a revocation of authority: continue the authorized work, preserve completed work and report the missed deadline honestly. Reconcile any uncertain external effect before retrying. Only a new explicit person allocation changes the deadline. Purchase approvals and explicit stops remain in force.`;
  }
  const remaining = remainingMs(allocation, now);
  const minutes = Math.max(0, Math.ceil(remaining / 60_000));
  return `TIME ALLOCATION (${state}): ${allocation.sourceText} Deadline ${deadline}; about ${minutes} minute(s) left. This is a delivery commitment, not a stop instruction or a limit on authority. Queueing, delegation, retries, failover and verification do not reset it. Continue authorized work, reserve time for integration and verification, and report a missed deadline honestly. Only a new explicit person allocation changes the deadline. Purchase approvals and explicit stops remain in force.`;
}
