import { z } from "zod";

import { connectorCallsIn, isOutboundTool } from "../shared/outbound.ts";

/**
 * The admission contract is intentionally narrower than prose: the lead names
 * the workflow, independently verifiable deliverables and operations it is
 * asking an executor to perform. Unknown or bundled work returns to the lead.
 */
export const MARKETING_WORKFLOWS = [
  "single-channel",
  "newsletter-platform-production",
  "artifact-production",
  "research",
  "multi-channel",
] as const;

export type MarketingWorkflow = typeof MARKETING_WORKFLOWS[number];

export const MARKETING_OPERATIONS = [
  "research", "review", "prepare", "assemble", "install_template",
  "configure_campaign", "publish", "verify",
] as const;
export type MarketingOperation = typeof MARKETING_OPERATIONS[number];

export interface MarketingAdmission {
  objectiveId: string;
  briefRevision: string;
  workflow: MarketingWorkflow;
  deliverables: Array<{ id: string; channel?: string; account?: string; acceptance: string }>;
  operations: MarketingOperation[];
  estimatedDurationMs?: number;
  verificationReserveMs?: number;
}

const identifier = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const deliverable = z.object({
  id: identifier,
  channel: z.string().trim().min(1).max(80).optional(),
  account: z.string().trim().min(1).max(160).optional(),
  acceptance: z.string().trim().min(1).max(300),
}).strict();
export const marketingAdmissionSchema = z.object({
  objectiveId: identifier,
  briefRevision: identifier,
  workflow: z.enum(MARKETING_WORKFLOWS),
  deliverables: z.array(deliverable).min(1).max(6),
  operations: z.array(z.enum(MARKETING_OPERATIONS)).min(1).max(12),
  estimatedDurationMs: z.number().int().positive().max(30 * 24 * 60 * 60_000).optional(),
  verificationReserveMs: z.number().int().nonnegative().max(7 * 24 * 60 * 60_000).optional(),
}).strict();

interface WorkflowPolicy {
  maxDeliverables: number;
  channels: boolean;
  operations: readonly MarketingOperation[];
}

const POLICIES: Record<MarketingWorkflow, WorkflowPolicy> = {
  "single-channel": {
    maxDeliverables: 1, channels: true,
    operations: ["research", "review", "prepare", "publish", "verify"],
  },
  "newsletter-platform-production": {
    maxDeliverables: 3, channels: false,
    operations: ["research", "review", "prepare", "assemble", "install_template", "configure_campaign", "verify"],
  },
  "artifact-production": {
    maxDeliverables: 2, channels: false,
    operations: ["research", "review", "prepare", "assemble", "verify"],
  },
  "research": {
    maxDeliverables: 1, channels: false,
    operations: ["research", "review"],
  },
  "multi-channel": {
    maxDeliverables: 6, channels: true,
    operations: ["research", "review", "prepare", "publish", "verify"],
  },
};

/**
 * A batch workflow is admitted only after the capability has been demonstrated.
 * Add a workflow here only with execution receipts that cover its channels and
 * its exceptional cases. A model saying it is competent is not evidence.
 */
const KNOWN_CHANNELS = new Set([
  "linkedin", "x", "twitter", "bluesky", "threads", "mastodon", "hackernews",
  "email", "newsletter", "website", "blog", "youtube", "instagram", "facebook",
  "reddit", "slack", "telegram", "whatsapp", "tiktok", "pinterest", "github",
]);

const DEMONSTRATED_MULTI_DELIVERABLE = new Set<MarketingWorkflow>([
  "newsletter-platform-production",
  "artifact-production",
]);

export type AdmissionOutcome =
  | {
      ok: true;
      admission: MarketingAdmission;
      timing: { remainingMs: number | null; estimate: "known" | "unknown"; reserveMs: number };
      note: string;
    }
  | {
      ok: false;
      status: "needs_information" | "needs_decomposition" | "time_budget_insufficient";
      code: string;
      objectiveId?: string;
      ownership: string;
      reason: string;
      offending: { workflow?: string; deliverables: string[]; channels: string[]; operations: string[] };
      nextAction: string;
      required?: string[];
    };

export interface AdmissionContext {
  now: number;
  deadlineAt?: number;
  reserveMs?: number;
  /** The teammate or role that owns the parent objective. Never assume Darcy. */
  owner?: string;
}

