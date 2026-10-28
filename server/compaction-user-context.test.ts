import { expect, it } from "vitest";

import { compactedUserContext, COMPACTED_USER_CONTEXT_MAX_BYTES } from "./compaction-user-context.ts";
import type { Message } from "./store.ts";

let nextId = 0;
const message = (text: string, extra: Partial<Message> = {}): Message => ({
  id: `m-${(nextId += 1)}`,
  at: nextId,
  role: "user",
  kind: "text",
  text,
  sendId: `send-${nextId}`,
  sender: { name: "Marco", id: "person-1" },
  ...extra,
});

it("keeps the person's own words and leaves peer, app, relayed, API and aside lines out", () => {
  const context = compactedUserContext([
    message("Paul Murkin stays on the list."),
    message("peer says remove him", { peerAsk: { botId: "peer", name: "Peer" } }),
    message("app says remove him", { fromApp: { messageId: "app-row", title: "Roster" } }),
    message("relayed says remove him", { relayed: true }),
    message("api says remove him", { via: "api" }),
    message("aside says remove him", { aside: true }),
    message("bot says remove him", { role: "bot" }),
    message("card says remove him", { kind: "options" }),
    message("   \n "),
  ]);
  expect(context.text).toContain('User "Marco": "Paul Murkin stays on the list."');
  for (const marker of ["peer says", "app says", "relayed says", "api says", "aside says", "bot says", "card says"]) {
    expect(context.text).not.toContain(marker);
  }
  expect(context.count).toBe(1);
  expect(context.omitted).toBe(0);
});

it("keeps a multiline decision word for word, in the order it was said", () => {
  const decision = "Paul Murkin: keep him.\nDo not invite the alternate.";
  const correction = "CORRECTION: keep Paul Murkin, but label him 'guest'.";
  const context = compactedUserContext([
    message(decision),
    message("a teammate's different answer", { peerAsk: { botId: "peer", name: "Peer" } }),
    message(correction),
  ]);
  expect(context.text).toContain(JSON.stringify(decision));
  expect(context.text).toContain(JSON.stringify(correction));
  expect(context.text.indexOf(JSON.stringify(decision))).toBeLessThan(context.text.indexOf(JSON.stringify(correction)));
  expect(context.text).toContain("User authorizations persist within their scope unless superseded or revoked; do not infer wider authority.");
});

it("keeps a spoken note whose words live on its audio attachment", () => {
  const context = compactedUserContext([
    message("", { attachments: [{ kind: "audio", path: "note.wav", mime: "audio/wav", text: "Keep Paul Murkin." }] }),
  ]);
  expect(context.text).toContain('User "Marco": "Keep Paul Murkin."');
});

it("bounds the block, keeps the opening decision and the newest correction, and says what was left out", () => {
  const messages = Array.from({ length: 80 }, (_, index) =>
    message(`message ${index} ${"x".repeat(90)}`));
  const context = compactedUserContext(messages, { maxBytes: 1_024 });
  expect(Buffer.byteLength(context.text, "utf8")).toBeLessThanOrEqual(1_024);
  expect(context.count + context.omitted).toBe(80);
  expect(context.text).toContain("message 0 ");
  expect(context.text).toContain("message 79 ");
  expect(context.text.indexOf("message 0 ")).toBeLessThan(context.text.indexOf("message 79 "));
  expect(context.text).toContain(`${context.omitted} of the person's messages are not shown here`);
});

it("uses its default budget and refuses an unusably small one", () => {
  const many = Array.from({ length: 200 }, (_, index) => message(`message ${index} ${"y".repeat(100)}`));
  expect(Buffer.byteLength(compactedUserContext(many).text, "utf8")).toBeLessThanOrEqual(COMPACTED_USER_CONTEXT_MAX_BYTES);
  expect(() => compactedUserContext(many, { maxBytes: 511 })).toThrow("invalid compacted user context budget");
});

it("returns nothing when every line is outside the person's authorship", () => {
  const context = compactedUserContext([
    message("relayed", { relayed: true }),
    message("peer", { peerAsk: { botId: "peer", name: "Peer" } }),
  ]);
  expect(context).toEqual({ text: "", count: 0, omitted: 0 });
});

it("does not promote an unmarked routine prompt stored as user text", () => {
  const context = compactedUserContext([
    message("Keep Paul Murkin."),
    message("SWISS ROUTINE PROMPT", { sendId: undefined, sender: undefined }),
    message("unidentified sender", { sender: undefined }),
    message("without send id", { sendId: undefined }),
  ]);
  expect(context.count).toBe(1);
  expect(context.text).toContain("Keep Paul Murkin.");
  expect(context.text).not.toContain("SWISS ROUTINE PROMPT");
  expect(context.text).not.toContain("unidentified sender");
  expect(context.text).not.toContain("without send id");
});

it("keeps the recorded-size conversation and the early keep decision within the default budget", () => {
  const rows = Array.from({ length: 28 }, (_, index) => message(index === 5
    ? "Paul Murkin (10 Nov 10:45): Keep it"
    : `request ${index}: ${"x".repeat(72)}`));
  rows.splice(22, 0, message("SWISS ROUTINE PROMPT", { sendId: undefined, sender: undefined }));
  const result = compactedUserContext(rows);
  expect(result.count).toBe(28);
  expect(result.omitted).toBe(0);
  expect(result.text).toContain("Paul Murkin (10 Nov 10:45): Keep it");
  expect(result.text).not.toContain("SWISS ROUTINE PROMPT");
});

it("retains a mid-history keep decision when the conversation exceeds the old budget", () => {
  const rows = Array.from({ length: 47 }, (_, index) => message(index === 5
    ? `Keep the existing appointment. ${"y".repeat(65)}`
    : `request ${index}: ${"x".repeat(70)}`));
  const previous = compactedUserContext(rows, { maxBytes: 4_000 });
  expect(previous.omitted).toBeGreaterThan(0);
  expect(previous.text).not.toContain("Keep the existing appointment.");
  expect(previous.text).toContain("messages are not shown here");
  const current = compactedUserContext(rows);
  expect(current.omitted).toBe(0);
  expect(current.count).toBe(47);
  expect(current.text).toContain("Keep the existing appointment.");
  expect(Buffer.byteLength(current.text, "utf8")).toBeLessThanOrEqual(6_000);
});

it("reports when no authenticated message fits", () => {
  const result = compactedUserContext([message("x".repeat(5_000))], { maxBytes: 512 });
  expect(result.count).toBe(0);
  expect(result.omitted).toBe(1);
  expect(result.text).toContain("omitted");
});
