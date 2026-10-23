import { build } from 'esbuild';
await build({ entryPoints: [new URL('./audit.ts', import.meta.url).pathname], outfile: new URL('../local/marketing-calendar-audit', import.meta.url).pathname, bundle: true, platform: 'node', format: 'cjs', banner: { js: '#!/usr/bin/env node' } });
