import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const outfile = path.resolve(process.argv[2] ?? '.omb-scratch/execution-queue-mcp.cjs');
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('./main.ts', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'cjs' });
fs.chmodSync(outfile, 0o755);
