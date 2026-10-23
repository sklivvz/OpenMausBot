import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";
import { Collector, health, report } from "./collector.ts";

async function main() {
  process.umask(0o077);
  const stateFile = join(process.env.OBSERVABILITY_STATE_DIR ?? "/state", "observations.db");
  const command = process.argv[2];
  if (command === "collect") {
    const collector = new Collector(process.env.OBSERVABILITY_SOURCE_DIR ?? "/source/.openmausbot", stateFile);
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    try {
      while (!controller.signal.aborted) {
        const result = collector.collect();
        if (!result.ok) console.error(JSON.stringify({ at: new Date().toISOString(), ...result }));
        const status = health(collector.state);
        const caughtUp = ["events.caughtUp", "assignments.caughtUp", "messages.caughtUp"].every(key => status[key] === true);
        await setTimeout(result.ok && !caughtUp ? 1000 : 15_000, undefined, { signal: controller.signal }).catch(() => {});
      }
    } finally { collector.close(); }
  } else if (command === "health" || command === "report") {
    const db = new DatabaseSync(stateFile, { readOnly: true });
    try {
      const flag = (name: string) => {
        const at = process.argv.indexOf(name);
        return at < 0 ? undefined : process.argv[at + 1];
      };
      const result = command === "health" ? health(db) : report(db, {
        rootId: flag("--root"), threadId: flag("--thread"), limit: Number(flag("--limit") ?? 50),
      });
      console.log(JSON.stringify(result, null, 2));
      if (command === "health" && !(result as { ok: boolean }).ok) process.exitCode = 1;
    } finally { db.close(); }
  } else {
    console.error("Usage: observer.cjs collect | health | report [--root ID | --thread ID] [--limit 1-500]");
    process.exitCode = 2;
  }
}

void main().catch(error => { console.error(error.message); process.exitCode = 1; });
