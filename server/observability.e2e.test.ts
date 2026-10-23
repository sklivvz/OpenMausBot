import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { Collector, report } from "../deploy/observability/collector.ts";

it("observes a real room handoff and continuation without an agent reporting to the observer", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, undefined, process.env.OMB_VERIFICATION_ENTRY);
  const dir = mkdtempSync(join(tmpdir(), "omb-observer-evidence-"));
  let observer = new Collector(fixture.info.dataDir, join(dir, "observations.db"));
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const cli = async (...args: string[]) => {
    const result = await runControlOmb([...args, "--url", fixture.info.url]) as any;
    evidence.push({ command: args, result });
    return result;
  };
  try {
    const lead = (await cli("new-bot", "--name", "Lead", "--section", "Operations")).bot;
    const contributor = (await cli("new-bot", "--name", "Contributor", "--section", "Marketing")).bot;
    const executor = (await cli("new-bot", "--name", "Executor", "--section", "Marketing")).bot;
    const access = await fetch(`${fixture.info.url}/api/bots/${lead.id}`, { method: "PATCH",
      headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ chiefOfStaff: true, managedSections: ["Marketing"], acknowledgePeerScope: true }) });
    expect(access.ok).toBe(true);
    const room = (await cli("new-channel", "--name", "Leadership", "--members", `${lead.id},${contributor.id}`)).channel;
    const bulletin = readFileSync(new URL("../deploy/agentic/leadership-room.md", import.meta.url), "utf8");
    const configured = await fetch(`${fixture.info.url}/api/groups/${room.id}`, { method: "PATCH",
      headers: { "content-type": "application/json", origin: fixture.info.url },
      body: JSON.stringify({ bulletin, cwd: dir, defaultResponder: { kind: "member", botId: lead.id } }) });
    expect(configured.ok).toBe(true);
    const artifact = join(dir, "launch-checklist.txt");
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({
      [lead.id]: { turns: [
        { expectSystemIncludes: ["Planning is a contribution round."],
          steps: [{ arguments: { bot_ids: [contributor.id], consult: true, message: "For the launch objective, offer a contribution you can own, acceptance evidence and dependencies." } }], reply: "Collecting offers." },
        { expectContextIncludes: ["I offer the launch checklist"],
          steps: [{ arguments: { bot_ids: [contributor.id], message: `Begin your offered launch checklist contribution. Save it at ${artifact}.`, done_when: "A checklist artifact exists with the three agreed checks." } }], reply: "Accepted the offered contribution; execution started." },
        { expectContextIncludes: ["Checklist saved"], reply: "The contributor reports a checklist; this does not prove the launch achieved its business objective." },
      ] },
      [contributor.id]: { turns: [
        { reply: "I offer the launch checklist: three acceptance checks, no external dependencies. First action: write the checklist artifact." },
        { steps: [{ arguments: { bot_ids: [executor.id], message: `Write the agreed launch checklist at ${artifact}. Include approved copy, approved image and a verified publication receipt.`, done_when: "Checklist saved at the requested path with three checks." } }], reply: "Executing through my specialist." },
        { reply: `Checklist saved: ${artifact}` },
      ] },
      [executor.id]: { writeFiles: { "launch-checklist.txt": "Approved copy\nApproved image\nVerified publication receipt\n" }, reply: "Checklist saved by executor." },
    }));
    const executorFolder = await fetch(`${fixture.info.url}/api/bots/${executor.id}`, { method: "PATCH",
      headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify({ cwd: dir }) });
    expect(executorFolder.ok).toBe(true);
    expect((await cli("doctor")).ok).toBe(true);
    await cli("send-channel", "--channel", room.id, "--text", "Prepare the launch with the team");
    expect((await cli("wait", "--channel", room.id, "--timeout", "30")).status).toBe("settled");
    await cli("messages", "--channel", room.id, "--limit", "50");
    expect(observer.collect()).toEqual({ ok: true });
    const observed = report(observer.state, { threadId: room.activeTaskId });
    evidence.push({ observed });
    const run = observed.runs.find(r => r.delegatedNodes > 0)!;
    expect(run).toBeDefined();
    expect(run.businessOutcome).toBe("unverified");
    expect(run.nodes.map(n => n.botId)).toEqual(expect.arrayContaining([lead.id, contributor.id]));
    expect(run.nodes.every(n => n.executionStatus === "completed")).toBe(true);
    expect(readFileSync(artifact, "utf8")).toBe("Approved copy\nApproved image\nVerified publication receipt\n");
    expect(run.nodes.filter(n => n.botId === contributor.id)).toHaveLength(2);
    expect(run.nodes.flatMap(n => n.events.map(e => e.kind))).toContain("started");
    expect(run.nodes.flatMap(n => n.events.map(e => e.kind))).toContain("reported");
    expect(observed.threadContext.some(c => c.message.tool?.name)).toBe(true);
    const initialEvents = observed.collection.eventCount;
    observer.close();
    observer = new Collector(fixture.info.dataDir, join(dir, "observations.db"));
    expect(observer.collect()).toEqual({ ok: true });
    expect(report(observer.state).collection.eventCount).toBe(initialEvents);
    const prompts = readFileSync(join(fixture.info.dataDir, "room-plan.json.evidence.jsonl"), "utf8");
    const turns = prompts.trim().split("\n").map(line => JSON.parse(line));
    expect(turns.map(t => t.botId)).toEqual([lead.id, contributor.id, lead.id, contributor.id, executor.id, contributor.id, lead.id]);
    expect(turns.find(t => t.botId === executor.id).threadId).not.toBe(room.activeTaskId);
    expect(prompts).not.toContain("observations.db");
    expect(prompts).not.toContain("observer.cjs");
  } finally {
    writeFileSync(`${fixture.info.logPath}.observability.json`, JSON.stringify(evidence, null, 2));
    console.log(`Observation evidence: ${fixture.info.logPath}.observability.json`);
    observer.close();
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 90_000);
