import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['deploy/review-packet/*.test.ts'] } });
