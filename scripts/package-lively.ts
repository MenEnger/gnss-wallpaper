/**
 * dist/ を Lively Wallpaper 用の .zip にまとめる（npm run build:lively から呼ばれる）。
 * zip を Lively のウィンドウにドラッグ＆ドロップすると、一時停止イベントとカスタマイズ画面が有効な状態で取り込まれる。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { toLivelyPropertiesJson } from '../src/host/livelyProperties.ts';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const outDir = join(root, 'release');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html がありません。先に vite build を実行してください。');
  process.exit(1);
}

const thumbnail = join(root, 'lively', 'thumbnail.jpg');
const info = {
  AppVersion: '1.0.0.0',
  Title: 'GNSS Orbit Viewer',
  Thumbnail: existsSync(thumbnail) ? 'thumbnail.jpg' : null,
  Preview: null,
  Desc: 'GPS・GLONASS・Galileo・BeiDou・QZSS の衛星を、公開軌道データから計算して 3D 地球とともにリアルタイム表示します。',
  Author: 'MarginalEngineer',
  License: null,
  Contact: 'https://github.com/MenEnger/gnss-wallpaper',
  Type: 1, // Web
  FileName: 'index.html',
  // 一時停止時に livelyWallpaperPlaybackChanged を呼ばせる
  Arguments: '--pause-event true',
  IsAbsolutePath: false,
  Id: null,
  Tags: ['GNSS', 'satellite', 'earth'],
  Version: 0,
};

const files: Record<string, Uint8Array> = {};
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(dist, p).replaceAll('\\', '/')] = readFileSync(p);
  }
};
walk(dist);
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v, null, 2));
files['LivelyInfo.json'] = json(info);
files['LivelyProperties.json'] = json(toLivelyPropertiesJson());
if (info.Thumbnail) files['thumbnail.jpg'] = readFileSync(thumbnail);

mkdirSync(outDir, { recursive: true });
const out = join(outDir, `gnss-orbit-viewer-lively-${pkg.version}.zip`);
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`${relative(root, out)} (${Object.keys(files).length} files)`);