const failure = (
  status: Extract<AdmissionOutcome, { ok: false }>["status"],
  code: string,
  reason: string,
  input: Partial<MarketingAdmission> | undefined,
  nextAction: string,
  owner: string,
  extra: { offending?: Partial<Extract<AdmissionOutcome, { ok: false }>["offending"]>; required?: string[] } = {},
): AdmissionOutcome => ({
  ok: false, status, code, ...(input?.objectiveId ? { objectiveId: input.objectiveId } : {}),
  ownership: owner, reason,
  offending: {
    ...(input?.workflow ? { workflow: input.workflow } : {}),
    deliverables: extra.offending?.deliverables ?? (input?.deliverables ?? []).map(item => item.id),
    channels: extra.offending?.channels ?? (input?.deliverables ?? []).flatMap(item => item.channel ? [item.channel] : []),
    operations: extra.offending?.operations ?? (input?.operations ?? []),
  },
  nextAction, ...(extra.required ? { required: extra.required } : {}),
});

export function validateMarketingAdmission(raw: unknown, context: AdmissionContext): AdmissionOutcome {
  const owner = context.owner?.trim() || "the responsible lead";
  const parsed = marketingAdmissionSchema.safeParse(raw);
  if (!parsed.success) {
    const missing = parsed.error.issues.filter(issue => issue.code === "invalid_type" && issue.message.includes("undefined"))
      .map(issue => issue.path.join("."));
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join(".")).filter(Boolean))];
    return failure("needs_information", "admission_required",
      `A structured admission is required before an executor turn. Supply objectiveId, briefRevision, workflow, independently verifiable deliverables, operations and acceptance evidence. Invalid or missing: ${fields.join(", ") || "admission"}.`,
      undefined, `${owner} revises the assignment in this turn; do not hand planning to the user.`, owner, { required: missing.length ? missing : fields });
  }
  const admission = parsed.data;
  const policy = POLICIES[admission.workflow];
  if (admission.deliverables.length > policy.maxDeliverables) {
    return failure("needs_decomposition", "too_many_deliverables",
      `${admission.workflow} admits ${policy.maxDeliverables} independently verifiable deliverable(s); this assignment declares ${admission.deliverables.length}. Split the work into separate assignments.`,
      admission, `${owner} splits the work by deliverable/channel and sends each admitted assignment separately.`, owner);
  }
  if (new Set(admission.deliverables.map(item => item.id)).size !== admission.deliverables.length) {
    return failure("needs_decomposition", "duplicate_deliverable", "Deliverable ids must be distinct; one id names one verifiable output.", admission,
      `${owner} gives each deliverable one stable id and one acceptance check.`, owner);
  }
  if (policy.channels) {
    const channels = admission.deliverables.map(item => item.channel?.toLowerCase()).filter((channel): channel is string => Boolean(channel));
    if (channels.length !== admission.deliverables.length) {
      return failure("needs_information", "channel_required", "Each channel deliverable must name the exact channel/account scope.", admission,
        `${owner} names the exact channel/account for each deliverable.`, owner);
    }
    if (new Set(channels).size !== channels.length) {
      return failure("needs_decomposition", "duplicate_channel", "The same channel appears twice; one channel is one assignment.", admission,
        `${owner} sends one assignment per channel or uses a demonstrated batch workflow.`, owner);
    }
    const unknownChannels = channels.filter(channel => !KNOWN_CHANNELS.has(channel));
    if (unknownChannels.length) {
      return failure("needs_information", "unknown_channel",
        `Unknown channel(s): ${unknownChannels.join(", ")}. Name one concrete external channel, not a bundle name such as "social".`,
        admission, `${owner} names the exact channel/account; do not hide a bundle behind a generic channel name.`, owner);
    }
  }
  if (admission.deliverables.length > 1 && !DEMONSTRATED_MULTI_DELIVERABLE.has(admission.workflow)) {
    return failure("needs_decomposition", "capability_not_demonstrated",
      `${admission.workflow} is not a demonstrated multi-deliverable workflow. The system will not accept a batch merely because the lead declares it; split it or promote the workflow with execution evidence.`,
      admission, `${owner} splits by deliverable/channel. A proven workflow can be promoted later with receipts.`, owner);
  }
  const outsideOperations = admission.operations.filter(operation => !policy.operations.includes(operation));
  if (outsideOperations.length) {
    return failure("needs_decomposition", "operation_outside_workflow",
      `Operation(s) ${outsideOperations.join(", ")} are outside ${admission.workflow}. Do not attach an extra operation to a narrower workflow.`,
      admission, `${owner} creates a separate assignment with the operation its own workflow admits.`, owner,
      { offending: { operations: outsideOperations } });
  }
  if (admission.operations.includes("publish") && !policy.channels) {
    return failure("needs_decomposition", "publish_without_channel", "Publishing requires a channel workflow with an exact channel and authority.", admission,
      `${owner} uses single-channel/multi-channel admission with the exact account.`, owner);
  }
  if (admission.operations.includes("publish")) {
    const missingAccounts = admission.deliverables.filter(item => !item.account).map(item => item.id);
    if (missingAccounts.length) {
      return failure("needs_information", "account_required",
        `Publishing requires the exact target account for each deliverable. Missing account: ${missingAccounts.join(", ")}.`,
        admission, `${owner} names the exact account for each published deliverable; channel alone is not enough.`, owner,
        { offending: { deliverables: missingAccounts } });
    }
  }
  if (context.deadlineAt !== undefined) {
    const remainingBeforeReserve = context.deadlineAt - context.now;
    // Reserve at most 20% of the remaining window, capped at one minute, so
    // integration and verification are budgeted without making a short
    // allocation impossible. This is a planning default, not a duration claim.
    const defaultReserve = Math.min(60_000, Math.max(0, Math.floor(remainingBeforeReserve * 0.2)));
    const reserveMs = Math.max(context.reserveMs ?? 0, admission.verificationReserveMs ?? 0, defaultReserve);
    const remaining = remainingBeforeReserve - reserveMs;
    if (remaining <= 0) {
      return failure("time_budget_insufficient", "time_expired",
        `The current allocation has no remaining time after the ${Math.round(reserveMs / 1000)}s verification reserve. Do not start an executor turn. Record the unmet commitment and preserve completed work.`,
        admission, `${owner} replans inside the original allocation or asks for an explicit new time allocation; do not infer an extension.`, owner,
        { offending: { deliverables: admission.deliverables.map(item => item.id) } });
    }
    if (admission.estimatedDurationMs !== undefined && admission.estimatedDurationMs > remaining) {
      return failure("time_budget_insufficient", "time_budget_insufficient",
        `The declared estimate (${Math.round(admission.estimatedDurationMs / 1000)}s) exceeds the ${Math.round(remaining / 1000)}s remaining after the verification reserve. This is a known-infeasible scope, not permission to overrun.`,
        admission, `${owner} reduces the admitted scope or uses a shorter committed work unit; no model-granted extension.`, owner,
        { offending: { deliverables: admission.deliverables.map(item => item.id) } });
    }
    return {
      ok: true, admission,
      timing: {
        remainingMs: remaining,
        estimate: admission.estimatedDurationMs === undefined ? "unknown" : "known",
        reserveMs,
      },
      note: admission.estimatedDurationMs === undefined
        ? `Time remaining ${Math.round(remaining / 1000)}s; no duration estimate supplied, so feasibility is unknown and must be surfaced as at risk.`
        : `Time remaining ${Math.round(remaining / 1000)}s; declared estimate ${Math.round(admission.estimatedDurationMs / 1000)}s including ${Math.round(reserveMs / 1000)}s reserve.`,
    };
  }
  return {
    ok: true, admission,
    timing: { remainingMs: null, estimate: admission.estimatedDurationMs === undefined ? "unknown" : "known", reserveMs: context.reserveMs ?? 0 },
    note: "No explicit time allocation is recorded for this parent; no deadline was invented.",
  };
}

