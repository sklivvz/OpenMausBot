import type { QualificationTransport, Entry } from "./qualification-writer.ts";

type Relay = (payload: Record<string, unknown>, beforeSend: () => void) => Promise<{ status: number; bytes: Uint8Array; contentType: string }>;
const record = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("Unexpected connected-app response.");
  return x as Record<string, unknown>;
};
function decode(bytes: Uint8Array, contentType: string): Record<string, unknown> {
  const text = Buffer.from(bytes).toString("utf8");
  const wire = contentType.includes("text/event-stream") ? text.split("\n").filter((s) => s.startsWith("data: ")).map((s) => s.slice(6)).at(-1) : text;
  if (!wire) throw new Error("Connected-app response was empty.");
  const outer = record(JSON.parse(wire)), result = record(outer.result);
  if (result.isError === true || !Array.isArray(result.content)) throw new Error("Connected-app request failed.");
  const content = record(result.content[0]);
  if (typeof content.text !== "string") throw new Error("Connected-app response was not text.");
  const body = record(JSON.parse(content.text));
  if (body.successful !== true) throw new Error("Connected-app operation was not successful.");
  return record(body.data);
}
export async function qualificationTransport(relay: Relay, authorized: () => boolean): Promise<QualificationTransport> {
  const check = () => { if (!authorized()) throw new Error("The active turn is no longer authorized."); };
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await relay({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, check);
    if (res.status < 200 || res.status >= 300) throw new Error("Connected-app request failed.");
    return decode(res.bytes, res.contentType);
  };
  const discovered = await call("COMPOSIO_SEARCH_TOOLS", { queries: [{ use_case: "Read and update an Attio list entry" }], session: { generate_id: true } });
  const session = record(discovered.session).id;
  if (typeof session !== "string" || !session) throw new Error("Connected-app session was unavailable.");
  const schemas = await call("COMPOSIO_GET_TOOL_SCHEMAS", { session_id: session, tool_slugs: ["ATTIO_GET_LIST_ENTRY", "ATTIO_PATCH_V2_LISTS_LIST_ENTRIES_ENTRY_ID"] });
  const available = record(schemas.tool_schemas);
  if (!available.ATTIO_GET_LIST_ENTRY || !available.ATTIO_PATCH_V2_LISTS_LIST_ENTRIES_ENTRY_ID) throw new Error("The required Attio entry tools are unavailable.");
  const run = async (tool_slug: string, args: Record<string, unknown>) => {
    const data = await call("COMPOSIO_MULTI_EXECUTE_TOOL", { session_id: session, tools: [{ tool_slug, arguments: args }], sync_response_to_workbench: false });
    if (!Array.isArray(data.results) || data.results.length !== 1) throw new Error("Connected-app result was incomplete.");
    const response = record(record(data.results[0]).response);
    if (response.successful !== true || response.data === undefined) throw new Error("Attio did not confirm the operation.");
    return response.data;
  };
  return {
    entry: async (list, entry_id) => record(record(await run("ATTIO_GET_LIST_ENTRY", { list, entry_id })).data) as unknown as Entry,
    patch: async (list, entry_id, entry_values) => { await run("ATTIO_PATCH_V2_LISTS_LIST_ENTRIES_ENTRY_ID", { list, entry_id, entry_values }); },

  };
}
