import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { composeMessage, fileAttachmentFromFile } from "../src/lib/composer-attachments.ts";

it("uploads a ZIP through the composer and downloads the exact bytes from its chat message", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, process.env.OMB_VERIFICATION_ENTRY);
  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
    originalFetch(typeof input === "string" && input.startsWith("/") ? fixture.info.url + input : input, init));
  try {
    const archive = new Uint8Array([80, 75, 5, 6, ...Array<number>(18).fill(0)]);
    const attachment = await fileAttachmentFromFile(new File([archive], "Assets.ZIP", { type: "application/x-zip-compressed" }));
    expect(attachment).toMatchObject({ kind: "file", name: "Assets.zip", size: archive.length });
    expect(readFileSync(attachment!.path)).toEqual(Buffer.from(archive));
    const response = await fetch(`${fixture.info.url}/api/bots`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "ZIP fixture" }),
    });
    const { bot } = await response.json() as { bot: { id: string; threadId: string } };
    const text = composeMessage("Keep this archive attached.", [attachment!]);
    await runControlOmb(["send", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--text", text]);
    await runControlOmb(["wait", "--url", fixture.info.url, "--bot", bot.id, "--task", bot.threadId, "--timeout", "30"]);
    const page = await (await fetch(`${fixture.info.url}/api/threads/${bot.threadId}/messages`)).json() as {
      messages: Array<{ id: string; role: string; text?: string }>;
    };
    const message = page.messages.find((entry) => entry.role === "user" && entry.text === text);
    expect(message).toBeDefined();
    const downloaded = await fetch(`${fixture.info.url}/api/threads/${bot.threadId}/messages/${message!.id}/file`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: attachment!.path }),
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("application/zip");
    expect(downloaded.headers.get("content-disposition")).toContain("Assets.zip");
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(Buffer.from(archive));
  } finally {
    fetchSpy.mockRestore();
    await fixture.close();
  }
}, 60_000);
