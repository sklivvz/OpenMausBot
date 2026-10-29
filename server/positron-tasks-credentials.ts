import { join } from "node:path";
import { DATA_DIR } from "./config.ts";
import type { McpServerSpec } from "./contracts.ts";
import { readPositronTasksCredential } from "./positron-tasks-credential-file.ts";

export const POSITRON_TASKS_MCP = "positron-tasks";
export const POSITRON_TASKS_CREDENTIALS = join(DATA_DIR, "positron-tasks-credentials");

export function resolvePositronTasksMcp(
  servers: Record<string, McpServerSpec>, botId: string | undefined, directory = POSITRON_TASKS_CREDENTIALS,
): Record<string, McpServerSpec> {
  if (!Object.hasOwn(servers, POSITRON_TASKS_MCP)) return servers;
  const { [POSITRON_TASKS_MCP]: server, ...other } = servers;
  if (!("url" in server) || server.type !== "http") return other;
  const authorization = readPositronTasksCredential(botId, server.url, directory);
  if (!authorization) return other;
  const headers = Object.fromEntries(Object.entries(server.headers).filter(([name]) => name.toLowerCase() !== "authorization"));
  return { ...other, [POSITRON_TASKS_MCP]: { ...server, headers: { ...headers, Authorization: authorization } } };
}
