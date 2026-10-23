import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
for (const [entry, name] of [['template-preflight.mjs', 'newsletter-template-preflight'], ['template-prepare.mjs', 'newsletter-template-prepare']]) {
  await build({ entryPoints: [fileURLToPath(new URL(entry, import.meta.url))], outfile: fileURLToPath(new URL('../local/' + name, import.meta.url)), bundle: true, platform: 'node', format: 'esm' });
}
