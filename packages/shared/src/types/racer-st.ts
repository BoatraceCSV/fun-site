/**
 * 選手別 推定ST (BoatraceCSV `data/estimate/racer_st/YYYY/MM/DD.csv` 由来)。
 *
 * スリット予想 (スタート予想図) と 1 マーク走行距離計算が、公表の全国平均ST に
 * 代えて使う「予測 ST」。実測 ST 履歴の時間減衰平均 (半減期 30 日) + 事前分布収縮 +
 * コース補正 + F 本数補正で算出される (boatracecsv 側 `scripts/boatrace/racer_st.py`、
 * 設計は boatracecsv `docs/design/st_estimation.md`)。
 */

/** 推定 ST - 1 枠分のエントリ */
export type RacerStEntry = {
  /** 枠番 (1-6) */
  readonly boatNumber: number;
  /** 選手登録番号。欠場等で空欄の枠は null */
  readonly registrationNumber: number | null;
  /** 推定 ST (秒、小数 4 桁)。空欄の枠は null */
  readonly estimatedST: number | null;
};

/** 推定 ST - 1 レース分 (racer_st CSV の 1 行) */
export type RacerStRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  /** 枠番昇順 6 エントリ */
  readonly entries: readonly RacerStEntry[];
};
