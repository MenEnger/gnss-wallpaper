# GNSS Orbit Viewer

GNSS 衛星群（GPS / GLONASS / Galileo / BeiDou / QZSS）を 3D 地球とともにリアルタイム表示する Web アプリ。
要求仕様 v0.2 の初期実装（プロトタイプ）。

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ に静的ファイルを出力
```

## 操作

- ドラッグで回転、ホイールでズーム。操作後、設定した秒数で自動周回に戻る
- `H` キーで設定 UI の表示／非表示（非表示時は右上の ⚙ にカーソルを当てると出る）

## 構成

| ディレクトリ | 役割 |
| --- | --- |
| `src/data/` | CelesTrak からの OMM(JSON) 取得・キャッシュ・鮮度判定、衛星群の分類 |
| `src/orbit/` | SGP4 計算（Web Worker）、時刻格子での標本管理と補間、シミュレーション時計、太陽方向・GMST |
| `src/render/` | three.js による描画（地球・マーカー・軌跡・ラベル・カメラ）。計算は持たない |
| `src/config/` | 設定（`settings.ts`）とビジュアルテーマ（`themes.ts`）。衛星データとは独立 |
| `src/ui/` | 設定オーバーレイ（lil-gui）と状態表示 |
| `src/host/` | 壁紙ホスト向けの公開 API |

### 座標と高度倍率

- 描画は慣性系（TEME ≒ ECI）。軌道面は固定され、地球が GMST に従って自転する
- 描画単位は地球赤道半径。衛星の描画半径 = `Re + (r − Re) × 高度倍率`（地球の大きさは不変、点と軌道線に同じ倍率）
- 内部の位置（km）は倍率を掛けずに保持している

### 軌道データ

- `https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json` を取得し、`OBJECT_NAME` で衛星群を分類（SBAS・NavIC は除外）
- `localStorage` にキャッシュ。CelesTrak の更新間隔に合わせ、2 時間以内は再取得しない
- 取得から 24 時間以上経過、過半数のエポックが 3 日以上前、または取得失敗でキャッシュ利用中の場合は「古いデータ」として通知

### 地表テクスチャ

既定では three-globe のサンプル画像（NASA Blue Marble / Black Marble 由来）を unpkg から読み込む。
オフラインで使う場合（壁紙化など）は画像を `public/` に置き、`src/config/themes.ts` のパスを差し替える。

## 外部からの制御（壁紙ホスト向け）

URL クエリ:

```
?theme=technical&labels=id&orbit=full&trail=90&alt=1&speed=60&autocam=0&camspeed=2&camdist=14&ui=0&fps=30&gnss=gps,galileo
```

JavaScript / postMessage:

```js
window.gnssViewer.setSettings({ theme: 'technical', altitudeScale: 1 });
window.gnssViewer.setPaused(true);           // ホスト側で不可視になったとき描画停止
window.gnssViewer.onStatus((s) => console.log(s.state, s.message));

window.postMessage({ type: 'gnss-viewer:settings', settings: { labelMode: 'id' } });
window.postMessage({ type: 'gnss-viewer:paused', paused: true });
```

ブラウザのタブが非表示の間は `requestAnimationFrame` が止まるため描画しない。`maxFps` でフレームレートの上限も設定できる。

## 初期値（プロトタイプでの暫定値）

| 項目 | 値 |
| --- | --- |
| 衛星高度倍率 | 50% |
| 軌跡の長さ | 120 分 |
| カメラ距離 | 12 地球半径（縦長画面では自動的に引く） |
| 自動周回速度 | 1.2 度/秒、仰角 18 度 ± 12 度をゆっくり揺らす |
| 手動操作後の復帰 | 8 秒 |

仕様 9 章の検証項目（倍率・軌跡・カメラ・テーマ表現・ラベル密度）は、実機での見栄え確認を経て調整する。
