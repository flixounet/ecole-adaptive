import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['apps/student/src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts'],
    restoreMocks: true,
  },
});
