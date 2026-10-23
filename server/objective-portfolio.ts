export interface PortfolioObjective {
  id: string;
  title: string;
  sourceRefs: string[];
  taskIds: string[];
  priority: number;
  state: "ready" | "scheduled" | "waiting" | "verification" | "stopped";
  next: string;
  evidence: string[];
  dependencies?: Array<{ outcome: string; owner: string; condition: string }>;
  wakeAt?: number;
}

const text = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);

export function validatePortfolio(value: unknown, taskIds: string[], previous: PortfolioObjective[], now: number): PortfolioObjective[] {
  if (!Array.isArray(value)) throw new Error("Checkpoint must inventory all team objectives, not only the current assignment");
  const ids = new Set<string>();
  const covered = new Set<string>();
  const objectives = (value as PortfolioObjective[]).map(o => o?.state === "ready" && Number.isFinite(o.wakeAt) && o.wakeAt! > now ? { ...o, state: "scheduled" as const } : o);
  for (const o of objectives) {
    if (!text(o.id) || ids.has(o.id) || !text(o.title) || !strings(o.sourceRefs) || !o.sourceRefs.length ||
      !strings(o.taskIds) || !strings(o.evidence) || !text(o.next) || !Number.isInteger(o.priority) || o.priority < 1 || o.priority > 4 ||
      !["ready", "scheduled", "waiting", "verification", "stopped"].includes(o.state)) throw new Error("Every objective needs a unique id, business outcome, source, task mapping, priority, state, next action and evidence");
    if (o.state === "scheduled" && (!Number.isFinite(o.wakeAt) || o.wakeAt! <= 0)) throw new Error(`Scheduled objective ${o.id} requires a recorded wakeAt; due work must be reassessed`);
    if (o.state === "waiting" && (!Number.isFinite(o.wakeAt) || o.wakeAt! <= 0 || !o.dependencies?.length ||
      !o.dependencies.every(d => text(d.outcome) && text(d.owner) && text(d.condition)))) throw new Error(`Waiting objective ${o.id} lacks owned dependencies or its next wake`);
    if ((o.state === "verification" || o.state === "stopped") && !o.evidence.length) throw new Error(`Objective ${o.id} needs acceptance or user-stop evidence`);
    ids.add(o.id);
    for (const id of o.taskIds) covered.add(id);
  }
  const missing = taskIds.filter(id => !covered.has(id));
  if (missing.length) throw new Error(`Unaccounted source task IDs: ${missing.join(", ")}`);
  const dropped = previous.filter(o => !ids.has(o.id));
  if (dropped.length) throw new Error(`Objectives disappeared without disposition: ${dropped.map(o => o.id).join(", ")}`);
  return objectives;
}

export function portfolioContinuation(objectives: PortfolioObjective[], now: number): { state: "ready" | "waiting"; wakeAt?: number } {
  if (objectives.some(o => o.state === "ready" || (["waiting", "scheduled"].includes(o.state) && o.wakeAt! <= now))) return { state: "ready" };
  const wakes = objectives.filter(o => ["waiting", "scheduled"].includes(o.state)).map(o => o.wakeAt!);
  return { state: "waiting", wakeAt: wakes.length ? Math.min(...wakes) : now + 86_400_000 };
}
