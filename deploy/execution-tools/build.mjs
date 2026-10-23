import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
await build({ entryPoints: [path.join(here, 'main.ts')], outfile: process.argv[2] ?? path.resolve(here, '../local/execution-tools-mcp.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'error' });
