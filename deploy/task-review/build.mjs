import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const outfile = fileURLToPath(new URL('../local/work-review-mcp.cjs', import.meta.url));
if (fs.existsSync(outfile)) fs.chmodSync(outfile, 0o755);

await build({
  entryPoints: [fileURLToPath(new URL('./main.ts', import.meta.url))],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
fs.chmodSync(outfile, 0o755);
