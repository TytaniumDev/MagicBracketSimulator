import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Exclude Playwright E2E tests — they're run via `npm run test:e2e`.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**'],
  },
}));
