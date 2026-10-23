import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const outfile = fileURLToPath(new URL('../local/review-packet-mcp.cjs', import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL('./main.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'cjs' });
fs.chmodSync(outfile, 0o755);
