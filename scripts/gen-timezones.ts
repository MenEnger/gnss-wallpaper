/**
 * IANA tz データベースの zone.tab と backward から「タイムゾーン名 → 代表地点の緯度経度」表を生成する。
 * tz データはパブリックドメイン。https://github.com/eggert/tz
 *
 * 使い方: node scripts/gen-timezones.ts <zone.tab> <backward>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [zoneTab, backward] = process.argv.slice(2);
if (!zoneTab || !backward) {
  console.error('usage: node scripts/gen-timezones.ts <zone.tab> <backward>');
  process.exit(1);
}

/** ISO 6709 形式（±DDMM[SS]±DDDMM[SS]）を度に変換 */
function parseCoord(s: string): [number, number] {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(s);
  if (!m) throw new Error(`bad coordinate: ${s}`);
  const deg = (sign: string, d: string, mm: string, ss = '0') => (sign === '-' ? -1 : 1) * (+d + +mm / 60 + +ss / 3600);
  return [deg(m[1], m[2], m[3], m[4]), deg(m[5], m[6], m[7], m[8])];
}

const table: Record<string, [number, number]> = {};
for (const line of readFileSync(zoneTab, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [, coord, name] = line.split('\t');
  const [lat, lon] = parseCoord(coord);
  table[name] = [Math.round(lat * 10) / 10, Math.round(lon * 10) / 10];
}
// 旧名（例: Asia/Calcutta, Japan）も引けるようにする
for (const line of readFileSync(backward, 'utf8').split('\n')) {
  const m = /^Link\s+(\S+)\s+(\S+)/.exec(line);
  if (m && table[m[1]] && !table[m[2]]) table[m[2]] = table[m[1]];
}

const body = Object.entries(table)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, [lat, lon]]) => `  '${k}': [${lat}, ${lon}],`)
  .join('\n');
const out = `// scripts/gen-timezones.ts で生成（IANA tz データベース, public domain）。手で編集しない。
export const TIMEZONE_COORDS: Record<string, [lat: number, lon: number]> = {
${body}
};
`;
writeFileSync(join(import.meta.dirname, '..', 'src', 'data', 'timezones.ts'), out);
console.log(`${Object.keys(table).length} zones`);
