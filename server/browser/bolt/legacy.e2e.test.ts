import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserRuntime, type BrowserSpawnSpec, type BoltRuntimeHost } from "../../browser-runtime.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function legacy() {
  const directory = mkdtempSync(join(tmpdir(), "bolt-legacy-"));
  const callLog = join(directory, "calls.log");
  const fixture = join(process.cwd(), "server", "testing", "fake-bolt-legacy.mjs");
  const spec: BrowserSpawnSpec = {
    command: process.execPath,
    args: [fixture],
    env: { PATH: process.env.PATH, BOLT_CALL_LOG: callLog },
  };
  const runtime = new BrowserRuntime({ requestTimeoutMs: 2_000, takeoverTimeoutMs: 100, idleMs: 1_000 });
  const host: BoltRuntimeHost = { directory: join(directory, "journal"), bindingsPath: join(directory, "missing-bindings.json") };
  cleanups.push(async () => { await runtime.closeAll(); rmSync(directory, { recursive: true, force: true }); });
  return { runtime, spec, host, calls: () => readFileSync(callLog, "utf8").split("\n").filter(Boolean) };
}

async function bolt(runtime: BrowserRuntime, spec: BrowserSpawnSpec, host: BoltRuntimeHost, args: Record<string, unknown>) {
  const result = await runtime.agentRpc("legacy-bolt", spec, "tools/call", { name: "agent_browser_bolt", arguments: args }, undefined, undefined, host) as { isError?: boolean; content: Array<{ text: string }> };
  return { raw: result, value: JSON.parse(result.content[0]!.text) as Record<string, unknown> };
}

describe("the legacy agent-browser Bolt transport", () => {
  it("runs inspect and typed reads through the actual agent-browser tool contract", async () => {
    const { runtime, spec, host, calls } = legacy();
    const inspected = await bolt(runtime, spec, host, { action: "inspect" });
    expect(inspected.raw.isError).not.toBe(true);
    expect(inspected.value).toMatchObject({
      status: "observed",
      supportedActions: ["inspect", "open_branch", "search_branch", "read_basket", "list_fulfilment_options", "select_fulfilment", "list_delivery_options", "select_delivery_option", "reconcile_operation"],
    });
    expect((inspected.value.view as { products: unknown[] }).products).toHaveLength(1);
    const basket = await bolt(runtime, spec, host, { action: "read_basket" });
    expect(basket.value).toMatchObject({ status: "observed", basketRows: "unavailable", view: { basketState: { loading: true, ready: false, rowsAvailable: false } } });
    expect(calls()).toContain("agent_browser_eval");
    expect(calls()).not.toContain("agent_browser_bolt");
  });

  it("dispatches search through the legacy fill/eval tools without claiming fresh results", async () => {
    const { runtime, spec, host } = legacy();
    const inspected = await bolt(runtime, spec, host, { action: "inspect" });
    const searched = await bolt(runtime, spec, host, { action: "search_branch", operationId: "search-1", observationRef: inspected.value.observationRef, query: "soup" });
    expect(searched.value).toMatchObject({ status: "dispatched", verification: "input_only", searchResults: "unknown" });
  });

  it("refuses unsupported actions before invoking a browser effect", async () => {
    const { runtime, spec, host, calls } = legacy();
    const inspected = await bolt(runtime, spec, host, { action: "inspect" });
    const blocked = await bolt(runtime, spec, host, { action: "read_item_options", operationId: "item-1", observationRef: inspected.value.observationRef });
    expect(blocked.raw.isError).toBe(true);
    expect(blocked.value).toMatchObject({ status: "blocked", code: "action_bindings_required" });
    expect(calls().filter((name) => name === "agent_browser_click" || name === "agent_browser_fill")).toEqual([]);
  });
});
