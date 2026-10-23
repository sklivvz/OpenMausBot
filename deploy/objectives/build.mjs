import { build } from "esbuild";
await build({ entryPoints: [new URL("service.ts", import.meta.url).pathname], outfile: new URL("controller.mjs", import.meta.url).pathname, bundle: true, platform: "node", target: "node24", format: "esm" });
