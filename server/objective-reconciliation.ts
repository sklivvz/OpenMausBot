import type { WireMessage } from "../shared/wire.ts";
import { requestNeedsInput } from "./guarded-requests.ts";

export type Reconciliation = { status: "ready" | "waiting" | "stopped" | "intervened"; detail: string; leafId?: string; sourceMessageId?: string; instructions?: Array<{ messageId: string; text: string }> };

export function reconcileObjectiveConversation(messages: WireMessage[], leafId: string | null, anchor: { sendId?: string; text?: string; leafId: string | null }, task: { busy?: boolean; waitingForTeammates?: boolean; rewound?: boolean }): Reconciliation {
  const hold = (detail: string): Reconciliation => ({ status: "intervened", detail });
  const sources = anchor.sendId ? messages.filter(m => m.sendId === anchor.sendId) : [];
  if (anchor.sendId && sources.length !== 1) return hold("Objective request identity is missing or ambiguous; reconciliation needs review.");
  if (sources[0]?.requestCancelled) return { status: "stopped", detail: "The operator stopped the objective request. No automatic resume." };
  if (task.rewound) return hold("The selected conversation was rewound; preserve the selected branch for review.");
  const byId = new Map(messages.map(m => [m.id, m]));
  const path: WireMessage[] = [], seen = new Set<string>();
  let cursor = leafId;
  while (cursor) {
    if (seen.has(cursor) || !byId.has(cursor)) return hold("Conversation ancestry is incomplete or cyclic; no continuation admitted.");
    seen.add(cursor);
    const message = byId.get(cursor)!;
    path.unshift(message);
    cursor = message.parentId ?? null;
  }
  let start = path.findIndex(m => m.id === (sources[0]?.id ?? anchor.leafId));
  if (start < 0 && sources[0] && anchor.text) {
    const replacements = path.filter(m => m.role === "user" && !m.steered && !m.aside && !m.peerAsk && m.text === anchor.text && m.parentId === sources[0].parentId);
    if (replacements.length === 1) start = path.indexOf(replacements[0]);
  }
  if (start < 0) return hold("Current branch does not descend from the objective or an exact retry; reconciliation needs review.");
  const changes = path.slice(start);
  if (changes.some(m => m.requestCancelled)) return { status: "stopped", detail: "An operator Stop exists in the current objective lineage. No automatic resume." };
  if (task.busy || task.waitingForTeammates || changes.some(requestNeedsInput)) return { status: "waiting", detail: "Current conversation still has live work, teammate returns or input dependencies." };
  const source = changes.findLast(m => m.role === "user" && !m.steered && !m.aside && !m.peerAsk);
  const terminal = changes.findLast(m => m.role === "bot" && m.kind === "text" && m.turnTerminal);
  const latestTurn = changes.findLast(m => m.turnId);
  const outcome = changes.findLast(m => m.turnSucceeded !== undefined);
  const lastUser = changes.findLast(m => m.role === "user");
  if (!source || source.id === sources[0]?.id || !terminal?.turnSucceeded || outcome?.turnSucceeded !== true ||
    terminal.requestMessageId !== source.id || latestTurn?.turnId !== terminal.turnId ||
    (lastUser && changes.indexOf(lastUser) > changes.indexOf(terminal))) return hold("New conversation work has no proven successful terminal outcome yet; no replay admitted.");
  const instructions = changes.filter(m => m.role === "user" && !m.relayed && !m.peerAsk && !m.aside && m.text && m.text !== anchor.text).map(m => ({ messageId: m.id, text: m.text! }));
  if (JSON.stringify(instructions).length > 16_000) return hold("Changed user instructions exceed the bounded reconciliation context; review before continuing.");
  return { status: "ready", leafId: leafId!, sourceMessageId: source.id, instructions, detail: "Reconciled a successful user-directed continuation or exact retry. Latest instructions and holds supersede the old checkpoint; reconcile effects before advancing other objectives." };
}
