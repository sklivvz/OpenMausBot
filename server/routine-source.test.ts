import { describe, expect, it } from "vitest";

import { joinRoutineConversation, routineSourceOwner, sourceThreadOwner } from "./routine-source.ts";

const SCOUT = "scout-1";
const TEAMMATE = "teammate-1";

interface TestBot {
  id: string;
  name: string;
  section: string;
  threadId: string;
  hidden?: boolean;
}

interface TestTask {
  threadId: string;
  routineRunId?: string;
}

interface TestGroup {
  id: string;
  threadId: string;
  memberIds: string[];
}

const scout: TestBot = { id: SCOUT, name: "Scout", section: "Ops", threadId: "scout-main" };
const teammate: TestBot = { id: TEAMMATE, name: "Teammate", section: "Ops", threadId: "teammate-main" };

function fakeStore(bots: TestBot[], tasks: Record<string, TestTask[]> = {}, groups: TestGroup[] = []) {
  return {
    bot: (id: string) => bots.find((bot) => bot.id === id) ?? null,
    botByThread: (threadId: string) => bots.find((bot) => bot.threadId === threadId || tasks[bot.id]?.some((task) => task.threadId === threadId)) ?? null,
    taskByThread: (botId: string, threadId: string) => tasks[botId]?.find((task) => task.threadId === threadId) ?? null,
    groupByThread: (threadId: string) => groups.find((group) => group.threadId === threadId) ?? null,
  };
}

describe("a routine run's source conversation", () => {
  it("continues the distinct source, while reports still go to the results conversation", () => {
    const fixture = fakeStore([scout], { [SCOUT]: [{ threadId: "source-chat" }, { threadId: "results-chat" }] });
    const run = { target: "bot" as const, botId: SCOUT, sourceThreadId: "source-chat", resultsThreadId: "results-chat" };
    expect(joinRoutineConversation(run, fixture)).toBe("source-chat");
    expect(sourceThreadOwner(run, fixture)).toMatchObject({ threadId: "source-chat", bot: { id: SCOUT }, group: undefined });
    expect(routineSourceOwner(run, fixture)).toMatchObject({ threadId: "results-chat", bot: { id: SCOUT }, group: undefined });
  });

  it("refuses a missing, deleted or execution source without falling back to results", () => {
    const fixture = fakeStore([scout], { [SCOUT]: [{ threadId: "results-chat" }, { threadId: "execution", routineRunId: "run-old" }] });
    const run = (sourceThreadId?: string) => ({ target: "bot" as const, botId: SCOUT, sourceThreadId, resultsThreadId: "results-chat" });
    expect(joinRoutineConversation(run(), fixture)).toBeNull();
    expect(joinRoutineConversation(run("   "), fixture)).toBeNull();
    expect(joinRoutineConversation(run("deleted-chat"), fixture)).toBeNull();
    expect(joinRoutineConversation(run("execution"), fixture)).toBeNull();
    expect(routineSourceOwner(run(), fixture)?.threadId, "reporting still uses a live results conversation").toBe("results-chat");
  });

  it("refuses a room as the conversation to continue in, even when its bot is a member", () => {
    const group = { id: "room-1", threadId: "room-thread", memberIds: [SCOUT, TEAMMATE] };
    const fixture = fakeStore([scout, teammate], {}, [group]);
    const run = { target: "bot" as const, botId: SCOUT, sourceThreadId: "room-thread" };
    expect(sourceThreadOwner(run, fixture)).toMatchObject({ threadId: "room-thread", group: { id: "room-1" } });
    expect(joinRoutineConversation(run, fixture)).toBeNull();
  });

  it("refuses a source conversation owned by another bot, even when the source is valid for reporting", () => {
    const fixture = fakeStore([scout, teammate], { [TEAMMATE]: [{ threadId: "teammate-chat" }] });
    const run = { target: "bot" as const, botId: SCOUT, sourceThreadId: "teammate-chat" };
    expect(sourceThreadOwner(run, fixture)).toMatchObject({ threadId: "teammate-chat", bot: { id: TEAMMATE } });
    expect(joinRoutineConversation(run, fixture)).toBeNull();
  });
});
