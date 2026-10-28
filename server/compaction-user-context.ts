import { contextText } from "./delta-context.ts";
import { workOrigin } from "./peer-provenance.ts";
import type { Message } from "./store.ts";

export const COMPACTED_USER_CONTEXT_MAX_BYTES = 6_000;
const FIRST_MESSAGE_RESERVE_BYTES = 1_000;
const OMITTED_NOTE_MAX_BYTES = 160;
const HEADER =
  "[Authenticated messages from this conversation, in order. User authorizations persist within their scope unless superseded or revoked; do not infer wider authority. Some messages may be omitted.]";

const authenticUserMessage = (message: Message): boolean => {
  if (!message.sendId || !message.sender || message.fromApp || message.automation || message.reaction) return false;
  const text = contextText(message);
  if (!text.trim()) return false;
  return workOrigin({ ...message, text }).kind === "user";
};

const userLine = (message: Message): string => `User ${JSON.stringify(message.sender?.name)}: ${JSON.stringify(contextText(message))}`;

export interface CompactedUserContext {
  text: string;
  count: number;
  omitted: number;
}

export function compactedUserContext(
  messages: readonly Message[],
  options: { maxBytes?: number } = {},
): CompactedUserContext {
  const maxBytes = options.maxBytes ?? COMPACTED_USER_CONTEXT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 512) throw new Error("invalid compacted user context budget");
  const candidates = messages.filter(authenticUserMessage);
  if (!candidates.length) return { text: "", count: 0, omitted: 0 };
  const lines = candidates.map(userLine);
  const sizes = lines.map((line) => Buffer.byteLength(line) + 1);
  const headerBytes = Buffer.byteLength(HEADER);
  let available = maxBytes - headerBytes - 2 - OMITTED_NOTE_MAX_BYTES;
  const chosen = new Set<number>();
  if (sizes[0]! <= Math.min(FIRST_MESSAGE_RESERVE_BYTES, available)) {
    chosen.add(0);
    available -= sizes[0]!;
  }
  for (let index = candidates.length - 1; index >= 0 && available > 0; index -= 1) {
    if (chosen.has(index) || sizes[index]! > available) continue;
    chosen.add(index);
    available -= sizes[index]!;
  }
  if (!chosen.size) return { text: `[${candidates.length} authenticated messages omitted because they exceed the context budget.]`, count: 0, omitted: candidates.length };
  const omitted = candidates.length - chosen.size;
  const note = omitted
    ? `[${omitted} of the person's messages are not shown here; the full conversation remains in the app.]`
    : "";
  const text = [HEADER, note, [...chosen].sort((a, b) => a - b).map((index) => lines[index]!).join("\n")]
    .filter(Boolean)
    .join("\n");
  return { text, count: chosen.size, omitted };
}