export function admissionBrief(admission: MarketingAdmission, timing: { remainingMs: number | null; estimate: "known" | "unknown"; reserveMs: number }): string {
  const deliverables = admission.deliverables.map(item =>
    `- ${item.id}${item.channel ? ` (${item.channel}${item.account ? `, ${item.account}` : ""})` : ""}: ${item.acceptance}`).join("\n");
  return [
    "[ADMITTED SCOPE — execute only this]",
    `Workflow: ${admission.workflow}; objective: ${admission.objectiveId}; brief revision: ${admission.briefRevision}`,
    `Deliverables (${admission.deliverables.length}):`,
    deliverables,
    `Operations: ${admission.operations.join(", ")}`,
    timing.remainingMs === null
      ? "Time allocation: none recorded for this parent; do not invent one."
      : `Time remaining: ${Math.max(0, Math.round(timing.remainingMs / 1000))}s; verification reserve: ${Math.round(timing.reserveMs / 1000)}s; estimate: ${timing.estimate}.`,
    "Extra work, another channel or another operation requires a separate admitted assignment. Do not silently combine them. A missing connector is one exact blocker to return to the lead; do not substitute a browser or local design/copy.",
  ].join("\n");
}

export type OutwardScope = "within" | "outside" | "unverifiable";

const CHANNEL_MATCHERS: Array<[RegExp, string]> = [
  [/linkedin/i, "linkedin"],
  [/bluesky/i, "bluesky"],
  [/threads/i, "threads"],
  [/twitter|(?:^|_)x(?:_|$)/i, "x"],
  [/mastodon/i, "mastodon"],
  [/hacker(?:_| )?news/i, "hackernews"],
  [/postmark|keila|gmail|email|newsletter/i, "email"],
  [/slack/i, "slack"],
  [/instagram/i, "instagram"],
  [/facebook/i, "facebook"],
  [/reddit/i, "reddit"],
  [/telegram/i, "telegram"],
  [/whatsapp/i, "whatsapp"],
  [/tiktok/i, "tiktok"],
  [/pinterest/i, "pinterest"],
  [/github/i, "github"],
  [/youtube/i, "youtube"],
];

