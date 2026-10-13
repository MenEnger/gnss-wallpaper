/**
 * README 用のデモ GIF（docs/demo.gif）を作る。
 * 開発サーバーを起動し、Edge をヘッドレスで操作して、シミュレーション時刻を一定量ずつ進めながら 1 コマずつ撮影する。
 * 実時間に依存しないため、PC の速さに関係なく同じ動きになる。
 *
 * 使い方: npm run record:gif [-- <OMM JSON ファイル>] （Microsoft Edge が必要）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
// @ts-expect-error 型定義なし（CommonJS のため default で読む）
import gifenc from 'gifenc';

const { GIFEncoder, applyPalette, quantize } = gifenc;

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 15;
const FRAMES = 90;
/** 1 コマあたりに進めるシミュレーション時間 [秒]（×1200 相当） */
const SIM_SECONDS_PER_FRAME = 1200 / FPS;
/** カメラの周回速度 [度/秒]（GIF の 6 秒間で約 30 度回す） */
const CAMERA_SPEED = 5;

const root = join(import.meta.dirname, '..');
const server = await createServer({ root, logLevel: 'error', server: { port: 5199 } });
await server.listen();
const url = server.resolvedUrls!.local[0];

const browser = await chromium.launch({ channel: 'msedge', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('page error:', e));
  page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
  // 引数で OMM(JSON) ファイルを渡すと、それをキャッシュとして使う（CelesTrak に繋がらないとき用）
  const ommFile = process.argv[2];
  if (ommFile) {
    const records = JSON.parse(readFileSync(ommFile, 'utf8'));
    await page.addInitScript(
      (cache) => localStorage.setItem('gnss-viewer.omm-cache.v1', JSON.stringify({ fetchedAt: Date.now(), records: cache })),
      records,
    );
  }
  await page.goto(`${url}?ui=0&lang=en&location=auto`);
  await page.waitForFunction(() => {
    const g = (window as any).__gnss;
    return g && g.engine.count > 0;
  });
  // 地表テクスチャの読み込みを待つ
  await page.waitForTimeout(4000);

  await page.evaluate(
    ({ cameraSpeed }) => {
      const w = window as any;
      // 通常の描画ループは実時間で動いてカメラが進んでしまうため止め、コマ送りだけで描く
      w.gnssViewer.setPaused(true);
      w.gnssViewer.setSettings({ timeScale: 1200, cameraSpeed, autoCamera: true });
      // 時計を止め、以後はコマ送りで手動で進める
      const clock = w.__gnss.clock;
      // 昼側がアジア〜オセアニアになる 03:30 UTC から始める（海ばかりの暗い絵になるのを避ける）
      const now = new Date();
      clock.baseSim = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 30);
      clock.baseReal = performance.now();
      clock.scale = 0;
      // 初期位置（昼側を斜めから見る）に戻す
      w.__gnss.view.placeCamera(w.gnssViewer.getSettings().cameraDistance, clock.now());
    },
    { cameraSpeed: CAMERA_SPEED },
  );

  const step = (simSeconds: number, dt: number) =>
    page.evaluate(
      async ({ simSeconds, dt }) => {
        const g = (window as any).__gnss;
        g.clock.baseSim += simSeconds * 1000;
        g.step(1, dt);
        // 軌道計算ワーカーの応答を待ってから描き直す
        await new Promise((r) => setTimeout(r, 30));
        g.step(1, 0);
      },
      { simSeconds, dt },
    );

  // 軌跡が揃うまで空回し
  for (let i = 0; i < 20; i++) await step(0, 0);

  const frames: Uint8Array[] = [];
  for (let i = 0; i < FRAMES; i++) {
    await step(SIM_SECONDS_PER_FRAME, 1 / FPS);
    const b64 = await page.evaluate(
      ({ w, h }) => {
        const src = (window as any).__gnss.view.renderer.domElement as HTMLCanvasElement;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let s = '';
        for (let j = 0; j < data.length; j += 0x8000) s += String.fromCharCode(...data.subarray(j, j + 0x8000));
        return btoa(s);
      },
      { w: WIDTH, h: HEIGHT },
    );
    frames.push(new Uint8Array(Buffer.from(b64, 'base64')));
    process.stdout.write(`\rframe ${i + 1}/${FRAMES}`);
  }
  process.stdout.write('\n');

  // 全コマ共通のパレット（コマごとの色のちらつきを防ぐ）
  const sample = new Uint8Array(WIDTH * HEIGHT * 4 * 4);
  [0, 30, 60, 89].forEach((f, k) => sample.set(frames[f], k * WIDTH * HEIGHT * 4));
  const palette = quantize(sample, 256);
  const gif = GIFEncoder();
  for (const f of frames) gif.writeFrame(applyPalette(f, palette), WIDTH, HEIGHT, { palette, delay: 1000 / FPS });
  gif.finish();

  mkdirSync(join(root, 'docs'), { recursive: true });
  const out = join(root, 'docs', 'demo.gif');
  writeFileSync(out, gif.bytes());
  console.log(`docs/demo.gif (${(gif.bytes().length / 1024 / 1024).toFixed(1)} MB)`);
} finally {
  await browser.close();
  await server.close();
}
