import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { Decider } from "./decider/index.ts";
import { relayAccepts } from "./decider/relay.ts";

export type LeadInput = { lead_id: string; evidence: string; icp: string; icp_version: string };
type Decision = "yes" | "no" | "needs_research" | "needs_review";
const questions = {
  sufficiency: { type: "choice" as const, instructions: "Can a reasonable ICP decision be made from these reliable facts and proxies? Exact counts and complete information are not required. Use the supplied ICP only; missing a nonessential fact is not insufficient.", options: { sufficient: "Available evidence supports a reasonable yes or no decision", insufficient: "The available evidence cannot support either decision even using reasonable proxies" } },
  match: { type: "choice" as const, instructions: "Does this lead match the supplied ICP? Make the most reasonable yes/no judgment from the available evidence and proxies. Follow the ICP as written; do not add criteria or invent facts.", options: { yes: "Lead matches the supplied ICP", no: "Lead does not match the supplied ICP" } },
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const clear = (a: { pTop: number; margin: number }) => a.pTop >= 0.55 && a.margin >= 0.10;
const QUALIFICATION_BUDGET_MS = 15_000;
const writeQueues = new Map<string, Promise<void>>();

function leadState(input: LeadInput): string {
  return JSON.stringify({ lead_id: input.lead_id, evidence: input.evidence, icp: input.icp, icp_version: input.icp_version });
}

export function validLeadQualificationInput(input: LeadInput): boolean {
  const state = leadState(input);
  return relayAccepts("botDecide", state, { sufficiency: questions.sufficiency }) && relayAccepts("botDecide", state, { match: questions.match });
}

export async function qualifyLead(input: LeadInput, decide: Pick<Decider, "ask">, writeLog: (row: unknown) => Promise<void>) {
  const state = leadState(input);
  if (!validLeadQualificationInput(input)) throw new Error("Lead evidence or ICP exceeds the decision model's input limits.");
  let decision: Decision = "needs_review";
  let first: Awaited<ReturnType<typeof decide.ask>> | undefined;
  let second: Awaited<ReturnType<typeof decide.ask>> | undefined;
  let failure: string | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUALIFICATION_BUDGET_MS);
  const deadline = performance.now() + QUALIFICATION_BUDGET_MS;
  const timeout = new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
  try {
    first = await Promise.race([decide.ask("botDecide", state, { sufficiency: questions.sufficiency }, { careful: true, timeoutMs: QUALIFICATION_BUDGET_MS, signal: controller.signal }), timeout]);
    if (!controller.signal.aborted && first.ok && first.provider === "jev" && first.answers.sufficiency?.type === "choice" && clear(first.answers.sufficiency)) {
      if (first.answers.sufficiency.choice === "insufficient") decision = "needs_research";
      else if (first.answers.sufficiency.choice === "sufficient" && !controller.signal.aborted) {
        const remaining = Math.max(50, Math.ceil(deadline - performance.now()));
        second = await Promise.race([decide.ask("botDecide", state, { match: questions.match }, { careful: true, timeoutMs: remaining, signal: controller.signal }), timeout]);
        if (!controller.signal.aborted && second.ok && second.provider === "jev" && second.answers.match?.type === "choice" && clear(second.answers.match) && (second.answers.match.choice === "yes" || second.answers.match.choice === "no")) decision = second.answers.match.choice;
      }
    }
  } catch { decision = "needs_review"; failure = "decider_error"; } finally { if (controller.signal.aborted) failure = "timeout"; clearTimeout(timer); }
  const row = { id: randomUUID(), at: new Date().toISOString(), input, icp_hash: hash(input.icp), evidence_hash: hash(input.evidence), questions, sufficiency: first ?? null, match: second ?? null, decision, ...(failure ? { failure } : {}) };
  await writeLog(row);
  return { decision, decision_id: row.id, icp_hash: row.icp_hash, evidence_hash: row.evidence_hash, sufficiency: first ?? null, match: second ?? null };
}

export async function appendLeadDecision(botDirectory: string, row: unknown): Promise<void> {
  const dir = join(botDirectory, "lead-qualification");
  const path = join(dir, "decisions.jsonl");
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const file = await open(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.chmod(0o600); await file.writeFile(JSON.stringify(row) + "\n"); await file.sync(); } finally { await file.close(); }
  });
  writeQueues.set(path, current);
  try { await current; } finally { if (writeQueues.get(path) === current) writeQueues.delete(path); }
}