function channelForTool(label: string): string | undefined {
  return CHANNEL_MATCHERS.find(([pattern]) => pattern.test(label))?.[1];
}

export interface EffectDecision {
  ok: boolean;
  code?: "out_of_scope" | "scope_unverifiable";
  reason?: string;
  channels: string[];
}

/**
 * Deterministic pre-effect check for one tool call. A declared one-channel
 * admission cannot publish on a second channel, and an opaque code path is
 * refused because its channel and operation cannot be checked.
 */
export function effectWithinAdmission(admission: MarketingAdmission, toolName: string, args: unknown): EffectDecision {
  const calls = connectorCallsIn(toolName, args);
  const outward = calls.filter(call => isOutboundTool(call.slug));
  if (!outward.length) return { ok: true, channels: [] };
  if (!admission.operations.includes("publish")) {
    return { ok: false, code: "out_of_scope", channels: [], reason: "The admitted operations do not include publish; no outward send may start." };
  }
  const declared = new Set(admission.deliverables.flatMap(item => item.channel ? [item.channel.toLowerCase()] : []));
  const seen: string[] = [];
  for (const call of outward) {
    if (call.slug === "COMPOSIO_PROXY_EXECUTE") {
      return { ok: false, code: "scope_unverifiable", channels: [], reason: "This call runs app or shell code whose channel and operation cannot be verified against the admitted scope. Use the exact direct app tool." };
    }
    const channel = channelForTool(call.slug);
    if (!channel) {
      return { ok: false, code: "scope_unverifiable", channels: [], reason: `The outward tool ${call.slug} does not name a channel that can be checked against the admitted scope.` };
    }
    if (!declared.has(channel)) {
      return { ok: false, code: "out_of_scope", channels: [channel], reason: `The outward tool ${call.slug} targets ${channel}, outside the admitted channel(s): ${[...declared].join(", ") || "none"}.` };
    }
    seen.push(channel);
  }
  return { ok: true, channels: [...new Set(seen)] };
}

/** A post-turn check remains; the pre-effect check above is the enforcement point. */
export function outwardWithinAdmission(admission: MarketingAdmission, outward: readonly string[] | undefined): OutwardScope {
  if (!outward?.length) return "within";
  const channels = new Set(admission.deliverables.flatMap(item => item.channel ? [item.channel.toLowerCase()] : []));
  let unverifiable = false;
  for (const label of outward) {
    if (label === "COMPOSIO_PROXY_EXECUTE") {
      unverifiable = true;
      continue;
    }
    // Multi-execute is decoded by the pre-effect gate; its wrapper name has
    // no channel of its own.
    if (label === "COMPOSIO_MULTI_EXECUTE_TOOL") continue;
    if (!isOutboundTool(label)) continue;
    if (!admission.operations.includes("publish")) return "outside";
    const channel = channelForTool(label);
    if (!channel) {
      unverifiable = true;
      continue;
    }
    if (!channels.has(channel)) return "outside";
  }
  return unverifiable ? "unverifiable" : "within";
}

/** Bounded retry guard: an invalid dispatch may be corrected once, not bounced forever. */
export class AdmissionBounceGuard {
  private readonly attempts = new Map<string, { count: number; at: number }>();
  private readonly limit: number;
  private readonly ttlMs: number;

  constructor(limit = 2, ttlMs = 10 * 60_000) {
    this.limit = limit;
    this.ttlMs = ttlMs;
  }

  record(key: string, now: number): { count: number; blocked: boolean } {
    for (const [candidate, value] of this.attempts) if (now - value.at > this.ttlMs) this.attempts.delete(candidate);
    const previous = this.attempts.get(key);
    const count = (previous?.count ?? 0) + 1;
    this.attempts.set(key, { count, at: now });
    return { count, blocked: count >= this.limit };
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
