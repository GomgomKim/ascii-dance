import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The conversion core lives in ../src/core and is shared with the CLI.
const core = fileURLToPath(new URL('../src/core/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@core': core } },
  server: { fs: { allow: ['..'] } },
  // mediabunny (lazy-loaded encoder chunk) is ~570 kB; it is only fetched when exporting.
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
});
