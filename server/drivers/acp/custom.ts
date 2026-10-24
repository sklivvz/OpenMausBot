// Bring-your-own engine: any agent CLI speaking ACP over stdio, from one config entry:
//   { "instances": { "my-agent": {
//       "driver": "customAcp",
//       "displayName": "My Agent",
//       "config": { "cli": "my-agent acp" } } } }
// `cli` is the whole command ("npx -y some-agent acp" works). No auth step: the CLI is signed in from
// a terminal. session/new's model select, when it has one, is the picker. A thought_level select on
// that session is reasoning. With neither, one passthrough model id and no model switch.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelCatalog, ModelVariantOption } from "../../contracts.ts";
import { killCliTree, spawnCli } from "../../procs.ts";
import { createAcpDriver, offeredModels, type AcpConfig, type AcpSupport } from "./core.ts";

const CONFIGURE_HINT =
  'a custom ACP engine needs its command — add "config": { "cli": "<your-agent> acp" } to this instance in config.json, or use Settings → Engines → Set CLI…';

/** The id a bot keeps until its CLI advertises a model select. */
export const CUSTOM_ACP_PASSTHROUGH_MODEL = "agent-default";

export const CUSTOM_ACP_PASSTHROUGH: ModelCatalog = {
  default: CUSTOM_ACP_PASSTHROUGH_MODEL,
  options: [{ id: CUSTOM_ACP_PASSTHROUGH_MODEL, label: "Agent default", custom: true }],
};

/** session/new carries the select. A silent CLI must not hold startup for the turn timeout. */
export const CUSTOM_ACP_MODELS_TIMEOUT_ENV = "CUSTOM_ACP_MODELS_TIMEOUT_MS";
const CUSTOM_ACP_MODELS_TIMEOUT_MS = 15_000;

function modelsTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env[CUSTOM_ACP_MODELS_TIMEOUT_ENV];
  if (raw === undefined) return CUSTOM_ACP_MODELS_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647
    ? parsed
    : CUSTOM_ACP_MODELS_TIMEOUT_MS;
}

function configOptionsOf(result: unknown): unknown[] {
  const options = (result as { configOptions?: unknown } | null)?.configOptions;
  return Array.isArray(options) ? options : [];
}

function namedValues(entries: unknown, into: Map<string, string>): void {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (typeof entry?.value !== "string") {
      if (Array.isArray(entry?.options)) namedValues(entry.options, into);
      continue;
    }
    if (into.has(entry.value)) continue;
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    into.set(entry.value, name || entry.value || "Provider default");
  }
}

function thoughtLevelOptions(result: unknown): ModelVariantOption[] | undefined {
  const option = configOptionsOf(result).find((entry) => {
    const select = entry as { id?: unknown; type?: unknown; category?: unknown };
    return select?.type === "select" && typeof select.id === "string"
      && (select.id === "effort" || select.category === "thought_level");
  }) as { options?: unknown } | undefined;
  if (!option) return undefined;
  const variants: ModelVariantOption[] = [];
  const names = new Map<string, string>();
  namedValues(option.options, names);
  for (const [id, label] of names) variants.push({ id, label });
  return variants.length ? variants : undefined;
}

/** Model ids are the select values, opaque to us: DeepSeek's are JSON provider/model pairs. */
export function catalogFromCustomSession(result: unknown): ModelCatalog | null {
  const variants = thoughtLevelOptions(result);
  const model = configOptionsOf(result).find((entry) => {
    const select = entry as { id?: unknown; type?: unknown };
    return select?.id === "model" && select?.type === "select";
  }) as { options?: unknown; currentValue?: unknown } | undefined;
  const ids = offeredModels(result, "model");
  if (!model || !ids.length) {
    if (!variants) return null;
    return {
      default: CUSTOM_ACP_PASSTHROUGH.default,
      options: [{ ...CUSTOM_ACP_PASSTHROUGH.options[0], variants }],
    };
  }
  const names = new Map<string, string>();
  namedValues(model.options, names);
  const seen = new Set<string>();
  const options: ModelCatalog["options"] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({
      id,
      label: names.get(id) ?? id,
      custom: true,
      ...(variants ? { variants } : {}),
    });
  }
  const current = typeof model.currentValue === "string" && seen.has(model.currentValue)
    ? model.currentValue
    : options[0].id;
  return { default: current, options };
}

