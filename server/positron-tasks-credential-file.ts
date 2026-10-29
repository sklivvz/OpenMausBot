import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readPositronTasksCredential(botId: string | undefined, url: string, directory: string): string | undefined {
  if (!botId || !/^[a-zA-Z0-9_-]{1,100}$/.test(botId)) return undefined;
  let fd: number | undefined;
  try {
    fd = openSync(join(directory, `${botId}.json`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 16_384) return undefined;
    const credential: unknown = JSON.parse(readFileSync(fd, "utf8"));
    if (!credential || typeof credential !== "object") return undefined;
    const { botId: owner, url: destination, authorization } = credential as Record<string, unknown>;
    if (owner !== botId || typeof destination !== "string" || typeof authorization !== "string" || !/^Bearer \S{16,4096}$/.test(authorization)) return undefined;
    const expected = new URL(destination), endpoint = new URL(url);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || expected.href !== endpoint.href) return undefined;
    return authorization;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
