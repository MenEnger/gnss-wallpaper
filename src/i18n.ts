/** 表示言語。既定は英語で、ブラウザ／OS の言語が日本語なら日本語にする。 */
export type Lang = 'en' | 'ja';
export type LanguageSetting = 'auto' | Lang;

const en = {
  'folder.view': 'Display',
  'folder.gnss': 'Constellations',
  'folder.location': 'Your location',
  'folder.camera': 'Camera',
  'folder.time': 'Time',
  'folder.data': 'Orbit data',
  'folder.other': 'Other',
  'folder.about': 'About',
  theme: 'Theme',
  labels: 'Labels',
  'labels.off': 'Hidden',
  'labels.id': 'ID',
  'labels.name': 'Name',
  orbitLines: 'Orbit lines',
  'orbit.trail': 'Recent trail',
  'orbit.full': 'Full orbit',
  'orbit.none': 'Hidden',
  trailMinutes: 'Trail length [min]',
  altitude: 'Satellite altitude',
  'altitude.real': 'Satellite altitude (true scale)',
  'altitude.scaled': 'Satellite altitude (scaled {pct}%)',
  'altitude.setReal': 'Use true scale (100%)',
  locationMode: 'Show',
  'location.off': 'Off',
  'location.auto': 'Auto (from time zone)',
  'location.manual': 'Manual',
  latitude: 'Latitude [°]',
  longitude: 'Longitude [°]',
  'location.source': 'Estimated from',
  autoCamera: 'Auto orbit',
  cameraSpeed: 'Orbit speed [°/s]',
  cameraDistance: 'Distance [Earth radii]',
  cameraResume: 'Resume after input [s]',
  timeScale: 'Time scale',
  'time.paused': 'Paused',
  'time.real': '×1 (real time)',
  'time.x60': '×60 (1 min/s)',
  'time.x600': '×600 (10 min/s)',
  'time.x3600': '×3600 (1 h/s)',
  resetTime: 'Back to current time',
  'data.state': 'Status',
  'data.fetched': 'Downloaded',
  'data.oldestEpoch': 'Oldest epoch',
  'data.refresh': 'Refresh now',
  'state.loading': 'Loading',
  'state.fresh': 'Up to date',
  'state.stale': 'Outdated',
  'state.error': 'Error',
  'status.loading': 'Loading orbit data…',
  'status.fresh': 'Using current orbit data',
  'status.staleFetch': 'Orbit data is out of date (downloaded {hours} h ago)',
  'status.staleEpochs': 'Most orbital elements are more than 3 days old',
  'status.cacheAfterError': 'Update failed; using cached data',
  'status.cacheAfterErrorDetail': 'Update failed; using cached data ({error})',
  'status.fetchError': 'Could not download orbit data ({error})',
  language: 'Language',
  'language.auto': 'Auto',
  maxFps: 'Max frame rate',
  'fps.unlimited': 'Unlimited',
  hideUi: 'Hide UI (toggle with H)',
  showUiTitle: 'Show settings (H)',
  'hud.simulated': ' (simulated)',
  'hud.paused': 'Paused',
  'hud.timeScale': 'Time ×{scale}',
  'hud.altitude': 'Altitude {pct}% (not to scale)',
  'about.credits':
    'Orbits: CelesTrak GP data (SGP4)<br>Earth imagery: NASA Blue Marble / Black Marble, via three-globe example images<br>Time zone locations: IANA tz database',
} as const;

export type MessageKey = keyof typeof en;

const ja: Record<MessageKey, string> = {
  'folder.view': '表示',
  'folder.gnss': '衛星群',
  'folder.location': '現在地',
  'folder.camera': 'カメラ',
  'folder.time': '時間',
  'folder.data': '軌道データ',
  'folder.other': 'その他',
  'folder.about': 'クレジット',
  theme: 'テーマ',
  labels: 'ラベル',
  'labels.off': '非表示',
  'labels.id': '識別子',
  'labels.name': '衛星名',
  orbitLines: '軌道線',
  'orbit.trail': '過去の軌跡',
  'orbit.full': '軌道全体',
  'orbit.none': '非表示',
  trailMinutes: '軌跡の長さ [分]',
  altitude: '衛星高度',
  'altitude.real': '衛星高度（実寸）',
  'altitude.scaled': '衛星高度（非実寸 {pct}%）',
  'altitude.setReal': '実寸（100%）にする',
  locationMode: '表示',
  'location.off': 'オフ',
  'location.auto': '自動（タイムゾーンから推定）',
  'location.manual': '手動',
  latitude: '緯度 [度]',
  longitude: '経度 [度]',
  'location.source': '推定元',
  autoCamera: '自動周回',
  cameraSpeed: '周回速度 [度/秒]',
  cameraDistance: '距離 [地球半径]',
  cameraResume: '操作後の復帰 [秒]',
  timeScale: '時間倍率',
  'time.paused': '停止',
  'time.real': '×1（実時間）',
  'time.x60': '×60（1分/秒）',
  'time.x600': '×600（10分/秒）',
  'time.x3600': '×3600（1時間/秒）',
  resetTime: '現在時刻に戻す',
  'data.state': '状態',
  'data.fetched': '取得時刻',
  'data.oldestEpoch': '最古エポック',
  'data.refresh': '今すぐ再取得',
  'state.loading': '読み込み中',
  'state.fresh': '最新',
  'state.stale': '古いデータ',
  'state.error': 'エラー',
  'status.loading': '軌道データを読み込み中…',
  'status.fresh': '最新の軌道データを使用中',
  'status.staleFetch': '軌道データが古くなっています（取得から {hours} 時間）',
  'status.staleEpochs': '多くの衛星の軌道要素エポックが 3 日以上前です',
  'status.cacheAfterError': '更新に失敗したためキャッシュを使用中',
  'status.cacheAfterErrorDetail': '更新に失敗したためキャッシュを使用中（{error}）',
  'status.fetchError': '軌道データを取得できません（{error}）',
  language: '言語',
  'language.auto': '自動',
  maxFps: '最大フレームレート',
  'fps.unlimited': '制限なし',
  hideUi: 'UI を隠す（H キーで切替）',
  showUiTitle: '設定を表示 (H)',
  'hud.simulated': '（シミュレーション）',
  'hud.paused': '停止中',
  'hud.timeScale': '時間 ×{scale}',
  'hud.altitude': '高度 {pct}%（非実寸）',
  'about.credits':
    '軌道: CelesTrak GP データ（SGP4 で計算）<br>地表画像: NASA Blue Marble / Black Marble（three-globe のサンプル画像経由）<br>タイムゾーンの位置: IANA tz データベース',
};

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, ja };

let current: Lang = 'en';

export function detectLang(): Lang {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith('ja')) ? 'ja' : 'en';
}

export function setLanguage(setting: LanguageSetting): Lang {
  current = setting === 'auto' ? detectLang() : setting;
  document.documentElement.lang = current;
  return current;
}

export function lang(): Lang {
  return current;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? en[key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** 軌道データの状態を表示文にする */
export function statusMessage(st: { code: string; params: Record<string, string | number> }): string {
  return t(`status.${st.code}` as MessageKey, st.params);
}
