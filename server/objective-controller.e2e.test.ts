import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { ObjectiveController, atomicJson, loopbackApi, type ObjectiveConfig } from "./objective-controller.ts";

it("continues one business objective across real guarded requests and a controller restart without another user message", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, undefined, process.env.OMB_VERIFICATION_ENTRY);
  const api = loopbackApi(fixture.info.url);
  const evidence: unknown[] = [{ fixture: fixture.info }];
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Objective owner", "--url", fixture.info.url]) as any;
    const { task } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Fixture business objective" });
    await api("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { approvalMode: "ask" });
    const config: ObjectiveConfig = { id: "fixture-objective", botId: bot.id, threadId: task.threadId, approvalMode: "ask", objective: "Deliver and verify two fixture artifacts", instructions: "Use only fixture artifacts; no external systems", initialLeafId: (await api("GET", `/api/threads/${task.threadId}/messages?limit=1`)).activeLeafId, portfolio: { projectIds: ["fixture-project"] }, checkpointDirectory: join(fixture.info.dataDir, "checkpoints") };
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [bot.id]: { turns: [
      { expectContextIncludes: ["Continuing business objective", "Deliver and verify two fixture artifacts"], reply: "First fixture artifact is ready. Objective remains unfinished." },
      { expectContextIncludes: ["Previous checkpoint", "first-artifact"], reply: "Second fixture artifact is ready; reviewer is available at the checkpoint time." },
      { expectContextIncludes: ["second-artifact"], reply: "Review evidence is attached. Request acceptance; no automatic business success claim." },
    ] } }));
    const directory = join(fixture.info.dataDir, "objective-state");
    let clock = Date.now();
    let controller = new ObjectiveController(config, directory, api, () => clock);
    controller.updateSource([{ id: "first", projectId: "fixture-project" }, { id: "second", projectId: "fixture-project" }]);
    const portfolio = (first: string, second: string, wakeAt?: number) => [{ id: "first-outcome", title: "First business outcome", sourceRefs: ["fixture-user"], taskIds: ["first"], priority: 3, state: first, next: "Verify outcome", evidence: ["first-artifact"] }, { id: "second-outcome", title: "Second business outcome", sourceRefs: ["fixture-user"], taskIds: ["second"], priority: 2, state: second, next: "Advance outcome", evidence: ["second-artifact"], ...(wakeAt ? { wakeAt, dependencies: [{ outcome: "Acceptance", owner: "Fixture reviewer", condition: "Review window opens" }] } : {}) }];
    mkdirSync(join(config.checkpointDirectory, config.id), { recursive: true });
    const settle = async () => {
      const sendId = controller.state.request!.sendId;
      await expect.poll(async () => (await api("GET", `/api/bots/${bot.id}/requests/${sendId}?threadId=${task.threadId}`)).phase, { timeout: 20_000 }).toBe("settled");
      evidence.push(await api("GET", `/api/bots/${bot.id}/requests/${sendId}?threadId=${task.threadId}`));
      return sendId;
    };
    await controller.tick();
    let sendId = await settle();
    atomicJson(join(config.checkpointDirectory, config.id, `${sendId}.json`), { sendId, state: "verification", objectives: portfolio("verification", "ready"), progress: "first-artifact delivered", evidence: ["fixture/first-artifact"], next: "Deliver second artifact" });
    await controller.tick();
    controller = new ObjectiveController(config, directory, api, () => clock);
    await controller.tick();
    expect(controller.state.cycle).toBe(2);
    sendId = await settle();
    atomicJson(join(config.checkpointDirectory, config.id, `${sendId}.json`), { sendId, state: "waiting", objectives: portfolio("verification", "waiting", clock + 60_000), progress: "second-artifact delivered; only review remains", evidence: ["fixture/second-artifact"], next: "Verify both artifacts", dependencies: [{ outcome: "Acceptance", owner: "Fixture reviewer", condition: "Review window opens" }], wakeAt: clock + 60_000 });
    await controller.tick();
    controller = new ObjectiveController(config, directory, api, () => clock);
    await controller.tick(); expect(controller.state.cycle).toBe(2);
    clock += 60_000;
    await controller.tick(); expect(controller.state.cycle).toBe(3);
    sendId = await settle();
    atomicJson(join(config.checkpointDirectory, config.id, `${sendId}.json`), { sendId, state: "verification", objectives: portfolio("verification", "verification"), progress: "Both artifacts verified by fixture reviewer", evidence: ["fixture/review-receipt"], next: "Owner acceptance" });
    await controller.tick(); await controller.tick();
    expect(controller.state.status).toBe("waiting");
    expect(controller.state.checkpoint?.objectives?.every(o => o.state === "verification")).toBe(true);
    expect(controller.state.cycle).toBe(3);
    const page = await api("GET", `/api/threads/${task.threadId}/messages?limit=100`);
    expect(page.messages.filter((m: any) => m.role === "user")).toHaveLength(3);
    expect(page.messages.filter((m: any) => m.role === "user").every((m: any) => m.relayed)).toBe(true);
    evidence.push({ final: JSON.parse(readFileSync(join(directory, "state.json"), "utf8")), page, limitation: "Scripted provider and fixture-authored checkpoints prove lifecycle only, not live agent judgment or business acceptance." });
  } finally {
    writeFileSync(`${fixture.info.logPath}.objectives.json`, JSON.stringify(evidence, null, 2));
    console.log(`Objective evidence: ${fixture.info.logPath}.objectives.json`);
    await fixture.close();
  }
}, 90_000);

