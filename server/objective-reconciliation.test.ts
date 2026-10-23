import { expect, it } from "vitest";
import type { WireMessage } from "../shared/wire.ts";
import { reconcileObjectiveConversation } from "./objective-reconciliation.ts";

const source: WireMessage = { id: "objective", role: "user", kind: "text", text: "Own all accepted outcomes", at: 1, parentId: null, sendId: "original-request" };
const correction: WireMessage = { id: "correction", role: "user", kind: "text", text: "Defer one contribution; advance the others", at: 2, parentId: source.id, sendId: "human-correction" };
const terminal: WireMessage = { id: "terminal", role: "bot", kind: "text", text: "Changes applied", at: 3, parentId: correction.id, requestMessageId: correction.id, turnId: "turn", turnTerminal: true, turnSucceeded: true };
const anchor = { sendId: source.sendId, text: source.text, leafId: null };
const check = (messages: WireMessage[], task = {}) => reconcileObjectiveConversation(messages, messages.at(-1)!.id, anchor, task);

it("reconciles a settled human correction while retaining current holds", () => {
  expect(check([source, correction, terminal])).toMatchObject({ status: "ready", leafId: terminal.id, sourceMessageId: correction.id });
});
it("accepts a completed exact retry, but never substitutes an unrelated branch", () => {
  const retried = { ...source, id: "retry", sendId: "new-id" };
  expect(check([source, retried, { ...terminal, parentId: retried.id, requestMessageId: retried.id }]).status).toBe("ready");
  expect(check([source, { ...retried, text: "Different work" }, { ...terminal, parentId: retried.id, requestMessageId: retried.id }]).status).toBe("intervened");
});
it("keeps Stop, a rewind, active work and dependencies binding", () => {
  expect(check([{ ...source, requestCancelled: true }, correction, terminal]).status).toBe("stopped");
  expect(check([source, { ...correction, requestCancelled: true }, terminal]).status).toBe("stopped");
  for (const task of [{ busy: true }, { waitingForTeammates: true }]) expect(check([source, correction, terminal], task).status).toBe("waiting");
  expect(check([source, correction, terminal], { rewound: true }).status).toBe("intervened");
  const card: WireMessage = { ...terminal, id: "card", parentId: terminal.id, kind: "options", turnTerminal: undefined, card: { title: "Allow", subtitle: "Permission", requestType: "permission", requestId: "permission", options: [] } };
  expect(check([source, correction, terminal, card]).status).toBe("waiting");
});
it("requires successful runtime completion covering the latest human input", () => {
  expect(check([source, correction, { ...terminal, turnSucceeded: false }]).status).toBe("intervened");
  expect(check([source, correction, { ...terminal, requestMessageId: source.id }]).status).toBe("intervened");
  expect(check([source, correction, terminal, { ...correction, id: "later", parentId: terminal.id }]).status).toBe("intervened");
  expect(check([source, { ...terminal, parentId: source.id, requestMessageId: source.id }]).status).toBe("intervened");
  expect(check([source, { ...terminal, parentId: "missing" }]).status).toBe("intervened");
});
it("retains mid-turn steering under the proven originating request", () => {
  const steer = { ...correction, id: "steer", parentId: correction.id, steered: true };
  expect(check([source, correction, steer, { ...terminal, parentId: steer.id }]).status).toBe("ready");
});
