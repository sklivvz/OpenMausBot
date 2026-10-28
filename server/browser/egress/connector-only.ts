import { isIP } from "node:net";
import { z } from "zod";

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const BOT_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** A hostname whose whole subtree is refused in a bot's browser; the matching MCP connector is the intended route. */
export function connectorOnlyDomain(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.+$/u, "");
  if (!host || host.length > 253 || isIP(host) !== 0) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return null;
  return host;
}

export const connectorOnlyDomainSchema = z.string().trim().max(254)
  .transform((value) => value.toLowerCase().replace(/\.+$/u, ""))
  .refine((value) => connectorOnlyDomain(value) !== null, { message: "must be a domain name without a scheme, port, or path" });

/** `browserEngine.connectorOnlyDomainsByBot` in config.json: bot id to the hostnames its browser never connects to. */
export const connectorOnlyDomainsByBotSchema = z.record(
  z.string().trim().regex(BOT_ID, { message: "must be a bot id" }),
  z.array(connectorOnlyDomainSchema).max(64),
).refine((byBot) => Object.keys(byBot).length <= 100, { message: "must name at most 100 bots" });
export type ConnectorOnlyDomainsByBot = z.output<typeof connectorOnlyDomainsByBotSchema>;

/** `name` as a SOCKS request or a URL carries it, reduced to a comparable hostname. */
export function normalizeConnectorHost(name: string): string {
  return name.trim().toLowerCase().replace(/\.+$/u, "");
}

/** Whether `name` is one of `domains` or below one. `docs.google.com.attacker` is not below `docs.google.com`. */
export function isConnectorOnlyHost(name: string, domains: readonly string[]): boolean {
  const host = normalizeConnectorHost(name);
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The refused host an opening tool call would reach, or null. Every browser tool that opens an address takes it as `url`. */
export function connectorOnlyUrlHost(params: unknown, domains: readonly string[]): string | null {
  if (!domains.length || !params || typeof params !== "object") return null;
  const args = (params as { arguments?: unknown }).arguments;
  const url = args && typeof args === "object" ? (args as { url?: unknown }).url : undefined;
  if (typeof url !== "string") return null;
  try {
    const host = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(url.trim()) ? url.trim() : `https://${url.trim()}`).hostname;
    const normalized = normalizeConnectorHost(host);
    return isConnectorOnlyHost(normalized, domains) ? normalized : null;
  } catch {
    return null;
  }
}

/** What a browser tool call reads instead of opening a connector-only host. */
export const connectorOnlyRefusal = (host: string) =>
  `This browser cannot reach ${host}: it is connector-only. Use the matching MCP connector tool instead of opening it in the browser.`;

/** My Chrome is outside the network gate, so a restricted bot cannot be guarded there and gets no browser tools. */
export const CONNECTOR_ONLY_MY_CHROME_REFUSAL = "This bot's browser is limited to connector-only hosts, and this profile uses your own Chrome, outside OpenMausBot's network gate. Browser tools are disabled for this bot. Use the matching MCP connector tool instead.";
