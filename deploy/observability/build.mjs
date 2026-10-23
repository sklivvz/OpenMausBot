import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("./main.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("./observer.cjs", import.meta.url)),
  bundle: true, platform: "node", format: "cjs", target: "node24",
});
