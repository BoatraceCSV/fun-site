/**
 * 場別の静的テーブル（日付パーティションを持たない BoatraceCSV の CSV）の型。
 *
 * - `data/estimate/stadium/win_rate.csv` — 場 × 季節 × コース勝率。枠番pt の生値
 * - `data/estimate/stadium/sui_params.csv` — 場 × 特徴量 × コースの気象回帰係数。
 *   気象pt の生値ソース
 * - `data/estimate/stadium/weights/{predictor_id}/YYYY-MM.csv` — 場別の μ / σ / w
 *
 * win_rate.csv + weights で 枠番pt (`N枠_枠番pt`) と 寄与 (`N枠_寄与_枠番pt`) を、
 * sui_params.csv + weights + 当日の水面気象で 気象pt (`N枠_気象pt`) と
 * 寄与 (`N枠_寄与_気象pt`) を fun-site 側で **完全に再現** できる。計算式は
 * {@link ../utils/waku-pt.js} / {@link ../utils/weather-pt.js} を参照。
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
 * weights CSV が持つ成分のうち、fun-site が生値から pt を再現している 2 つ。
 * CSV の列名サフィックス（`mu_waku` / `mu_weather` 等）と同じ綴り。
 */
export const STADIUM_WEIGHTS_COMPONENTS = ["waku", "weather"] as const;

export type StadiumWeightsComponent = (typeof STADIUM_WEIGHTS_COMPONENTS)[number];

/**
 * weights CSV の 1 行のうち、ある 1 成分の再現に必要な部分。
 *
 * `mu` / `sigma` は **その場のその成分の生値の平均と標準偏差**で、偏差値変換に使う
 * （枠番なら勝率、気象なら気象条件によるコース有利pt 変動）。`weight` は強さpt に
 * 足し込むときの成分重み。上流は場名（"桐生" 等）をキーにしているのでここでも
 * 場名で持つ。
 */
export type StadiumComponentWeightsRow = {
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

// === sui_params.csv (気象pt の生値ソース) ===

/**
 * 気象回帰が見る 6 特徴量のキー。上流 `index_features.py` の `PARAM_FEATURES`
 * （`wave_cm` / `temp_diff` / `wind_tail_ms` / `wind_head_ms` / `is_cloudy` /
 * `is_rainy`）と 1:1 で、CSV の列名は `{feature}_c{course}`。
 */
export const WEATHER_FEATURE_KEYS = [
  "waveCm",
  "tempDiffC",
  "windTailMs",
  "windHeadMs",
  "isCloudy",
  "isRainy",
] as const;

export type WeatherFeatureKey = (typeof WEATHER_FEATURE_KEYS)[number];

/** 1 特徴量ぶんの 6 コース係数（`[1コース, ..., 6コース]`） */
export type CourseCoefs = readonly [number, number, number, number, number, number];

/**
 * sui_params.csv の 1 行（1 場ぶんの気象回帰係数）。
 *
 * 上流は場名（"桐生" 等）をキーにしている。`base_c{course}` 切片は
 * **意図的に持たない** — 切片はコース固定の有利不利で 枠番pt とほぼ完全に重複する
 * ため、上流 `weather_advantage()` も切片を除いた「気象条件による相対変動」だけを
 * 気象pt の生値にしている。
 */
export type SuiParamsRow = {
  readonly stadiumName: string;
  readonly coefs: Readonly<Record<WeatherFeatureKey, CourseCoefs>>;
};

/**
 * 1 レースぶんの 気象pt の根拠。`RacePrediction.weatherPtBasis` に載る。
 *
 * 上流の静的テーブルから **その場のぶんだけ** を切り出したもの。係数も重みも
 * 月次で更新されうるので、枠番pt と同じく **ビルド時点の値をレース JSON に
 * 焼き込む**（後日ビルドし直しても、その日の index CSV を作ったのと同じ値で
 * 検算できる）。特徴量そのものはレース JSON の水面気象（`preview.weather`）から
 * 組み立てるのでここには持たない。
 */
export type WeatherPtBasis = {
  /** μ / σ / w の由来予想者 ID。レース詳細の primary predictor と同じ */
  readonly predictorId: string;
  /** この場の気象回帰係数（特徴量 × 6 コース） */
  readonly coefs: Readonly<Record<WeatherFeatureKey, CourseCoefs>>;
  /** その場の気象pt 生値（コース有利pt 変動）の平均。ほぼ 0 */
  readonly mu: number;
  /** その場の気象pt 生値の標準偏差 */
  readonly sigma: number;
  /** 強さpt に足し込むときの気象pt の重み（非負・全成分で合計 1） */
  readonly weight: number;
  /** 由来した weights ファイルの月 ("YYYY-MM")。学習窓はこの 6 ヶ月前〜前月 */
  readonly weightsMonth: string;
};
