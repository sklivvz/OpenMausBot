import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['deploy/marketing-classifier/work-kind.test.ts'], environment: 'node' } });
