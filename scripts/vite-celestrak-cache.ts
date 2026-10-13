/**
 * 開発サーバー専用: CelesTrak の GNSS データをディスクにキャッシュして中継する Vite プラグイン。
 *
 * 開発中はブラウザのキャッシュを消したり、まっさらなブラウザ（ヘッドレス撮影、Lively への取り込み直し）で
 * 何度も起動したりするため、そのまま CelesTrak に問い合わせると利用ポリシーの上限を簡単に超えてしまう。
 * ここで問い合わせを 2 時間に 1 回（失敗後も 1 時間に 1 回）に抑え、正常でない応答を受けたら
 * 人が .cache を消すまで二度と問い合わせない。
 *
 * - 環境変数 OMM_FIXTURE に OMM(JSON) ファイルのパスを指定すると、CelesTrak には一切問い合わせずそれを返す
 * - キャッシュ: .cache/celestrak-gnss.json（git 管理外）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const UPSTREAM = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json';
const ROUTE = '/dev-celestrak/gnss.json';
const FRESH_MS = 2 * 3600_000;
/** 応答が無かったときに次に問い合わせるまでの間隔（ポリシーの 1 時間に 1 回を守る） */
const RETRY_AFTER_FAILURE_MS = 3600_000;

interface DevCache {
  /** 最後に成功した取得の時刻と内容 */
  fetchedAt?: number;
  body?: string;
  /** 最後に問い合わせた時刻 */
  lastAttemptAt?: number;
  /** 正常でない応答で止めた理由（人が .cache を消すまで問い合わせない） */
  stopped?: string;
}

/** 応答はあったが正常でなかった（ステータス・リダイレクト・不正な本文）ことを表す */
class UpstreamRefused extends Error {}

export function celestrakDevCache(root: string): Plugin {
  const file = join(root, '.cache', 'celestrak-gnss.json');
  const read = (): DevCache => {
    if (!existsSync(file)) return {};
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as DevCache;
    } catch {
      // 壊れたキャッシュは問い合わせない側に倒す
      return { stopped: 'キャッシュファイルが壊れています' };
    }
  };
  const write = (c: DevCache) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(c));
  };
  let inFlight: Promise<void> | null = null;

  async function fetchUpstream(): Promise<void> {
    const c = read();
    if (c.stopped !== undefined) return;
    c.lastAttemptAt = Date.now();
    write(c);
    try {
      const res = await fetch(UPSTREAM, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (res.status !== 200) throw new UpstreamRefused(`HTTP ${res.status || 'リダイレクト'}`);
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new UpstreamRefused('JSON でない応答');
      }
      if (!Array.isArray(parsed) || parsed.length === 0) throw new UpstreamRefused('想定外のデータ');
      write({ ...c, fetchedAt: Date.now(), body: text });
      console.log('[celestrak-dev-cache] CelesTrak から取得しました');
    } catch (e) {
      if (e instanceof UpstreamRefused) {
        write({ ...c, stopped: e.message });
        console.warn(`[celestrak-dev-cache] CelesTrak が正常でない応答（${e.message}）を返しました。利用ポリシーに従い、${file} を消すまで問い合わせません。`);
      } else {
        console.warn(`[celestrak-dev-cache] CelesTrak に接続できません（${String(e)}）。1 時間は再試行しません。`);
      }
    }
  }

  return {
    name: 'celestrak-dev-cache',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(ROUTE, (_req, res) => {
        void (async () => {
          const fixture = process.env.OMM_FIXTURE;
          if (fixture) {
            res.setHeader('Content-Type', 'application/json');
            res.end(readFileSync(fixture, 'utf8'));
            return;
          }
          let c = read();
          const now = Date.now();
          const fresh = !!c.fetchedAt && now - c.fetchedAt < FRESH_MS;
          const recentlyTried = !!c.lastAttemptAt && now - c.lastAttemptAt < RETRY_AFTER_FAILURE_MS;
          if (!fresh && !recentlyTried && c.stopped === undefined) {
            inFlight ??= fetchUpstream().finally(() => (inFlight = null));
            await inFlight;
            c = read();
          }
          if (c.body) {
            // 古いキャッシュでも返す（開発用）
            res.setHeader('Content-Type', 'application/json');
            res.end(c.body);
          } else {
            res.statusCode = c.stopped !== undefined ? 503 : 504;
            res.end('celestrak-dev-cache: no data');
          }
        })().catch((e: unknown) => {
          console.error('[celestrak-dev-cache]', e);
          if (!res.headersSent) res.statusCode = 500;
          res.end('celestrak-dev-cache: error');
        });
      });
    },
  };
}