it("uses configured fallback after a real fixture provider capacity error without replacing the objective thread", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "api-error", FAKE_CLAUDE_API_ERROR: "Selected model is at capacity. Please try a different model." });
  const api = loopbackApi(fixture.info.url);
  const evidence: unknown[] = [{ fixture: fixture.info }];
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Fallback owner", "--url", fixture.info.url]) as any;
    const { task } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Capacity recovery fixture" });
    await api("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { approvalMode: "ask" });
    const config: ObjectiveConfig = { id: "capacity-fixture", botId: bot.id, threadId: task.threadId, approvalMode: "ask", objective: "Finish accepted fixture work", instructions: "Use only fixture data", initialLeafId: null, checkpointDirectory: join(fixture.info.dataDir, "checkpoints"), recoveryModels: [{ instanceId: "claude", model: "claude-sonnet-4-6" }] };
    const controller = new ObjectiveController(config, join(fixture.info.dataDir, "controller"), api);
    await controller.tick();
    expect(controller.state.status, controller.state.detail).toBe("working");
    const firstId = controller.state.request!.sendId;
    await expect.poll(async () => (await api("GET", `/api/bots/${bot.id}/requests/${firstId}?threadId=${task.threadId}`)).phase, { timeout: 15_000 }).toBe("untracked");
    evidence.push(await api("GET", `/api/bots/${bot.id}/requests/${firstId}?threadId=${task.threadId}`));
    const wrapper = join(fixture.info.dataDir, "healthy-provider.mjs");
    writeFileSync(wrapper, `#!/usr/bin/env node\nprocess.env.FAKE_CLAUDE_MODE = 'happy';\nawait import(${JSON.stringify(new URL("./testing/fake-claude-cli.ts", import.meta.url).href)});\n`, { mode: 0o700 });
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).bots.some((b: any) => b.busy || b.tasks?.some((t: any) => t.busy)), { timeout: 10_000 }).toBe(false);
    await api("PATCH", "/api/instances/claude", { cli: wrapper });
    await controller.tick();
    expect(controller.state.status).toBe("ready");
    expect(controller.state.recoveries).toBe(1);
    await controller.tick();
    const resumed = controller.state.request!.sendId;
    await expect.poll(async () => (await api("GET", `/api/bots/${bot.id}/requests/${resumed}?threadId=${task.threadId}`)).phase, { timeout: 15_000 }).toBe("settled");
    evidence.push(await api("GET", `/api/bots/${bot.id}/requests/${resumed}?threadId=${task.threadId}`));
    expect(resumed).not.toBe(firstId);
    const inventory = await api("GET", "/api/bots?messages=0");
    expect(inventory.bots.find((b: any) => b.id === bot.id).tasks.find((t: any) => t.threadId === task.threadId).modelSelection).toMatchObject(config.recoveryModels![0]);
  } finally {
    writeFileSync(`${fixture.info.logPath}.objective-recovery.json`, JSON.stringify(evidence, null, 2));
    await fixture.close();
  }
}, 60_000);

