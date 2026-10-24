import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../../config.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { recordEvents, type EventRecorder } from "../../testing/events.ts";
import {
  catalogFromCustomSession,
  CUSTOM_ACP_MODELS_TIMEOUT_ENV,
  CUSTOM_ACP_PASSTHROUGH,
  CustomAcpDriver,
} from "./custom.ts";
import { removeTempDir } from "../../testing/cleanup.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "testing", "fake-acp-cli.ts");

describe("CustomAcpDriver config", () => {
  it("teaches instead of ENOENT when the command is missing or blank", async () => {
    expect(() => CustomAcpDriver.decodeConfig({})).toThrow(/Set CLI|config\.json/);
    expect(() => CustomAcpDriver.decodeConfig({ cli: "   " })).toThrow(/<your-agent> acp/);
    await expect(
      CustomAcpDriver.create({
        instanceId: "custom-blank",
        displayName: undefined,
        environment: {},
        enabled: true,
        config: CustomAcpDriver.defaultConfig(),
      }),
    ).rejects.toThrow(/<your-agent> acp/);
  });

  it("keeps a real command verbatim, wrapper strings included", () => {
    expect(CustomAcpDriver.decodeConfig({ cli: "fx acp", fullAuto: true })).toMatchObject({
      cli: "fx acp",
      fullAuto: true,
    });
  });

  it("advertises the custom rail, multi-instance, and the passthrough model", () => {
    expect(CustomAcpDriver.metadata).toMatchObject({
      access: "custom",
      supportsMultipleInstances: true,
    });
    expect(CustomAcpDriver.models).toEqual(CUSTOM_ACP_PASSTHROUGH);
    expect(CustomAcpDriver.install).toBeUndefined();
  });
});

describe("CustomAcpDriver turns (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async (environment: Record<string, string> = {}) => {
    instance = await CustomAcpDriver.create({
      instanceId: "custom-test",
      displayName: "Custom Test",
      environment,
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-custom-acp-test-"));
  });

  afterEach(async () => {
    delete process.env.FAKE_ACP_MODE;
    delete process.env.FAKE_ACP_MODELS;
    delete process.env.FAKE_ACP_VARIANTS;
    delete process.env.FAKE_ACP_DUMP;
    delete process.env[CUSTOM_ACP_MODELS_TIMEOUT_ENV];
    delete process.env.XAI_API_KEY;
    recorder?.stop();
    await instance?.dispose();
    await removeTempDir(scratch);
  });

  it("runs a full turn through an arbitrary ACP CLI with canonical events", async () => {
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-custom", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    expect(types).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.completed",
      "item.started",
      "item.completed",
      "thread.token-usage.updated",
      "turn.completed",
    ]);
    expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "customAcp")).toBe(true);
    const text = recorder.events.find((e) => e.type === "item.completed" && (e as { itemType?: string }).itemType === "assistant_text")!;
    expect((text as { text?: string }).text).toBe("hello from fake acp");
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
  });

  it("passes instance env to the child but strips foreign provider keys", async () => {
    process.env.XAI_API_KEY = "xai-should-not-leak";
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    await create({ MY_AGENT_TOKEN: "tok-123" });
    await instance.adapter.sendTurn({ threadId: "t-custom-env", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string | undefined> };
    expect(seen.env.MY_AGENT_TOKEN).toBe("tok-123");
    expect(seen.env.XAI_API_KEY).toBeUndefined();
  });

  it("reports available with a working CLI and no sign-in requirement", async () => {
    await create();
    const snapshot = await instance.snapshot();
    expect(snapshot).toMatchObject({ state: "available" });
  });

  it("runs a turn that still names the passthrough model when the CLI advertises none", async () => {
    await create();
    await instance.adapter.sendTurn({ threadId: "t-custom-default", text: "hi", model: "agent-default" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(false);
  });
});

const EFFORT = [
  { value: "off", name: "Off" },
  { value: "low", name: "Low" },
  { value: "high", name: "High" },
  { value: "max", name: "Max" },
];

const FLASH = '["deepseek-official","deepseek-flash"]';
const PRO = '["deepseek-official","deepseek-v4-pro"]';

describe("catalogFromCustomSession", () => {
  it("uses the CLI's model values and thought_level options, including a grouped select", () => {
    const catalog = catalogFromCustomSession({
      configOptions: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          currentValue: FLASH,
          options: [{
            group: "deepseek-official",
            name: "DeepSeek",
            options: [
              { value: FLASH, name: "DeepSeek-V41-Flash" },
              { value: PRO, name: "DeepSeek-V4-Pro" },
              { value: FLASH, name: "duplicate" },
            ],
          }],
        },
        {
          id: "reasoning_effort",
          name: "Reasoning effort",
          category: "thought_level",
          type: "select",
          currentValue: "high",
          options: EFFORT,
        },
      ],
    });
    expect(catalog).toEqual({
      default: FLASH,
      options: [
        { id: FLASH, label: "DeepSeek-V41-Flash", custom: true, variants: EFFORT.map((option) => ({ id: option.value, label: option.name })) },
        { id: PRO, label: "DeepSeek-V4-Pro", custom: true, variants: EFFORT.map((option) => ({ id: option.value, label: option.name })) },
      ],
    });
  });

  it("keeps reasoning on the passthrough model when the CLI advertises no model select", () => {
    expect(catalogFromCustomSession({
      configOptions: [{
        id: "reasoning_effort",
        category: "thought_level",
        type: "select",
        currentValue: "",
        options: [{ value: "", name: "Provider default" }, { value: "high", name: "High" }],
      }],
    })).toEqual({
      default: "agent-default",
      options: [{
        id: "agent-default",
        label: "Agent default",
        custom: true,
        variants: [{ id: "", label: "Provider default" }, { id: "high", label: "High" }],
      }],
    });
  });

  it("returns null when the session advertises neither", () => {
    expect(catalogFromCustomSession({ configOptions: [] })).toBeNull();
    expect(catalogFromCustomSession(null)).toBeNull();
  });
});

