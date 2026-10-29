import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePositronTasksMcp } from "./positron-tasks-credentials.ts";
import type { McpServerSpec } from "./contracts.ts";

const dirs: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), "omb-pt-keys-")); dirs.push(dir); return dir; };
const endpoint = "http://positron-mcp:8080/mcp";
const servers: Record<string, McpServerSpec> = { "positron-tasks": { type: "http", url: endpoint, headers: { Authorization: "Bearer unsafe-shared-secret" } }, other: { command: "fixture", args: [], env: {} } };
const save = (dir: string, filename: string, data: object, mode = 0o600) => writeFileSync(join(dir, `${filename}.json`), JSON.stringify(data), { mode });
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("shared Positron Tasks MCP credentials", () => {
  it("uses only the current bot's separate credential and replaces shared authorization", () => {
    const dir = directory();
    save(dir, "bot-a", { botId: "bot-a", url: endpoint, authorization: "Bearer fixture-key-aaaaaaaa" });
    save(dir, "bot-b", { botId: "bot-b", url: endpoint, authorization: "Bearer fixture-key-bbbbbbbb" });
    const a = resolvePositronTasksMcp(servers, "bot-a", dir);
    const b = resolvePositronTasksMcp(servers, "bot-b", dir);
    expect(a["positron-tasks"]).toMatchObject({ headers: { Authorization: "Bearer fixture-key-aaaaaaaa" } });
    expect(b["positron-tasks"]).toMatchObject({ headers: { Authorization: "Bearer fixture-key-bbbbbbbb" } });
    expect(JSON.stringify(a)).not.toContain("fixture-key-bbbbbbbb");
    expect(a.other).toEqual(servers.other);
  });
  it("omits the shared server when the key is missing, swapped, exposed, or for a different endpoint", () => {
    const dir = directory();
    expect(resolvePositronTasksMcp(servers, undefined, dir)).toEqual({ other: servers.other });
    expect(resolvePositronTasksMcp(servers, "missing", dir)).toEqual({ other: servers.other });
    save(dir, "swapped", { botId: "another", url: endpoint, authorization: "Bearer fixture-key-aaaaaaaa" });
    save(dir, "wrong-url", { botId: "wrong-url", url: "http://other.invalid/mcp", authorization: "Bearer fixture-key-aaaaaaaa" });
    save(dir, "exposed", { botId: "exposed", url: endpoint, authorization: "Bearer fixture-key-aaaaaaaa" }, 0o644);
    symlinkSync(join(dir, "swapped.json"), join(dir, "link.json"));
    for (const bot of ["swapped", "wrong-url", "exposed", "link", "../swapped"]) expect(resolvePositronTasksMcp(servers, bot, dir)).toEqual({ other: servers.other });
  });
});
