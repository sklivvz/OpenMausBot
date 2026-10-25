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
    expect(inspected.value).toMatchObject({ status: "observed" });
    expect(inspected.value.supportedActions).toEqual(expect.arrayContaining(["inspect", "open_branch", "search_branch", "read_basket", "list_fulfilment_options", "select_fulfilment", "list_delivery_options", "select_delivery_option", "reconcile_operation"]));
    expect((inspected.value.view as { products: unknown[] }).products).toHaveLength(1);
    const basket = await bolt(runtime, spec, host, { action: "read_basket" });
    expect(basket.value).toMatchObject({ status: "observed", basketRows: "not_open", view: { basketState: { rowsAvailable: false } } });
    expect(calls()).toContain("agent_browser_eval");
    expect(calls()).not.toContain("agent_browser_bolt");
  });

  it("refuses a search observation the fixture cannot prove instead of claiming fresh results", async () => {
    const { runtime, spec, host, calls } = legacy();
    const inspected = await bolt(runtime, spec, host, { action: "inspect" });
    const searched = await bolt(runtime, spec, host, { action: "search_branch", operationId: "search-1", observationRef: inspected.value.observationRef, query: "soup" });
    expect(searched.value).toMatchObject({ status: "blocked", code: "product_observation_invalid" });
    expect(calls()).not.toContain("agent_browser_fill");
  });

  it("opens a branch through the actual agent_browser_open tool", async () => {
    const { runtime, spec, host, calls } = legacy();
    spec.env.BOLT_BASKET_LOADING = "0";
    const inspected = await bolt(runtime, spec, host, { action: "inspect" });
    const opened = await bolt(runtime, spec, host, { action: "open_branch", operationId: "branch-1", observationRef: inspected.value.observationRef, branchUrl: "https://food.bolt.eu/en/1-tallinn/p/456-other/" });
    expect(opened.value.status).toBe("verified");
    expect(calls()).toContain("agent_browser_open");
    expect(calls()).not.toContain("agent_browser_navigate");
  });

  it("refuses an active basket before branch navigation and reports an unhandled replacement prompt", async () => {
    const active = legacy();
    active.spec.env.BOLT_BASKET_LOADING = "0";
    active.spec.env.BOLT_BASKET_READY = "1";
    const inspected = await bolt(active.runtime, active.spec, active.host, { action: "inspect" });
    const blocked = await bolt(active.runtime, active.spec, active.host, { action: "open_branch", operationId: "active", observationRef: inspected.value.observationRef, branchUrl: "https://food.bolt.eu/en/1-tallinn/p/456-other/" });
    expect(blocked.value).toMatchObject({ status: "blocked", code: "active_basket_preserved_refuse_branch_change" });
    expect(active.calls()).not.toContain("agent_browser_open");

    const prompt = legacy();
    prompt.spec.env.BOLT_BASKET_LOADING = "0";
    prompt.spec.env.BOLT_BRANCH_CONFIRM = "1";
    const seen = await bolt(prompt.runtime, prompt.spec, prompt.host, { action: "inspect" });
    const confirmation = await bolt(prompt.runtime, prompt.spec, prompt.host, { action: "open_branch", operationId: "prompt", observationRef: seen.value.observationRef, branchUrl: "https://food.bolt.eu/en/1-tallinn/p/456-other/" });
    expect(confirmation.value).toMatchObject({ status: "blocked", code: "branch_change_confirmation_unhandled" });
  });

  it("refuses unsupported actions before invoking a browser effect", async () => {
    const { runtime, spec, host, calls } = legacy();
    const inspected = await bolt(runtime, spec, host, { action: "inspect" });
    const blocked = await bolt(runtime, spec, host, { action: "read_order", operationId: "order-1", observationRef: inspected.value.observationRef });
    expect(blocked.raw.isError).toBe(true);
    expect(blocked.value).toMatchObject({ status: "blocked", code: "action_bindings_required" });
    expect(calls().filter((name) => name === "agent_browser_click" || name === "agent_browser_fill")).toEqual([]);
  });
});