describe("CustomAcpDriver advertised models (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async () => {
    instance = await CustomAcpDriver.create({
      instanceId: "custom-models",
      displayName: "DeepSeek",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-custom-acp-models-"));
  });

  afterEach(async () => {
    delete process.env.FAKE_ACP_MODE;
    delete process.env.FAKE_ACP_MODELS;
    delete process.env.FAKE_ACP_VARIANTS;
    delete process.env.FAKE_ACP_DUMP;
    delete process.env[CUSTOM_ACP_MODELS_TIMEOUT_ENV];
    recorder?.stop();
    await instance?.dispose();
    await removeTempDir(scratch);
  });

  it("lists the advertised models and their reasoning levels", async () => {
    process.env.FAKE_ACP_MODELS = "flash,pro";
    process.env.FAKE_ACP_VARIANTS = JSON.stringify({
      flash: { id: "reasoning_effort", currentValue: "high", options: EFFORT },
      pro: { id: "reasoning_effort", currentValue: "low", options: EFFORT },
    });
    await create();
    expect(instance.adapter.capabilities.modelVariants).toBe(true);
    expect(instance.models).toEqual({
      default: "flash",
      options: ["flash", "pro"].map((id) => ({
        id,
        label: id,
        custom: true,
        variants: EFFORT.map((option) => ({ id: option.value, label: option.name })),
      })),
    });
  });

  it("sets the chosen model and reasoning effort on the session", async () => {
    process.env.FAKE_ACP_MODELS = "flash,pro";
    process.env.FAKE_ACP_VARIANTS = JSON.stringify({
      flash: { id: "reasoning_effort", currentValue: "high", options: EFFORT },
      pro: { id: "reasoning_effort", currentValue: "low", options: EFFORT },
    });
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    await create();
    await instance.adapter.sendTurn({ threadId: "t-custom-model", text: "hi", model: "pro", variant: "max" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
    const calls = JSON.parse(readFileSync(`${dump}.config.json`, "utf8")) as Array<{ method: string; params: { configId: string; value: string } }>;
    expect(calls.map((call) => [call.params.configId, call.params.value])).toEqual([
      ["model", "pro"],
      ["reasoning_effort", "max"],
    ]);
    expect(JSON.parse(readFileSync(`${dump}.selection.json`, "utf8"))).toMatchObject({ model: "pro", variant: "max" });
  });

  it("keeps the CLI's current model when the bot still says agent default", async () => {
    process.env.FAKE_ACP_MODELS = "flash,pro";
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    await create();
    await instance.adapter.sendTurn({ threadId: "t-custom-fallback", text: "hi", model: "agent-default" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events).toContainEqual(expect.objectContaining({
      type: "runtime.notice",
      message: expect.stringContaining("agent-default"),
    }));
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
    const prompts = readFileSync(`${dump}.prompts.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { model: string });
    expect(prompts.at(-1)?.model).toBe("flash");
  });

  it("sets reasoning on the passthrough model when that is all the CLI advertises", async () => {
    process.env.FAKE_ACP_VARIANTS = JSON.stringify({
      "": { id: "reasoning_effort", currentValue: "high", options: EFFORT },
    });
    const dump = join(scratch, "dump.json");
    process.env.FAKE_ACP_DUMP = dump;
    await create();
    expect(instance.models.options[0]?.variants?.map((option) => option.id)).toEqual(["off", "low", "high", "max"]);
    await instance.adapter.sendTurn({ threadId: "t-custom-effort", text: "hi", model: "agent-default", variant: "max" });
    await recorder.until((e) => e.type === "turn.completed");
    const calls = JSON.parse(readFileSync(`${dump}.config.json`, "utf8")) as Array<{ params: { configId: string; value: string } }>;
    expect(calls.map((call) => [call.params.configId, call.params.value])).toEqual([["reasoning_effort", "max"]]);
  });

  it("returns the passthrough catalog when the CLI never answers", async () => {
    process.env.FAKE_ACP_MODE = "hang-initialize";
    process.env[CUSTOM_ACP_MODELS_TIMEOUT_ENV] = "200";
    const started = Date.now();
    instance = await CustomAcpDriver.create({
      instanceId: "custom-models-hang",
      displayName: "DeepSeek",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, fullAuto: false },
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(instance.models).toEqual(CUSTOM_ACP_PASSTHROUGH);
  });
});
