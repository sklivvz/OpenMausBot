import { build } from "esbuild";
import { chmodSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const outfile =
  process.argv[2] ??
  fileURLToPath(new URL("../local/threads-mcp.cjs", import.meta.url));
mkdirSync(path.dirname(outfile), { recursive: true });
if (existsSync(outfile)) chmodSync(outfile, 0o755);
await build({
  entryPoints: [fileURLToPath(new URL("./main.mjs", import.meta.url))],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
});
chmodSync(outfile, 0o555);
