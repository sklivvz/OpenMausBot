export interface PortfolioObjective {
  id: string;
  title: string;
  sourceRefs: string[];
  taskIds: string[];
  priority: number;
  state: "ready" | "waiting" | "verification" | "stopped";
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
  for (const o of value as PortfolioObjective[]) {
    if (!text(o.id) || ids.has(o.id) || !text(o.title) || !strings(o.sourceRefs) || !o.sourceRefs.length ||
      !strings(o.taskIds) || !strings(o.evidence) || !text(o.next) || !Number.isInteger(o.priority) || o.priority < 1 || o.priority > 4 ||
      !["ready", "waiting", "verification", "stopped"].includes(o.state)) throw new Error("Every objective needs a unique id, business outcome, source, task mapping, priority, state, next action and evidence");
    if (o.state === "waiting" && (!Number.isFinite(o.wakeAt) || o.wakeAt! <= now || !o.dependencies?.length ||
      !o.dependencies.every(d => text(d.outcome) && text(d.owner) && text(d.condition)))) throw new Error(`Waiting objective ${o.id} lacks owned dependencies or its next wake`);
    if ((o.state === "verification" || o.state === "stopped") && !o.evidence.length) throw new Error(`Objective ${o.id} needs acceptance or user-stop evidence`);
    ids.add(o.id);
    for (const id of o.taskIds) covered.add(id);
  }
  const missing = taskIds.filter(id => !covered.has(id));
  if (missing.length) throw new Error(`Unaccounted source task IDs: ${missing.join(", ")}`);
  const dropped = previous.filter(o => !ids.has(o.id));
  if (dropped.length) throw new Error(`Objectives disappeared without disposition: ${dropped.map(o => o.id).join(", ")}`);
  return value as PortfolioObjective[];
}

export function portfolioContinuation(objectives: PortfolioObjective[], now: number): { state: "ready" | "waiting"; wakeAt?: number } {
  if (objectives.some(o => o.state === "ready" || (o.state === "waiting" && o.wakeAt! <= now))) return { state: "ready" };
  const wakes = objectives.filter(o => o.state === "waiting").map(o => o.wakeAt!);
  return { state: "waiting", wakeAt: wakes.length ? Math.min(...wakes) : now + 86_400_000 };
}