function probeCustomSession(
  cli: string,
  environment: Record<string, string | undefined>,
): Promise<unknown> {
  const cwd = mkdtempSync(join(tmpdir(), "omb-custom-acp-"));
  const timeoutMs = modelsTimeoutMs(environment);
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(cli, [], { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      try { rmSync(cwd, { recursive: true, force: true }); } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let settled = false;
    let buffer = "";
    let nextId = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const write = (message: unknown) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {}
    };
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const abandoned = new Error("custom ACP model probe finished");
      for (const waiter of pending.values()) waiter.reject(error ?? abandoned);
      pending.clear();
      try { child.stdin.end(); } catch {}
      void killCliTree(child).finally(() => {
        try { rmSync(cwd, { recursive: true, force: true }); } catch {}
      });
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error("custom ACP did not list its models in time")),
      timeoutMs,
    );
    timer.unref?.();
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(new Error(`custom ACP exited ${code} while listing its models`)));
    child.stderr?.resume();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message: { id?: unknown; method?: unknown; result?: unknown; error?: { message?: unknown } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        // session/new can ask the client and stall until something answers. The probe session is discarded.
        if (message?.id !== undefined && typeof message.method === "string") {
          write({ jsonrpc: "2.0", id: message.id, result: null });
          continue;
        }
        if (typeof message?.id !== "number") continue;
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(String(message.error.message ?? "ACP request failed")));
        else waiter.resolve(message.result);
      }
    });
    const request = (method: string, params: unknown) => new Promise<unknown>((resolveRequest, rejectRequest) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      write({ jsonrpc: "2.0", id, method, params });
    });
    void (async () => {
      await request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "openmausbot", version: "0.0.0" },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      return request("session/new", { cwd, mcpServers: [] });
    })().then((result) => finish(null, result), (error: Error) => finish(error));
  });
}

async function resolveModels(
  environment: Record<string, string | undefined>,
  config: AcpConfig,
): Promise<ModelCatalog> {
  if (!config.cli.trim()) return CUSTOM_ACP_PASSTHROUGH;
  const session = await probeCustomSession(config.cli, environment);
  return catalogFromCustomSession(session) ?? CUSTOM_ACP_PASSTHROUGH;
}

function fallbackModel(sessionConfig: unknown, catalogDefault: string): string | null {
  const offered = offeredModels(sessionConfig, "model");
  if (catalogDefault && offered.includes(catalogDefault)) return catalogDefault;
  return offered[0] ?? null;
}

const support: AcpSupport = {
  driverKind: "customAcp",
  displayName: "Custom (ACP)",
  access: "custom",
  models: CUSTOM_ACP_PASSTHROUGH,
  modelVariants: true,
  selectModel: { configId: "model" },
  passthroughWithoutModelSelect: true,
  fallbackModel,
  resolveModels,
  resolveTurnModel: (model) => (model === CUSTOM_ACP_PASSTHROUGH_MODEL ? undefined : model),
  defaultCli: "",
  nativeSource: "custom.acp",
  loginNote: CONFIGURE_HINT,
  spawnArgs: () => [],
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: () => true,
};

const base = createAcpDriver(support);

export const CustomAcpDriver: typeof base = {
  ...base,
  decodeConfig(raw) {
    const decoded = base.decodeConfig(raw);
    if (!decoded.cli.trim()) throw new Error(CONFIGURE_HINT);
    return decoded;
  },
  async create(input) {
    if (!input.config.cli.trim()) throw new Error(CONFIGURE_HINT);
    return base.create(input);
  },
};
