import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("carries a launch commitment into the next run and reports into its existing conversation", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true }, [], undefined, undefined, process.env.OMB_VERIFICATION_ENTRY);
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(fixture.info.url + path, { method,
      headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as any;
    expect(response.ok, JSON.stringify(result)).toBe(true);
    if (method !== "GET") evidence.push({ method, path, body, result });
    return result;
  };
  const bot = async (name: string) => (await runControlOmb(["new-bot", "--name", name, "--url", fixture.info.url]) as any).bot;
  try {
    const owner = await bot("Launch owner");
    const other = await bot("Independent owner");
    const schedule = { type: "cron", expression: "0 9,12,15,18 * * MON-FRI", timeZone: "Europe/Tallinn" };
    const unrelated = (await api("POST", "/api/routines", { name: "Separate work", prompt: "Separate objective", botId: other.id, enabled: false, schedule })).routine;
    const routine = (await api("POST", "/api/routines", { name: "Calendar check", prompt: "Old check", botId: owner.id, enabled: false, schedule })).routine;
    const threadId = (await api("GET", "/api/bots?messages=0")).bots.find((b: any) => b.id === owner.id).threadId;
    const prompt = readFileSync(new URL("../deploy/agentic/launch-continuation.md", import.meta.url), "utf8").trim();
    await api("PATCH", `/api/routines/${routine.id}`, { name: "Launch ownership", prompt, continuity: true, overlap: "skip", resultsThreadId: threadId });
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify({ [owner.id]: { turns: [
      { expectContextIncludes: ["Continuing ownership of the Positron Flux launch"], reply: "Next commitment: verify the accepted fixture packet. Owner: launch lead. Objective remains active." },
      { expectContextIncludes: ["Next commitment: verify the accepted fixture packet", "previous-run"], reply: "Packet verification recorded. Business outcome remains unverified; next commitment retained." },
    ] } }));
    const runs: any[] = [];
    for (let i = 0; i < 2; i++) {
      const { run } = await api("POST", `/api/routines/${routine.id}/run`);
      await expect.poll(async () => (await api("GET", "/api/routines")).runs.find((r: any) => r.id === run.id)?.status, { timeout: 20_000 }).toBe("completed");
      runs.push((await api("GET", "/api/routines")).runs.find((r: any) => r.id === run.id));
    }
    expect(runs[0].threadId).not.toBe(runs[1].threadId);
    expect(runs.every(r => r.resultsThreadId === threadId)).toBe(true);
    expect(runs[1].output).toContain("Packet verification recorded");
    const final = await api("GET", "/api/routines");
    expect(final.routines.find((r: any) => r.id === unrelated.id)).toEqual(unrelated);
    expect(final.routines.find((r: any) => r.id === routine.id)).toMatchObject({ continuity: true, schedule, resultsThreadId: threadId });
    const messages = await api("GET", `/api/threads/${threadId}/messages?limit=30`);
    expect(messages.messages.filter((m: any) => m.kind === "routine.run")).toHaveLength(2);
    evidence.push({ final, messages });
  } finally {
    writeFileSync(`${fixture.info.logPath}.launch-continuation.json`, JSON.stringify(evidence, null, 2));
    console.log(`Continuation evidence: ${fixture.info.logPath}.launch-continuation.json`);
    await fixture.close();
  }
}, 60_000);
