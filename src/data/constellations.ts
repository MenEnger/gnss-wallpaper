export const CONSTELLATION_IDS = ['gps', 'glonass', 'galileo', 'beidou', 'qzss'] as const;
export type ConstellationId = (typeof CONSTELLATION_IDS)[number];

export const CONSTELLATION_NAMES: Record<ConstellationId, string> = {
  gps: 'GPS',
  glonass: 'GLONASS',
  galileo: 'Galileo',
  beidou: 'BeiDou',
  qzss: 'QZSS',
};

/**
 * CelesTrak の GNSS グループには SBAS・NavIC なども含まれるため、
 * OBJECT_NAME の命名規則で対象の衛星群に分類する。対象外は null。
 */
export function classify(objectName: string): ConstellationId | null {
  const n = objectName.toUpperCase();
  if (/QZS/.test(n)) return 'qzss';
  if (/^GPS\b|NAVSTAR/.test(n)) return 'gps';
  if (/^COSMOS\b|GLONASS/.test(n)) return 'glonass';
  if (/^GSAT0\d{3}|GALILEO/.test(n)) return 'galileo';
  if (/^BEIDOU/.test(n)) return 'beidou';
  return null;
}

/** ラベル用の短い識別子（例: G22, C19, QZS-2） */
export function shortId(objectName: string, c: ConstellationId): string {
  const n = objectName.toUpperCase();
  switch (c) {
    case 'gps': {
      const m = /PRN\s*(\d+)/.exec(n);
      return m ? `G${m[1].padStart(2, '0')}` : n;
    }
    case 'beidou': {
      const m = /\((C\d+)\)/.exec(n);
      return m ? m[1] : n;
    }
    case 'glonass': {
      const m = /\((\d+K?)\)/.exec(n);
      return m ? `R-${m[1]}` : n;
    }
    case 'galileo': {
      const m = /^(GSAT\d+)/.exec(n);
      return m ? m[1] : n;
    }
    case 'qzss': {
      const m = /^(QZS-\w+)/.exec(n);
      return m ? m[1] : n;
    }
  }
}
