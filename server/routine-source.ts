import { canReachPeer, type RosterMember } from "./peer-roster.ts";
import type { RoutineRun } from "./routines.ts";

interface SourceTask {
  threadId: string;
  routineRunId?: string;
}

interface SourceGroup {
  memberIds: readonly string[];
}

export interface RoutineSourceStore<Bot extends RosterMember, Group extends SourceGroup> {
  bot(id: string): Bot | null | undefined;
  botByThread(threadId: string): Bot | null | undefined;
  taskByThread(botId: string, threadId: string): SourceTask | null | undefined;
  groupByThread(threadId: string): Group | null | undefined;
}

export interface RoutineSourceOwner<Bot, Group> {
  bot: Bot;
  group: Group | undefined;
  threadId: string;
}

export function sourceThreadOwner<Bot extends RosterMember, Group extends SourceGroup>(
  run: Pick<RoutineRun, "botId" | "sourceThreadId">,
  store: RoutineSourceStore<Bot, Group>,
): RoutineSourceOwner<Bot, Group> | null {
  const threadId = run.sourceThreadId?.trim();
  if (!threadId) return null;
  // Validate before messagesFor(): Store lazily opens transcript storage, so an orphan id would recreate a deleted conversation.
  const bot = store.bot(run.botId);
  if (!bot) return null;
  // Stamped from the confirmed request, never calendar input; recheck sections, since either bot may have moved since.
  const sourceBot = store.botByThread(threadId);
  if (sourceBot && !sourceBot.hidden && !store.taskByThread(sourceBot.id, threadId)?.routineRunId &&
    (sourceBot.id === bot.id || canReachPeer(sourceBot, bot))) {
    return { bot: sourceBot, group: undefined, threadId };
  }
  const group = store.groupByThread(threadId);
  return group?.memberIds.includes(bot.id) ? { bot, group, threadId } : null;
}

export function joinRoutineConversation<Bot extends RosterMember, Group extends SourceGroup>(
  run: Pick<RoutineRun, "target" | "botId" | "sourceThreadId">,
  store: RoutineSourceStore<Bot, Group>,
): string | null {
  if (run.target !== "bot") return null;
  const source = sourceThreadOwner(run, store);
  return source && !source.group && source.bot.id === run.botId ? source.threadId : null;
}

export function routineSourceOwner<Bot extends RosterMember, Group extends SourceGroup>(
  run: Pick<RoutineRun, "botId" | "sourceThreadId" | "resultsThreadId">,
  store: RoutineSourceStore<Bot, Group>,
): RoutineSourceOwner<Bot, Group> | null {
  if (run.resultsThreadId) {
    const bot = store.bot(run.botId);
    const task = bot && store.taskByThread(bot.id, run.resultsThreadId);
    return bot && !bot.hidden && task && !task.routineRunId
      ? { bot, group: undefined, threadId: task.threadId }
      : null;
  }
  return sourceThreadOwner(run, store);
}
