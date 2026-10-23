import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ObjectiveController, atomicJson, loopbackApi, type ObjectiveConfig } from "../../server/objective-controller.ts";

const root = process.env.OMB_OBJECTIVE_STATE ?? "/state";
const api = loopbackApi(process.env.OMB_OBJECTIVE_URL ?? "http://127.0.0.1:8799");
const capacity = Number(process.env.OMB_OBJECTIVE_CAPACITY ?? 2);
if (!Number.isInteger(capacity) || capacity < 1 || capacity > 6) throw new Error("Objective capacity must be 1..6");
const controllers = new Map<string, ObjectiveController>();
const health = await api("GET", "/api/health");
if (health.capabilities?.guardedMessages !== 1 || health.capabilities?.guardedRequests !== 1) throw new Error("Guarded message/request capabilities required");
let running = true;
let source: { complete: boolean; checkedAt: string; tasks: Array<{ id: string; projectId: string }> } | undefined;
let sourceError: string | undefined;
let nextRead = 0;
let reading: Promise<void> | undefined;
let busyBots = new Set<string>();
let nextActivityRead = 0;
let botInventory: any[] = [];
process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });
function refreshSource(): Promise<void> {
  return (async () => {
    try {
      const response = await fetch("http://127.0.0.1:8798/tasks", { method: "POST", signal: AbortSignal.timeout(150_000) });
      const data = await response.json() as typeof source;
      if (!response.ok || !data?.complete || !Array.isArray(data.tasks)) throw new Error("Complete task inventory unavailable");
      source = data;
      sourceError = undefined;
      atomicJson(join(root, "task-source.json"), data);
    } catch (error) { sourceError = String(error); }
    finally { nextRead = Date.now() + 300_000; reading = undefined; }
  })();
}
while (running) {
  if (Date.now() >= nextActivityRead) {
    try {
      const inventory = await api("GET", "/api/bots?messages=0");
      botInventory = inventory.bots;
      busyBots = new Set(inventory.bots.filter((b: any) => b.busy || b.tasks?.some((t: any) => t.busy)).map((b: any) => b.id));
      nextActivityRead = Date.now() + 5000;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 2000));
      continue;
    }
  }
  if (!reading && Date.now() >= nextRead) reading = refreshSource();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    const configFile = join(directory, "config.json");
    if (!existsSync(configFile)) continue;
    if (!controllers.has(entry.name)) {
      const config = JSON.parse(readFileSync(configFile, "utf8")) as ObjectiveConfig;
      if (config.id !== entry.name) throw new Error("Config directory and objective id mismatch");
      controllers.set(entry.name, new ObjectiveController(config, directory, api));
    }
  }
  const available = [...controllers.values()].filter(c => !existsSync(join(root, c.config.id, "paused")));
  for (const controller of available) if (source) {
    const conversations = (botInventory.find(b => b.id === controller.config.botId)?.tasks ?? [])
      .filter((t: any) => t.threadId !== controller.config.threadId && !t.routineRunId && !t.openedBy)
      .map((t: any) => ({ threadId: t.threadId, title: t.title, updatedAt: t.updatedAt })).sort((a: any, b: any) => a.threadId.localeCompare(b.threadId));
    controller.updateSource(source.tasks, conversations);
  }
  const active = (c: ObjectiveController) => Boolean(c.state.request) && !["maintenance", "stopped", "intervened"].includes(c.state.status);
  const candidates = [...available.filter(active), ...available.filter(c => !active(c)).sort((a, b) => (a.state.lastStartedAt ?? 0) - (b.state.lastStartedAt ?? 0))];
  for (const controller of candidates) {
    if (!controller.state.request?.accepted && busyBots.has(controller.config.botId)) continue;
    if (!active(controller) && available.filter(c => active(c) && c.state.status !== "waiting").length >= capacity) continue;
    if (!source && controller.config.portfolio && !active(controller)) continue;
    const before = JSON.stringify([controller.state.status, controller.state.cycle, controller.state.detail]);
    await controller.tick();
    if (before !== JSON.stringify([controller.state.status, controller.state.cycle, controller.state.detail])) {
      console.log(JSON.stringify({ at: new Date().toISOString(), portfolio: controller.config.id, status: controller.state.status, cycle: controller.state.cycle, detail: controller.state.detail }));
    }
  }
  atomicJson(join(root, "health.json"), { at: Date.now(), sourceCheckedAt: source?.checkedAt, sourceError, capacity,
    portfolios: [...controllers.values()].map(c => ({ id: c.config.id, botId: c.config.botId, threadId: c.config.threadId, status: c.state.status, paused: existsSync(join(root, c.config.id, "paused")), cycle: c.state.cycle, detail: c.state.detail, objectives: c.state.checkpoint?.objectives })) });
  await new Promise(resolve => setTimeout(resolve, 2000));
}
