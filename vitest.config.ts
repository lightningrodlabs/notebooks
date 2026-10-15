import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['ui/src/**/*.test.ts'], environment: 'node' },
});