it("continues after a settled user correction without replaying the previous request", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, undefined, process.env.OMB_VERIFICATION_ENTRY);
  const api = loopbackApi(fixture.info.url);
  const evidence: unknown[] = [{ fixture: fixture.info }];
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Reconciliation owner", "--url", fixture.info.url]) as any;
    const { task } = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Correction fixture" });
    await api("PATCH", `/api/bots/${bot.id}/tasks/${task.threadId}`, { approvalMode: "ask" });
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [bot.id]: { turns: [
      { reply: "First contribution prepared; unfinished work retained." },
      { reply: "Applied the user hold to that contribution; the other outcome remains actionable." },
      { expectContextIncludes: ["Latest instructions and holds supersede", "Defer publication"], reply: "Advanced the independent fixture contribution while preserving the hold." },
      { reply: "Stopped fixture work." },
    ] } }));
    const config: ObjectiveConfig = { id: "reconcile", botId: bot.id, threadId: task.threadId, approvalMode: "ask", objective: "Advance independent fixture outcomes", instructions: "Fixture only", initialLeafId: null, checkpointDirectory: join(fixture.info.dataDir, "checkpoints") };
    const directory = join(fixture.info.dataDir, "controller");
    let controller = new ObjectiveController(config, directory, api);
    await controller.tick();
    const firstId = controller.state.request!.sendId;
    const settled = async (sendId: string) => {
      await expect.poll(async () => (await api("GET", `/api/bots/${bot.id}/requests/${sendId}?threadId=${task.threadId}`)).phase, { timeout: 20_000 }).toBe("settled");
    };
    await settled(firstId);
    mkdirSync(join(config.checkpointDirectory, config.id), { recursive: true });
    atomicJson(join(config.checkpointDirectory, config.id, `${firstId}.json`), { sendId: firstId, state: "ready", progress: "First contribution prepared", evidence: ["fixture/prepared"], next: "Independent contribution" });
    const correction = await api("POST", `/api/bots/${bot.id}/messages`, { threadId: task.threadId, text: "Defer publication. Advance the other outcome.", sendId: "fixture-correction-1234" });
    await settled("fixture-correction-1234");
    await controller.tick();
    expect(controller.state.status).toBe("intervened");
    controller = new ObjectiveController(config, directory, api);
    await controller.tick();
    expect(controller.state.status, controller.state.detail).toBe("ready");
    expect(controller.state.checkpoint?.progress).toBe("First contribution prepared");
    await controller.tick();
    const resumed = controller.state.request!.sendId;
    await settled(resumed);
    expect(resumed).not.toBe(firstId);
    const current = await api("GET", `/api/bots/${bot.id}/requests/${resumed}?threadId=${task.threadId}`);
    evidence.push({ correction, current, controller: controller.state });
    const page = await api("GET", `/api/threads/${task.threadId}/messages?limit=100`);
    expect(page.messages.filter((m: any) => m.sendId === firstId)).toHaveLength(1);
    expect(page.messages.filter((m: any) => m.role === "user")).toHaveLength(3);
  } finally {
    writeFileSync(`${fixture.info.logPath}.objective-reconciliation.json`, JSON.stringify(evidence, null, 2));
    console.log(`Reconciliation evidence: ${fixture.info.logPath}.objective-reconciliation.json`);
    await fixture.close();
  }
}, 90_000);
