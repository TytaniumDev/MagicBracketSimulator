import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'child_process';
import path from 'path';

const commitHash = execSync('git rev-parse HEAD').toString().trim();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // Single-bundle output is intentional to avoid stale-chunk white screens
    // on deploy (see PR #157). Raise the advisory threshold so the warning
    // doesn't drown out future, genuinely-interesting chunk-size warnings.
    chunkSizeWarningLimit: 1000,
  },
});
