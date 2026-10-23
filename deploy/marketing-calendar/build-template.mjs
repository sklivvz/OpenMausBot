import { copyFileSync } from 'node:fs';
copyFileSync(new URL('./template-preflight.mjs', import.meta.url), new URL('../local/newsletter-template-preflight', import.meta.url));
