import { defineConfig } from 'vite';
import { celestrakDevCache } from './scripts/vite-celestrak-cache.ts';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // 開発中の CelesTrak への問い合わせを 2 時間に 1 回に抑える（利用ポリシー対策）
  plugins: [celestrakDevCache(import.meta.dirname)],
  // three.js が大半を占めるため、分割せず単一チャンクで配布する
  build: { chunkSizeWarningLimit: 1000 },
});
