import { serve } from './stdio.mjs';
serve().catch(() => { process.exitCode = 1; });
