import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['server/job-view.test.ts', 'server/routes/jobs.test.ts'], environment: 'node' } });
