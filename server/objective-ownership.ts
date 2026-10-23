export interface OwnershipTask {
  id: string;
  projectId: string;
  parentId?: string | null;
  description?: string;
  [key: string]: unknown;
}
export interface PortfolioOwner { id: string; names: string[]; projectIds: string[] }

export function routePortfolioTasks(tasks: OwnershipTask[], owners: PortfolioOwner[], portfolioId: string): OwnershipTask[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const owner = owners.find(o => o.id === portfolioId);
  if (!owner) return [];
  const explicit = (task: OwnershipTask): string | undefined => {
    const line = task.description?.match(/^(?:Owner|Accountable owner|Accountable delivery owner|Delivery owner):\s*(.+)$/mi)?.[1]?.trim().toLocaleLowerCase();
    if (!line) return undefined;
    return owners.find(o => o.names.some(name => {
      const n = name.trim().toLocaleLowerCase();
      return line === n || (line?.startsWith(n) && /^[\s(;,.—–-]/.test(line.slice(n.length)));
    }))?.id ?? "unresolved";
  };
  const resolve = (task: OwnershipTask, seen = new Set<string>()): string | undefined => {
    if (seen.has(task.id)) return undefined;
    seen.add(task.id);
    const own = explicit(task);
    if (own) return own;
    return task.parentId && byId.has(task.parentId) ? resolve(byId.get(task.parentId)!, seen) : undefined;
  };
  const resolved = new Map(tasks.map(t => [t.id, resolve(t)]));
  const selected = new Set(tasks.filter(t => resolved.get(t.id) === portfolioId || ((!resolved.get(t.id) || resolved.get(t.id) === "unresolved") && owner.projectIds.includes(t.projectId))).map(t => t.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const task of tasks) if (task.parentId && selected.has(task.parentId) && !selected.has(task.id)) { selected.add(task.id); changed = true; }
  }
  return tasks.filter(t => selected.has(t.id)).map(t => ({ ...t, accountablePortfolio: resolved.get(t.id) ?? "unresolved" }));
}
