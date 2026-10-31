// The agents catalog's decide and extract tools: small helper models that judge or read and can never act, so every bot
// on every engine has them. The internal route (server/routes/helper-tools.ts) says plainly when none is set up.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

const HELPER_TOOL_ROUTES: Readonly<Record<string, string>> = { decide: "helpers/decide", extract: "helpers/extract", qualify_lead: "helpers/qualify-lead" };
export const HELPER_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(HELPER_TOOL_ROUTES));

export async function callHelperTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse(`/api/internal/${HELPER_TOOL_ROUTES[name]}`, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "The helper model did not answer. Try again shortly."), isError: true };
}

export const HELPER_TOOL_DEFINITIONS = [
  {
    name: "qualify_lead",
    description: "Ask Jev whether sourced evidence is sufficient, then whether a lead matches the supplied ICP. Records decisions for review. Needs research or review when evidence or certainty is insufficient; it never changes CRM records.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        lead_id: { type: "string", description: "Stable CRM lead identifier." },
        evidence: { type: "string", description: "Observed lead facts and their source references." },
        icp: { type: "string", description: "Exact applicable ideal customer profile." },
        icp_version: { type: "string", description: "ICP document reference and version." },
      },
      required: ["lead_id", "evidence", "icp", "icp_version"],
    },
  },
  {
    name: "decide",
    description: "Ask a decision model typed questions about some state; it answers with probabilities and cannot act.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        state: { type: "string", description: "What to judge: text or JSON." },
        questions: {
          type: "object",
          description: 'Up to 8. id → {"type":"choice","instructions":"…","options":{"key":"meaning"}}, {"type":"yesno","instructions":"…"} or {"type":"score","instructions":"…","levels":["lowest",…]}',
          additionalProperties: { type: "object" },
        },
      },
      required: ["state", "questions"],
    },
  },
  {
    name: "extract",
    description: "Read typed values out of text or an image; null where it does not say. Not for long sums or table totals.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        fields: {
          type: "object",
          description: 'Up to 30. name → {"type":"string|number|date|boolean|enum","description":"…","options":[…] for enum}',
          additionalProperties: { type: "object" },
        },
        text: { type: "string" },
        file: { type: "string", description: "Or a .png, .jpg, .webp or text file in your working folder." },
      },
      required: ["fields"],
    },
  },
];
