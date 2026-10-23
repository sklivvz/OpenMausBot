import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['deploy/slop-detector/*.test.ts'] } });
