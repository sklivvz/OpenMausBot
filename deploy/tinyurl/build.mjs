import { build } from 'esbuild';
import { chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outfile = fileURLToPath(new URL('../local/tinyurl-mcp.cjs', import.meta.url));
if (existsSync(outfile)) chmodSync(outfile, 0o755);
await build({
  entryPoints: [fileURLToPath(new URL('./main.mjs', import.meta.url))],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
chmodSync(outfile, 0o555);
