/**
 * 場別の静的テーブル（日付パーティションを持たない BoatraceCSV の CSV）の型。
 *
 * - `data/estimate/stadium/win_rate.csv` — 場 × 季節 × コース勝率。枠番pt の生値
 * - `data/estimate/stadium/weights/{predictor_id}/YYYY-MM.csv` — 場別の μ / σ / w
 *
 * 2 つ揃うと 枠番pt (`N枠_枠番pt`) と 寄与 (`N枠_寄与_枠番pt`) を fun-site 側で
 * **完全に再現** できる。計算式は {@link ../utils/waku-pt.js} を参照。
 */

/** win_rate.csv の季節軸。上流 `SEASON_BY_MONTH` と同じ 4 値 */
export const WAKU_SEASONS = ["春", "夏", "秋", "冬"] as const;

export type WakuSeason = (typeof WAKU_SEASONS)[number];

/** 1 場 × 1 季節ぶんの 6 コース勝率（`[1コース, ..., 6コース]`） */
export type CourseRates = readonly [number, number, number, number, number, number];

/**
 * win_rate.csv の 1 行。
 *
 * `rates` の値は **勝率 = 平均得点**（1着10点〜6着1点の平均。全コース平均は
 * 5 前後、イン有利な場の 1 コースで 8 前後）であって 1着率(%) ではない。
 */
export type WakuTableRow = {
  /** "01"〜"24" */
  readonly stadiumId: string;
  readonly season: WakuSeason;
  readonly rates: CourseRates;
};

/**
 * weights CSV の 1 行のうち、枠番pt の再現に必要な部分。
 *
 * `mu` / `sigma` は **その場の枠番pt 生値（= 勝率）の平均と標準偏差**で、
 * 偏差値変換に使う。`weight` は強さpt に足し込むときの成分重み。
 * 上流は場名（"桐生" 等）をキーにしているのでここでも場名で持つ。
 */
export type StadiumWakuWeightsRow = {
  readonly stadiumName: string;
  readonly mu: number;
  readonly sigma: number;
  readonly weight: number;
};

/**
 * 1 レースぶんの 枠番pt の根拠。`RacePrediction.wakuPtBasis` に載る。
 *
 * 上流の静的テーブルから当該レースに効く部分だけを切り出したもの。テーブルも
 * 重みも月次で更新されうるので、**ビルド時点の値をレース JSON に焼き込む**
 * （後日ビルドし直しても、その日の index CSV を作ったのと同じ値で検算できる）。
 */
export type WakuPtBasis = {
  /** μ / σ / w の由来予想者 ID。レース詳細の primary predictor と同じ */
  readonly predictorId: string;
  /** レース日から決まる季節。テーブルはこの行を引く */
  readonly season: WakuSeason;
  /** この場の 4 季節ぶんのコース勝率（比較表示用に季節をまたいで持つ） */
  readonly ratesBySeason: Readonly<Record<WakuSeason, CourseRates>>;
  /** その場の枠番pt 生値の平均 */
  readonly mu: number;
  /** その場の枠番pt 生値の標準偏差 */
  readonly sigma: number;
  /** 強さpt に足し込むときの枠番pt の重み（非負・全成分で合計 1） */
  readonly weight: number;
  /** 由来した weights ファイルの月 ("YYYY-MM")。学習窓はこの 6 ヶ月前〜前月 */
  readonly weightsMonth: string;
};
