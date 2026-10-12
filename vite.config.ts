import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // three.js が大半を占めるため、分割せず単一チャンクで配布する
  build: { chunkSizeWarningLimit: 1000 },
});
