import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync(new URL('../local/', import.meta.url), { recursive: true });
copyFileSync(new URL('./verifier.py', import.meta.url), new URL('../local/assembled-output-verify', import.meta.url));
