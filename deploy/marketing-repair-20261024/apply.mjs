#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const DESIRED = JSON.parse(fs.readFileSync(path.join(HERE, "desired-state.json"), "utf8"));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = (name) => args.includes(name);
const URL_BASE = option("--url", process.env.OPENMAUSBOT_URL || "").replace(/\/+$/, "");
if (!URL_BASE) throw new Error("Pass --url explicitly. The live API is inside the container at http://127.0.0.1:8799; the host port is not the live app.");
const BACKUP_DIR = path.resolve(option("--backup-dir", path.join(ROOT, ".omb-scratch/marketing-repair-20261024")));
const SKIP_MCP = has("--skip-mcp-servers");
const APPLY = has("--apply");
const ROLLBACK = option("--rollback", null);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function api(method, route, body) {
  const response = await fetch(`${URL_BASE}${route}`, {
    method,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { text }; }
  if (!response.ok) {
    const error = new Error(`${method} ${route} -> ${response.status}: ${parsed?.error ?? text.slice(0, 300)}`);
    error.status = response.status;
    error.body = parsed;
    throw error;
  }
  return parsed;
}

const bots = async () => (await api("GET", "/api/bots?messages=0")).bots;
const skills = async (id) => (await api("GET", `/api/bots/${id}/skills`)).skills ?? [];
const byRole = (list) => {
  const darcy = list.find(bot => bot.id === DESIRED.bots.darcy.id) ?? list.find(bot => bot.name === "Darcy McGuire");
  const liz = list.find(bot => bot.id === DESIRED.bots.liz.id) ?? list.find(bot => bot.name === "Liz Lemon");
  if (!darcy || !liz) throw new Error("Both Darcy McGuire and Liz Lemon must exist before applying this repair.");
  return { darcy, liz };
};
const resolve = (value, ids) => Array.isArray(value) ? value.map(item => item === "$liz" ? ids.liz.id : item) : value;
const snapshot = async (bot) => {
  const list = await skills(bot.id);
  const current = (await bots()).find(item => item.id === bot.id) ?? bot;
  return {
    id: current.id, name: current.name, soul: current.soul ?? "",
    soulSha256: sha256(current.soul ?? ""), modelSelection: current.modelSelection,
    fallback: current.fallback ?? null, browser: current.browser ?? null,
    connectorScopes: current.connectorScopes ?? null, connectorTools: current.connectorTools ?? null,
    mcpServers: current.mcpServers ?? null, toolScope: current.toolScope ?? null,
    receiptsFor: current.receiptsFor ?? null, admissionRequired: current.admissionRequired ?? null,
    skills: list.map(skill => ({ name: skill.name, enabled: skill.enabled, sha256: skill.sha256, source: skill.source })),
  };
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const deep = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const desiredSoul = (role) => fs.readFileSync(path.join(HERE, DESIRED.bots[role].soul), "utf8");
const desiredSkill = (entry) => fs.readFileSync(path.join(HERE, entry.path), "utf8");
const resolveTarget = (role, ids) => role === "darcy" ? ids.darcy : ids.liz;
const resolvedReceipts = (role, ids) => {
  const raw = DESIRED.bots[role].receiptsFor;
  return raw && typeof raw === "object" && Array.isArray(raw.value) ? resolve(raw.value, ids) : raw;
};

function plannedOperations(bot, role, current, ids) {
  const wanted = DESIRED.bots[role];
  const operations = [];
  if (wanted.soul && (current.soul ?? "").trim() !== desiredSoul(role).trim()) operations.push({ kind: "soul", role });
  if (wanted.browser !== "UNCHANGED" && current.browser !== wanted.browser) operations.push({ kind: "browser", role, value: wanted.browser });
  const wantedScopes = wanted.connectorScopes?.apps ? { apps: wanted.connectorScopes.apps } : wanted.connectorScopes;
  if (wantedScopes && !deep(current.connectorScopes, wantedScopes)) operations.push({ kind: "connectorScopes", role, value: wantedScopes });
  if (wanted.mcpServers && wanted.mcpServers.mode === "replace" && !deep(current.mcpServers, wanted.mcpServers.value)) operations.push({ kind: "mcpServers", role, value: wanted.mcpServers.value });
  if (wanted.mcpServers && wanted.mcpServers.mode === "merge") {
    const missing = wanted.mcpServers.value.filter(name => !(current.mcpServers ?? []).includes(name));
    if (missing.length) operations.push({ kind: "mcpServersAdd", role, value: missing });
  }
  const receipts = resolvedReceipts(role, ids);
  if (receipts !== "UNCHANGED" && !deep(current.receiptsFor, receipts)) operations.push({ kind: "receiptsFor", role, value: receipts });
  if (wanted.admissionRequired !== undefined && current.admissionRequired !== wanted.admissionRequired) operations.push({ kind: "admissionRequired", role, value: wanted.admissionRequired });
  for (const name of DESIRED.skills.disable[role] ?? []) {
    const found = current.skills.find(skill => skill.name === name);
    if (found?.enabled) operations.push({ kind: "disableSkill", role, name });
  }
  for (const entry of DESIRED.skills.install.filter(item => item.bot === role)) {
    const found = current.skills.find(skill => skill.name === entry.name);
    if (!found) operations.push({ kind: "installSkill", role, name: entry.name, sha256: entry.sha256 });
    else if (!found.enabled || found.sha256 !== entry.sha256) operations.push({ kind: "repairSkill", role, name: entry.name, sha256: entry.sha256 });
  }
  return operations;
}

async function checkIdle(list) {
  const busy = list.filter(bot => bot.busy === true || bot.waitingForTeammates === true || bot.activity === "working");
  if (busy.length) throw new Error(`Refusing to change busy bots: ${busy.map(bot => bot.name).join(", ")}. Wait for their turns to settle; do not interrupt.`);
}

async function apply() {
  let list = await bots();
  const ids = byRole(list);
  const before = { darcy: await snapshot(ids.darcy), liz: await snapshot(ids.liz) };
  const operations = [...plannedOperations(ids.darcy, "darcy", before.darcy, ids), ...plannedOperations(ids.liz, "liz", before.liz, ids)];
  if (!operations.length) {
    console.log(JSON.stringify({ status: "unchanged", operations: [] }, null, 2));
    return;
  }
  if (!APPLY) {
    console.log(JSON.stringify({ status: "dry-run", url: URL_BASE, before, operations }, null, 2));
    return;
  }
  await checkIdle(list);
  // The dry-run and the apply must not bridge a write by someone else.
  await checkIdle(await bots());
  const recheck = { darcy: await snapshot(ids.darcy), liz: await snapshot(ids.liz) };
  if (!deep(recheck, before)) throw new Error("Live bot or skill state drifted after the snapshot; re-run the dry-run and review it before applying.");

  if (!SKIP_MCP) {
    const available = new Set((await api("GET", "/api/mcp/servers")).servers.map(server => server.name));
    for (const role of ["darcy", "liz"]) {
      const wanted = DESIRED.bots[role].mcpServers;
      if (wanted?.mode !== "replace" && wanted?.mode !== "merge") continue;
      const missing = wanted.value.filter(name => !available.has(name));
      if (missing.length) throw new Error(`MCP server(s) not installed: ${missing.join(", ")}. Refusing a partial role surface.`);
    }
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(BACKUP_DIR, `backup-${stamp}.json`);
  const backup = { schema: "marketing-repair-backup/v1", createdAt: new Date().toISOString(), url: URL_BASE, before, operations, status: "applying" };
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2) + "\n", { mode: 0o600 });

  const changed = [];
  try {
    for (const entry of DESIRED.skills.install) {
      const target = resolveTarget(entry.bot, ids);
      const current = await skills(target.id);
      const found = current.find(skill => skill.name === entry.name);
      if (found && found.sha256 === entry.sha256) {
        if (!found.enabled) {
          await api("PATCH", `/api/bots/${target.id}/skills/${entry.name}`, { enabled: true });
          changed.push({ kind: "skill-enabled", role: entry.bot, name: entry.name });
        }
        continue;
      }
      const text = desiredSkill(entry);
      const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? entry.name;
      if (found) await api("DELETE", `/api/bots/${target.id}/skills/${entry.name}`);
      await api("POST", `/api/bots/${target.id}/skill-template`, { name: entry.name, description, warnings: [], text, source: entry.source, enabled: false });
      changed.push({ kind: "skill-installed", role: entry.bot, name: entry.name });
    }
    for (const role of ["darcy", "liz"]) {
      const target = resolveTarget(role, ids);
      for (const name of DESIRED.skills.disable[role] ?? []) {
        const current = await skills(target.id);
        if (current.find(skill => skill.name === name)?.enabled) {
          await api("PATCH", `/api/bots/${target.id}/skills/${name}`, { enabled: false });
          changed.push({ kind: "skill-disabled", role, name });
        }
      }
    }
    for (const role of ["darcy", "liz"]) {
      const target = resolveTarget(role, ids);
      const wanted = DESIRED.bots[role];
      const patch = {};
      if (wanted.browser !== "UNCHANGED") patch.browser = wanted.browser;
      if (wanted.connectorScopes) patch.connectorScopes = wanted.connectorScopes.apps ? { apps: wanted.connectorScopes.apps } : wanted.connectorScopes;
      if (wanted.mcpServers?.mode === "replace" && !SKIP_MCP) patch.mcpServers = wanted.mcpServers.value;
      if (wanted.mcpServers?.mode === "merge" && !SKIP_MCP) {
        patch.mcpServers = [...new Set([...(current.mcpServers ?? []), ...wanted.mcpServers.value])];
      }
      const receipts = resolvedReceipts(role, ids);
      if (receipts !== "UNCHANGED") patch.receiptsFor = receipts;
      if (wanted.admissionRequired !== undefined) patch.admissionRequired = wanted.admissionRequired;
      if (Object.keys(patch).length) {
        const current = (await bots()).find(bot => bot.id === target.id);
        const effective = { ...patch };
        if (deep(current.connectorScopes, patch.connectorScopes)) delete effective.connectorScopes;
        if (deep(current.mcpServers, patch.mcpServers)) delete effective.mcpServers;
        if (deep(current.receiptsFor, patch.receiptsFor)) delete effective.receiptsFor;
        if (current.admissionRequired === patch.admissionRequired) delete effective.admissionRequired;
        if (current.browser === patch.browser) delete effective.browser;
        if (Object.keys(effective).length) {
          await api("PATCH", `/api/bots/${target.id}`, effective);
          changed.push({ kind: "bot-config", role, fields: Object.keys(effective) });
        }
      }
      if (wanted.soul) {
        const current = (await bots()).find(bot => bot.id === target.id);
        if ((current.soul ?? "").trim() !== desiredSoul(role).trim()) {
          await api("PATCH", `/api/bots/${target.id}/profile`, { soul: desiredSoul(role) });
          changed.push({ kind: "soul", role });
        }
      }
    }
    for (const entry of DESIRED.skills.install) {
      const target = resolveTarget(entry.bot, ids);
      await api("PATCH", `/api/bots/${target.id}/skills/${entry.name}`, { enabled: true });
      changed.push({ kind: "skill-enabled", role: entry.bot, name: entry.name });
    }

    list = await bots();
    const after = { darcy: await snapshot(byRole(list).darcy), liz: await snapshot(byRole(list).liz) };
    const failures = [];
    for (const role of ["darcy", "liz"]) {
      const wanted = DESIRED.bots[role];
      const current = after[role];
      if (wanted.soul && current.soul.trim() !== desiredSoul(role).trim()) failures.push(`${role}: soul readback differs`);
      if (wanted.soul && current.soulSha256 !== wanted.soulSha256) failures.push(`${role}: soul hash differs`);
      if (wanted.browser !== "UNCHANGED" && current.browser !== wanted.browser) failures.push(`${role}: browser is ${current.browser}, expected ${wanted.browser}`);
      const expectedScopes = wanted.connectorScopes?.apps ? { apps: wanted.connectorScopes.apps } : wanted.connectorScopes;
      if (expectedScopes && !deep(current.connectorScopes, expectedScopes)) failures.push(`${role}: connectorScopes readback differs`);
      if (wanted.mcpServers?.mode === "replace" && !SKIP_MCP && !deep(current.mcpServers, wanted.mcpServers.value)) failures.push(`${role}: mcpServers readback differs`);
      if (wanted.mcpServers?.mode === "merge" && !SKIP_MCP
        && wanted.mcpServers.value.some(name => !(current.mcpServers ?? []).includes(name))) failures.push(`${role}: merged mcpServers readback differs`);
      const receipts = resolvedReceipts(role, ids);
      if (receipts !== "UNCHANGED" && !deep(current.receiptsFor, receipts)) failures.push(`${role}: receiptsFor readback differs`);
      if (wanted.admissionRequired !== undefined && current.admissionRequired !== wanted.admissionRequired) failures.push(`${role}: admissionRequired readback differs`);
      if (!deep(current.modelSelection, before[role].modelSelection)) failures.push(`${role}: modelSelection changed`);
      if (!deep(current.fallback, before[role].fallback)) failures.push(`${role}: fallback changed`);
      if (!deep(current.toolScope, before[role].toolScope)) failures.push(`${role}: toolScope changed`);
      for (const name of DESIRED.skills.disable[role] ?? []) {
        if (current.skills.find(skill => skill.name === name)?.enabled) failures.push(`${role}: ${name} is still enabled`);
      }
      for (const entry of DESIRED.skills.install.filter(item => item.bot === role)) {
        const found = current.skills.find(skill => skill.name === entry.name);
        if (!found?.enabled || found.sha256 !== entry.sha256) failures.push(`${role}: ${entry.name} readback/hash differs`);
      }
    }
    if (failures.length) throw new Error(`Readback failed: ${failures.join("; ")}`);
    backup.after = after;
    backup.status = "applied";
    backup.appliedAt = new Date().toISOString();
    backup.changed = changed;
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ status: "applied", backup: backupFile, changed, before, after }, null, 2));
  } catch (error) {
    backup.status = "failed";
    backup.error = error instanceof Error ? error.message : String(error);
    try {
      const partial = byRole(await bots());
      backup.after = { darcy: await snapshot(partial.darcy), liz: await snapshot(partial.liz) };
    } catch {}
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2) + "\n", { mode: 0o600 });
    try {
      await rollbackFrom(backup, backupFile);
    } catch (rollbackError) {
      console.error(`Rollback after failed apply also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
    }
    throw error;
  }
}

async function rollbackFrom(backup, file) {
  const list = await bots();
  const ids = byRole(list);
  await checkIdle(list);
  const current = { darcy: await snapshot(ids.darcy), liz: await snapshot(ids.liz) };
  const after = backup.after ?? backup.before;
  const drift = [];
  const restored = [];
  for (const role of ["darcy", "liz"]) {
    const target = resolveTarget(role, ids);
    const before = backup.before[role];
    const expected = after[role];
    const now = current[role];
    const patch = {};
    if (!deep(now.browser, expected.browser)) drift.push(`${role}: browser changed since apply`);
    else if (!deep(now.browser, before.browser)) patch.browser = before.browser === null ? true : before.browser;
    if (!deep(now.connectorScopes, expected.connectorScopes)) drift.push(`${role}: connectorScopes changed since apply`);
    else if (!deep(now.connectorScopes, before.connectorScopes)) patch.connectorScopes = before.connectorScopes;
    if (!deep(now.mcpServers, expected.mcpServers)) drift.push(`${role}: mcpServers changed since apply`);
    else if (!deep(now.mcpServers, before.mcpServers)) patch.mcpServers = before.mcpServers;
    if (!deep(now.receiptsFor, expected.receiptsFor)) drift.push(`${role}: receiptsFor changed since apply`);
    else if (!deep(now.receiptsFor, before.receiptsFor)) patch.receiptsFor = before.receiptsFor;
    if (!deep(now.admissionRequired, expected.admissionRequired)) drift.push(`${role}: admissionRequired changed since apply`);
    else if (!deep(now.admissionRequired, before.admissionRequired)) patch.admissionRequired = before.admissionRequired === null ? false : before.admissionRequired;
    if (!deep(now.modelSelection, expected.modelSelection)) drift.push(`${role}: modelSelection changed since apply`);
    if (!deep(now.fallback, expected.fallback)) drift.push(`${role}: fallback changed since apply`);
    if (!deep(now.toolScope, expected.toolScope)) drift.push(`${role}: toolScope changed since apply`);
    if (Object.keys(patch).length) {
      await api("PATCH", `/api/bots/${target.id}`, patch);
      restored.push({ kind: "bot-config", role, fields: Object.keys(patch) });
    }
    if (now.soul === expected.soul) {
      if (now.soul !== before.soul) {
        await api("PATCH", `/api/bots/${target.id}/profile`, { soul: before.soul });
        restored.push({ kind: "soul", role });
      }
    } else drift.push(`${role}: soul changed since apply`);
    for (const entry of DESIRED.skills.install.filter(item => item.bot === role)) {
      const targetSkill = now.skills.find(skill => skill.name === entry.name);
      const beforeSkill = before.skills.find(skill => skill.name === entry.name);
      if (!targetSkill) continue;
      if (expected.skills.find(skill => skill.name === entry.name)?.sha256 !== targetSkill.sha256) {
        drift.push(`${role}: ${entry.name} changed since apply`);
        continue;
      }
      if (!beforeSkill) {
        await api("DELETE", `/api/bots/${target.id}/skills/${entry.name}`);
        restored.push({ kind: "skill-removed", role, name: entry.name });
      }
    }
    for (const skill of before.skills) {
      const nowSkill = now.skills.find(item => item.name === skill.name);
      if (!nowSkill) { drift.push(`${role}: ${skill.name} disappeared`); continue; }
      if (nowSkill.sha256 !== expected.skills.find(item => item.name === skill.name)?.sha256) {
        drift.push(`${role}: ${skill.name} content changed since apply`);
        continue;
      }
      if (nowSkill.enabled !== skill.enabled) {
        await api("PATCH", `/api/bots/${target.id}/skills/${skill.name}`, { enabled: skill.enabled });
        restored.push({ kind: "skill-state", role, name: skill.name, enabled: skill.enabled });
      }
    }
  }
  const receipt = { schema: "marketing-repair-rollback/v1", at: new Date().toISOString(), backup: file, restored, drift, status: drift.length ? "partial" : "restored" };
  const rollbackFile = file.replace(/\.json$/, `.rollback-${Date.now()}.json`);
  fs.writeFileSync(rollbackFile, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ ...receipt, file: rollbackFile }, null, 2));
  if (drift.length) throw new Error(`Rollback preserved live drift and did not overwrite it: ${drift.join("; ")}`);
}

async function main() {
  if (ROLLBACK) {
    const file = path.resolve(ROLLBACK);
    const backup = JSON.parse(fs.readFileSync(file, "utf8"));
    if (backup.schema !== "marketing-repair-backup/v1" || !backup.before || !backup.after) throw new Error("Not a complete marketing-repair backup with before and after states.");
    await rollbackFrom(backup, file);
    return;
  }
  await apply();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
