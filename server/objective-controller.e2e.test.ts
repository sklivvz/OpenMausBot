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
