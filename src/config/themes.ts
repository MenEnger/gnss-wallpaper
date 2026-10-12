import type { ConstellationId } from '../data/constellations';
import type { ThemeId } from './settings';

/**
 * 見た目に関する値のみを持つ。衛星データ・描画構造はテーマ間で共通。
 * テクスチャは外部 CDN（three-globe のサンプル画像, NASA Blue Marble / Black Marble 由来）を既定とする。
 * 壁紙化などオフライン用途では public/ 配下に置いてパスを差し替える。
 */
export interface Theme {
  id: ThemeId;
  label: string;
  background: string;
  earth: {
    style: 'realistic' | 'technical';
    /** 昼面テクスチャ */
    dayMap: string;
    /** 夜面テクスチャ（街明かり） */
    nightMap?: string;
    /** 水域マスク（白 = 水） */
    waterMask?: string;
    /** 夜側の明るさ下限 */
    ambient: number;
    landColor?: string;
    oceanColor?: string;
    coastColor?: string;
    gridColor?: string;
  };
  colors: Record<ConstellationId, string>;
  /** マーカー直径 [CSS px] */
  markerSize: number;
  markerGlow: number;
  /** 軌跡の最大不透明度 */
  trailOpacity: number;
  /** 軌道全体表示の不透明度 */
  orbitOpacity: number;
  /** 線幅 [CSS px] */
  lineWidth: number;
  labelStyle: { font: string; color: string | null; shadow: string };
  showStars: boolean;
}

const IMG = 'https://unpkg.com/three-globe@2.31.0/example/img/';

export const THEMES: Record<ThemeId, Theme> = {
  realistic: {
    id: 'realistic',
    label: 'Realistic',
    background: '#000005',
    earth: {
      style: 'realistic',
      dayMap: `${IMG}earth-blue-marble.jpg`,
      nightMap: `${IMG}earth-night.jpg`,
      ambient: 0.02,
    },
    colors: {
      gps: '#8fb8ff',
      glonass: '#ff9a8a',
      galileo: '#a8e6a1',
      beidou: '#ffd27a',
      qzss: '#d9a8ff',
    },
    markerSize: 4.5,
    markerGlow: 0.35,
    trailOpacity: 0.45,
    orbitOpacity: 0.12,
    lineWidth: 1.2,
    labelStyle: { font: '500 11px system-ui, sans-serif', color: 'rgba(230,236,245,0.75)', shadow: 'rgba(0,0,0,0.9)' },
    showStars: true,
  },
  technical: {
    id: 'technical',
    label: 'Technical',
    background: '#05080d',
    earth: {
      style: 'technical',
      dayMap: `${IMG}earth-blue-marble.jpg`,
      waterMask: `${IMG}earth-water.png`,
      ambient: 0.55,
      landColor: '#1b2533',
      oceanColor: '#070b12',
      coastColor: '#4f7da8',
      gridColor: '#1d3550',
    },
    colors: {
      gps: '#3d8bff',
      glonass: '#ff4d5e',
      galileo: '#2ee59d',
      beidou: '#ffb020',
      qzss: '#c36bff',
    },
    markerSize: 6,
    markerGlow: 0.6,
    trailOpacity: 0.9,
    orbitOpacity: 0.2,
    lineWidth: 1.6,
    labelStyle: { font: '600 11px ui-monospace, Consolas, monospace', color: null, shadow: 'rgba(0,0,0,0.95)' },
    showStars: false,
  },
};
