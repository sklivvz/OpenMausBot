import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const api = fixtureApi(fixture.info.url);
  await api("PUT", "/api/config", { profile: { name: "Table scroll fixture" } });
  const { bot } = await api("POST", "/api/bots", { name: "Table reviewer" });
  const reply = [
    "# Test report",
    ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i}: synthetic fixture context before the table.`),
    "| Row | Details |\n| --- | --- |\n" + Array.from({ length: 30 }, (_, i) =>
      `| ${i} | Synthetic row ${i}, enough content for a tall table with wrapped text. |`).join("\n"),
    "End of the synthetic report.",
  ].join("\n\n");
  const cli = join(fixture.info.dataDir, "table-claude.mjs");
  writeFileSync(cli, `#!/usr/bin/env node\nprocess.env.FAKE_CLAUDE_REPLIES=${JSON.stringify(JSON.stringify([reply]))};await import(${JSON.stringify(pathToFileURL(join(process.cwd(), "server/testing/fake-claude-cli.ts")).href)});`, { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli });
  await runControlOmb(["send", "--bot", bot.id, "--text", "Prepare the synthetic report.", "--url", fixture.info.url]);
  await runControlOmb(["wait", "--bot", bot.id, "--timeout", "30", "--url", fixture.info.url]);
  preview = await mountPreview(fixture, {
    entry: "/scripts/testing/threads-preview.tsx",
    route: "/__table-chat-scroll.html",
    title: "Isolated table chat scroll",
  });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl, botId: bot.id }));
  await parkUntilSignal();
} finally {
  await preview?.close();
  await fixture.close();
}
