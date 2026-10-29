import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("mounts the current bot's key in direct and room turns", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "happy" });
  const { url, dataDir, logPath } = fixture.info;
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async (method: string, path: string, body: unknown) => {
    const response = await fetch(url + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.status).toBeLessThan(300);
    return response.json();
  };
  const control = async (...args: string[]) => { const result = await runControlOmb([...args, "--url", url]); evidence.push({ command: args, result }); return result as any; };
  const mounted = async () => {
    await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 15_000 }).toBe(true);
    return readFileSync(fixture.fixtureDumpPath, "utf8");
  };
  try {
    const endpoint = "http://127.0.0.1:12345/mcp";
    await api("POST", "/api/mcp/servers", { name: "positron-tasks", type: "http", url: endpoint });
    await api("PATCH", "/api/mcp/servers/positron-tasks", { enabled: true });
    await api("POST", "/api/mcp/servers", { name: "work-review", command: process.execPath, args: [], env: {} });
    await api("PATCH", "/api/mcp/servers/work-review", { enabled: true });
    const a = (await control("new-bot", "--name", "First fixture")).bot;
    const b = (await control("new-bot", "--name", "Second fixture")).bot;
    const dir = join(dataDir, "positron-tasks-credentials"); mkdirSync(dir, { mode: 0o700 });
    for (const [bot, key] of [[a, "Bearer fixture-key-aaaaaaaa"], [b, "Bearer fixture-key-bbbbbbbb"]] as const) {
      writeFileSync(join(dir, `${bot.id}.json`), JSON.stringify({ botId: bot.id, url: endpoint, authorization: key }), { mode: 0o600 });
      await api("PATCH", `/api/bots/${bot.id}`, { mcpServers: ["positron-tasks", "work-review"] });
    }
    rmSync(fixture.fixtureDumpPath, { force: true });
    await control("send", "--bot", a.id, "--text", "Fixture direct turn");
    const direct = await mounted();
    expect(direct).toContain("fixture-key-aaaaaaaa"); expect(direct).not.toContain("fixture-key-bbbbbbbb");
    expect(JSON.parse(JSON.parse(direct).mcpConfig.mcpServers["work-review"].env.OMB_GATE_UPSTREAM)).toMatchObject({ args: [`--positron-caller-bot=${a.id}`] });
    await control("wait", "--bot", a.id, "--timeout", "30");
    const channel = (await control("new-channel", "--name", "Fixture room", "--members", b.id)).channel;
    rmSync(fixture.fixtureDumpPath, { force: true });
    await control("send-channel", "--channel", channel.id, "--text", "Fixture room turn");
    const room = await mounted();
    expect(room).toContain("fixture-key-bbbbbbbb"); expect(room).not.toContain("fixture-key-aaaaaaaa");
    expect(JSON.parse(JSON.parse(room).mcpConfig.mcpServers["work-review"].env.OMB_GATE_UPSTREAM)).toMatchObject({ args: [`--positron-caller-bot=${b.id}`] });
    await control("wait", "--channel", channel.id, "--timeout", "30");
    await control("messages", "--channel", channel.id, "--limit", "10");
  } finally {
    await fixture.close();
    writeFileSync(`${logPath}.positron-credentials.json`, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath, evidencePath: `${logPath}.positron-credentials.json` }));
  }
}, 90_000);
