import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type QualificationRecord = { id: string; decision: string; input: { lead_id: string }; sufficiency?: { ok?: boolean; provider?: string }; match?: { ok?: boolean; provider?: string } };
export type Entry = { parent_record_id: string; parent_object: string; id: { entry_id: string; list_id: string }; entry_values: Record<string, unknown> };
export interface QualificationTransport {
  entry(list: string, entryId: string): Promise<Entry>;
  patch(list: string, entryId: string, values: Record<string, string>): Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const val = (x: unknown, field: string): string | null => {
  if (!Array.isArray(x) || !x[0] || typeof x[0] !== "object") return null;
  const v = (x[0] as Record<string, unknown>)[field];
  return v && typeof v === "object" && typeof (v as Record<string, unknown>).title === "string" ? (v as { title: string }).title : null;
};
const locks = new Map<string, Promise<unknown>>();
async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}

export async function latestLeadDecision(logPath: string, decisionId: string): Promise<QualificationRecord> {
  if (!uuid.test(decisionId)) throw new Error("Invalid decision ID.");
  const raw = await readFile(logPath, "utf8");
  if (Buffer.byteLength(raw) > 20_000_000) throw new Error("Decision log is too large to inspect safely.");
  const rows = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as QualificationRecord);
  const requested = rows.find((r) => r.id === decisionId);
  if (!requested || !uuid.test(requested.input?.lead_id ?? "")) throw new Error("Decision not found.");
  if (rows.filter((r) => r.input?.lead_id === requested.input.lead_id).at(-1)?.id !== decisionId) throw new Error("Decision was superseded; use the latest decision.");
  if (!["yes", "no"].includes(requested.decision) || requested.sufficiency?.ok !== true || requested.sufficiency.provider !== "jev" || requested.match?.ok !== true || requested.match.provider !== "jev") throw new Error("A completed Jev yes/no decision is required.");
  return requested;
}

export async function recordQualification(input: { decisionId: string; entryId: string }, deps: { botFolder: string; listId: string; transport: QualificationTransport; authorized: () => boolean }) {
  if (!uuid.test(input.entryId) || !uuid.test(deps.listId)) throw new Error("Invalid entry or list ID.");
  return exclusive(input.entryId, async () => {
    const logPath = join(deps.botFolder, "lead-qualification", "decisions.jsonl");
    const decision = await latestLeadDecision(logPath, input.decisionId);
    const entry = await deps.transport.entry(deps.listId, input.entryId);
    if (entry.id.entry_id !== input.entryId || entry.id.list_id !== deps.listId || entry.parent_object !== "deals" || entry.parent_record_id !== decision.input.lead_id) throw new Error("Decision and Sales Pipeline entry do not match.");
    const stage = val(entry.entry_values.sales_stage, "status");
    if (stage !== "Lead" && stage !== "Qualified") throw new Error("Existing stage cannot be changed by qualification.");
    const current = val(entry.entry_values.icp_match, "option");
    const guardedPatch = async (values: Record<string, string>) => {
      const latest = await latestLeadDecision(logPath, input.decisionId);
      const before = await deps.transport.entry(deps.listId, input.entryId);
      if (latest.input.lead_id !== entry.parent_record_id || before.parent_record_id !== entry.parent_record_id || val(before.entry_values.sales_stage, "status") !== stage || val(before.entry_values.icp_match, "option") !== current) throw new Error("Decision or entry changed; re-evaluate before recording.");
      if (!deps.authorized()) throw new Error("The active turn is no longer authorized.");
      await deps.transport.patch(deps.listId, input.entryId, values);
    };
    if (decision.decision === "no") {
      if (stage !== "Lead") throw new Error("A qualified-stage deal requires review before a negative decision.");
      if (current !== "No") {
        await guardedPatch({ icp_match: "No" });
      }
    } else if (current !== "Yes" || stage !== "Qualified") {
      await guardedPatch({ icp_match: "Yes", sales_stage: "Qualified" });
    }
    const checked = await deps.transport.entry(deps.listId, input.entryId);
    const actual = val(checked.entry_values.icp_match, "option"), afterStage = val(checked.entry_values.sales_stage, "status");
    if (actual !== (decision.decision === "yes" ? "Yes" : "No") || (decision.decision === "yes" ? afterStage !== "Qualified" : afterStage !== stage)) throw new Error("Attio readback did not confirm the requested state.");
    return { decisionId: input.decisionId, entryId: input.entryId, dealId: entry.parent_record_id, icp_match: actual, sales_stage: afterStage, verified: true };
  });
}
