/**
 * 気象pt（水面気象がコース有利をどう動かすか）の計算・解説用ユーティリティ。
 *
 * 気象pt は index CSV (`N枠_気象pt` / `N枠_寄与_気象pt`) の成分で、**preview 由来**である。
 * 朝バッチ (`state=daily`) では直前情報が無いため中立値 50 が入り寄与は 0 に潰されている。
 * 締切5分前の直前情報（`previews/sui`）が反映された `state=realtime` の行で初めて実測が入る。
 *
 * 値は 3 段階で決まる（BoatraceCSV `scripts/build_sui_params.py` /
 * `boatrace/index_features.py` / `build_index.py`、docs/data/estimate.md）:
 *
 *   1. 当日の水面気象から 6 つの特徴量を作る
 *      （波高 / 気温−水温 / 追い風 m/s / 向かい風 m/s / 曇り / 雨）
 *   2. 場ごとに学習した線形回帰の係数を **その艇の進入コース** の列で掛けて足すと、
 *      基準条件（凪・無風・晴・気温=水温）からの有利pt 変動 = 気象pt の生値になる。
 *      場内で標準化して偏差値スケールに直したものが 気象pt = 50 + 10 × z
 *   3. 寄与 = 場別重み w × 気象pt
 *
 * この 3 段階は **fun-site 側で再現できる**。入力になる静的テーブル 2 種
 * （`estimate/stadium/sui_params.csv` と
 * `estimate/stadium/weights/{predictor_id}/YYYY-MM.csv`）を batch が取り込み、
 * レース JSON の `weatherPtBasis` に焼き込んでいるためである
 * （2026-08-22 まではこの 2 つを取得しておらず「再計算できない」成分だった）。
 *
 * 係数の切片 `base_c{course}` は上流と同じく **使わない**。切片はコース固定の
 * 有利不利で 枠番pt (`waku-pt.ts`) とほぼ完全に重複し、重み学習時の多重共線性を
 * 避けるために気象pt の生値から外されている。
 *
 * このファイルが持つのは
 *
 *   - 当日の水面気象から回帰が見る特徴量を組み立てる {@link computeWeatherFeatures}
 *   - 係数を掛けて 生値 → 偏差値 → 寄与 を再現する {@link computeWeatherPtSteps}
 *   - 6 艇の気象pt を順位・進入コースと並べる {@link computeWeatherPtAggregate}
 *
 * の 3 つ。気象pt は選手ではなく **進入コース** に付く値なので、同じコースに
 * 入った艇なら誰でも同じ値になる。
 */

import type { WeatherFeatureKey, WeatherPtBasis } from "../types/stadium-table.js";
import { WEATHER_FEATURE_KEYS } from "../types/stadium-table.js";
import { competitionRanks, spearman } from "./ranking.js";

/**
 * 気象pt の偏差値スケール。BoatraceCSV 側が全成分共通で使う。
 * 平均 50 / 標準偏差 10 で、`z = (pt − 50) ÷ 10`。
 */
export const WEATHER_PT_SCALE = { mean: 50, sd: 10 } as const;

/**
 * `state=daily` の行に入る気象pt。直前情報を取る前の中立値で、
 * このとき寄与は 0 に潰されている（`COMPONENT_MISSING_FALLBACK_DEFAULT` と同値）。
 */
export const WEATHER_PT_DAILY_NEUTRAL = 50;

/** 気象pt の一次ソース。説明用 */
export const WEATHER_PT_SOURCES = {
  /** 当日の水面気象スナップショット（風速・風向・波高・天候・気温・水温） */
  preview: "previews/sui",
  /** 場別の線形回帰係数 */
  params: "estimate/stadium/sui_params.csv",
  /** 場別の μ / σ / w。偏差値変換と寄与に使う */
  weights: "estimate/stadium/weights/{predictor_id}/YYYY-MM.csv",
} as const;

/** 回帰が見る特徴量の一覧。表示用のラベルと説明 */
export const WEATHER_PT_FEATURES: readonly {
  readonly key: WeatherFeatureKey;
  readonly label: string;
  readonly description: string;
}[] = [
  { key: "waveCm", label: "波高", description: "1cm あたりの有利pt 変化" },
  { key: "tempDiffC", label: "気温−水温", description: "1℃ あたりの有利pt 変化" },
  { key: "windTailMs", label: "追い風", description: "追い風 1m/s あたりの有利pt 変化" },
  { key: "windHeadMs", label: "向かい風", description: "向かい風 1m/s あたりの有利pt 変化" },
  { key: "isCloudy", label: "曇り", description: "晴と比べた有利pt シフト" },
  { key: "isRainy", label: "雨", description: "晴と比べた有利pt シフト" },
];

/** 天候コード → 表示ラベル（boatrace 標準: 1晴 2曇 3雨 4雪 5霧） */
export const WEATHER_CODE_LABELS: Readonly<Record<string, string>> = {
  "1": "晴",
  "2": "曇り",
  "3": "雨",
  "4": "雪",
  "5": "霧",
};

/** 天候コード → 表示ラベル。未知のコードは生値のまま返す */
export const weatherCodeLabel = (code: string): string => WEATHER_CODE_LABELS[code] ?? code;

/**
 * 回帰が使う天候カテゴリ（晴 / 曇 / 雨）。雪・霧は雨に、コード 6・9 は晴に畳む。
 * BoatraceCSV `build_sui_params.py` の `WEATHER_CODE_TO_LABEL` と同期。
 */
export const weatherRegressionCategory = (code: string): "晴" | "曇" | "雨" => {
  switch (code.trim()) {
    case "2":
      return "曇";
    case "3":
    case "4":
    case "5":
      return "雨";
    default:
      // 1 / 6 / 9 / 未知コードは晴扱い
      return "晴";
  }
};

/**
 * 風向コード (1..8) → 方位角（度、0=北 / 90=東）。
 * BoatraceCSV `build_sui_params.py` の `WIND_CODE_TO_DEG` と同期。
 */
export const WIND_CODE_TO_DEG: Readonly<Record<number, number>> = {
  1: 0,
  2: 45,
  3: 90,
  4: 135,
  5: 180,
  6: 225,
  7: 270,
  8: 315,
};

/**
 * 場コード → スタンド方位（度）。この向きを基準に追い風 / 向かい風 / 横風を判定する。
 * BoatraceCSV `build_sui_params.py` の `STADIUM_FACING` と同期（場名 → 場コードに読み替え）。
 */
export const STADIUM_FACING_DEG: Readonly<Record<string, number>> = {
  "01": 90, // 桐生
  "02": 0, // 戸田
  "03": 200, // 江戸川
  "04": 270, // 平和島
  "05": 180, // 多摩川
  "06": 90, // 浜名湖
  "07": 90, // 蒲郡
  "08": 270, // 常滑
  "09": 90, // 津
  "10": 270, // 三国
  "11": 0, // びわこ
  "12": 0, // 住之江
  "13": 0, // 尼崎
  "14": 0, // 鳴門
  "15": 0, // 丸亀
  "16": 0, // 児島
  "17": 90, // 宮島
  "18": 0, // 徳山
  "19": 0, // 下関
  "20": 0, // 若松
  "21": 0, // 芦屋
  "22": 0, // 福岡
  "23": 0, // 唐津
  "24": 0, // 大村
};

/** スタンド方位に対する風の向き */
export type WindRelation = "tail" | "head" | "cross";

export const WIND_RELATION_LABELS: Readonly<Record<WindRelation, string>> = {
  tail: "追い風",
  head: "向かい風",
  cross: "横風",
};

/**
 * 風向コードと場から、スタンド方位に対する風の向きを判定する。
 * 相対角が ±45° 未満なら追い風、135〜225° なら向かい風、それ以外は横風。
 * 風向が空欄 / 未知コード、または場の方位が分からない場合は null。
 */
export const classifyWind = (
  windDirection: string | undefined,
  stadiumId: string,
): {
  readonly relation: WindRelation;
  readonly windDeg: number;
  readonly relativeDeg: number;
} | null => {
  const code = Number((windDirection ?? "").trim());
  if (!Number.isInteger(code)) return null;
  const windDeg = WIND_CODE_TO_DEG[code];
  const facingDeg = STADIUM_FACING_DEG[stadiumId];
  if (windDeg === undefined || facingDeg === undefined) return null;

  const relativeDeg = (((windDeg - facingDeg) % 360) + 360) % 360;
  const relation: WindRelation =
    relativeDeg < 45 || relativeDeg >= 315
      ? "tail"
      : relativeDeg >= 135 && relativeDeg < 225
        ? "head"
        : "cross";
  return { relation, windDeg, relativeDeg };
};

/** 気象pt の回帰が見る特徴量の値（係数を掛ける前の入力） */
export type WeatherFeatures = {
  /** 波高 (cm) */
  readonly waveCm: number;
  /** 気温 − 水温 (℃) */
  readonly tempDiffC: number;
  /** 追い風成分 (m/s)。向かい風 / 横風のときは 0 */
  readonly windTailMs: number;
  /** 向かい風成分 (m/s)。追い風 / 横風のときは 0 */
  readonly windHeadMs: number;
  /** 曇り（晴が基準） */
  readonly isCloudy: boolean;
  /** 雨（雪・霧を含む。晴が基準） */
  readonly isRainy: boolean;
  /** スタンド方位に対する風の向き。風向未取得 / 未知コードは null */
  readonly windRelation: WindRelation | null;
  /** 風向の方位角（度）。判定できない場合は null */
  readonly windDeg: number | null;
  /** この場のスタンド方位（度）。未知の場コードは null */
  readonly facingDeg: number | null;
};

/** `computeWeatherFeatures()` の入力（`RaceWeather` の必要な部分だけ） */
export type WeatherFeatureInput = {
  readonly weather: string;
  readonly windSpeed: number;
  /** 風向コード生値 (1..8)。古い JSON では未設定 */
  readonly windDirection?: string;
  readonly waveHeight: number;
  readonly airTemperature: number;
  readonly waterTemperature: number;
};

/**
 * 当日の水面気象から、気象pt の回帰が見ている特徴量を組み立てる。
 * ここに `weatherPtBasis` の係数を掛けたものが 気象pt の生値
 * （{@link computeWeatherPtSteps}）。
 *
 * 風向を取得できていない場合、上流は風向コードを 1（北）で埋めるのに対し
 * ここでは追い風 / 向かい風とも 0 に倒す（`windRelation` が null になる）。
 * その場合だけ再現値が index CSV と食い違いうる。
 */
export const computeWeatherFeatures = (
  weather: WeatherFeatureInput,
  stadiumId: string,
): WeatherFeatures => {
  const wind = classifyWind(weather.windDirection, stadiumId);
  const category = weatherRegressionCategory(weather.weather);
  return {
    waveCm: weather.waveHeight,
    tempDiffC: weather.airTemperature - weather.waterTemperature,
    windTailMs: wind?.relation === "tail" ? weather.windSpeed : 0,
    windHeadMs: wind?.relation === "head" ? weather.windSpeed : 0,
    isCloudy: category === "曇",
    isRainy: category === "雨",
    windRelation: wind?.relation ?? null,
    windDeg: wind?.windDeg ?? null,
    facingDeg: STADIUM_FACING_DEG[stadiumId] ?? null,
  };
};

/** 特徴量を回帰に渡る数値（bool は 0/1）に均した並び。係数と同じキー順 */
export const weatherFeatureValues = (
  features: WeatherFeatures,
): Readonly<Record<WeatherFeatureKey, number>> => ({
  waveCm: features.waveCm,
  tempDiffC: features.tempDiffC,
  windTailMs: features.windTailMs,
  windHeadMs: features.windHeadMs,
  isCloudy: features.isCloudy ? 1 : 0,
  isRainy: features.isRainy ? 1 : 0,
});

/** 生値 = Σ(特徴量 × 係数) の 1 項ぶん。画面はこの表で内訳を出す */
export type WeatherPtTerm = {
  readonly key: WeatherFeatureKey;
  /** 回帰に渡る特徴量の値（bool は 0/1） */
  readonly value: number;
  /** その場・そのコースの係数 */
  readonly coef: number;
  /** 値 × 係数。これを 6 項足すと生値になる */
  readonly term: number;
};

/** 気象pt の計算過程 1 艇ぶん。画面はこの順に「係数掛け → 偏差値 → 寄与」を出す */
export type WeatherPtSteps = {
  /** 係数を引いたコース（realtime は実進入コース、daily は枠番） */
  readonly course: number;
  /** 特徴量 × 係数 の 6 項 */
  readonly terms: readonly WeatherPtTerm[];
  /**
   * 生値 = 気象条件によるこのコースの有利pt 変動（Σ term を小数第 4 位に丸めたもの）。
   * 上流 `compute_features_for_day` が特徴量列に入れる時点で `round(v, 4)` する
   * ので、ここでも丸めてから偏差値に載せる（丸めないと 気象pt が最大 0.01 ずれる）。
   */
  readonly rawAdvantage: number;
  /** 場内 z 値 = (raw − μ) ÷ σ */
  readonly z: number;
  /** 気象pt = 50 + 10 × z */
  readonly pt: number;
  /** 寄与 = w × 気象pt */
  readonly contribution: number;
};

/**
 * `weatherPtBasis` と当日の特徴量・進入コースから 気象pt を再計算する。
 *
 * 上流 `weather_advantage()` + `build_index.py` と同じ式なので、index CSV の
 * `N枠_気象pt` と小数第 2 位まで一致する（上流は出力時に `round(x, 2)`）。
 * σ が 0 の場は上流と同じく z=0（= 偏差値 50）に倒す。コースが 1〜6 の外なら
 * undefined。
 *
 * ここで再現できるのは **`state=realtime` の行だけ**。daily の行は水面気象を
 * 取る前なので、上流が成分を中立値 50 に固定している（計算式の外）。
 */
export const computeWeatherPtSteps = (
  basis: WeatherPtBasis,
  features: WeatherFeatures,
  course: number,
): WeatherPtSteps | undefined => {
  if (!Number.isInteger(course) || course < 1 || course > 6) return undefined;

  const values = weatherFeatureValues(features);
  const terms: WeatherPtTerm[] = [];
  for (const key of WEATHER_FEATURE_KEYS) {
    const coef = basis.coefs[key][course - 1];
    if (coef === undefined) return undefined;
    const value = values[key];
    terms.push({ key, value, coef, term: value * coef });
  }

  // 上流は特徴量列に載せる時点で小数第 4 位に丸める (index_features.py の `kpt`)。
  // `x * 1e4` を挟むと浮動小数点誤差で境界がずれるので toFixed で丸める
  // （Python の round と同じく、二進表現そのものを最近接の 4 桁に丸める）。
  const rawAdvantage = Number(terms.reduce((sum, t) => sum + t.term, 0).toFixed(4));
  const z = basis.sigma > 0 ? (rawAdvantage - basis.mu) / basis.sigma : 0;
  const pt = WEATHER_PT_SCALE.mean + WEATHER_PT_SCALE.sd * z;
  return { course, terms, rawAdvantage, z, pt, contribution: basis.weight * pt };
};

/**
 * 再現値が index CSV の表示値と一致しているか（小数第 2 位まで）。
 *
 * 係数も重みも月次で動くので、過去日の再ビルドではずれうる。画面は一致した
 * ときだけ「表示値と一致」と出し、ずれたときは黙って両方を出す。
 */
export const weatherPtMatchesIndex = (
  computed: number | undefined,
  indexPt: number | undefined,
): boolean =>
  computed !== undefined && indexPt !== undefined && Math.abs(computed - indexPt) < 0.005;

/** 気象pt を並べる 1 艇ぶんの入力 */
export type WeatherPtInput = {
  readonly boatNumber: number;
  /** 進入コース (1-6)。stt 未取得のレースでは枠番と同じ仮値 */
  readonly courseNumber: number;
  /** 気象pt（偏差値）。index CSV 由来。古い JSON では undefined */
  readonly weatherPt: number | undefined;
};

/** 1 艇ぶんの集計 */
export type WeatherPtBoatAggregate = {
  readonly boatNumber: number;
  readonly courseNumber: number;
  /** 進入コースが枠番と違うか（前付け等でずれた艇） */
  readonly courseShifted: boolean;
  readonly weatherPt: number | undefined;
  /** `z = (pt − 50) ÷ 10`。pt が無い艇は null */
  readonly z: number | null;
  /** 気象pt の高い順の順位（1 が最上位）。同値は同順位 */
  readonly ptRank: number | null;
  /** 最上位艇との気象pt 差。最上位艇は 0 */
  readonly gapToTopPt: number | null;
};

/** レース 1 本ぶんの集計 */
export type WeatherPtAggregate = {
  /** 艇番昇順 */
  readonly boats: readonly WeatherPtBoatAggregate[];
  /** 気象pt が入っている艇数 */
  readonly ptCount: number;
  readonly topPt: number | null;
  readonly bottomPt: number | null;
  /** 最上位 − 最下位。ここが小さいレースは気象が着順を動かしていない */
  readonly ptSpread: number | null;
  /** 全艇が中立値 50（= daily、または欠測）か */
  readonly allNeutral: boolean;
  /**
   * 進入コースと気象pt の順位相関（スピアマン、タイは平均順位）。
   * **+1 = 内コースほど気象pt が高い**、−1 は外コースほど高い。
   * pt が揃った艇が 3 未満、または全艇同値のときは null。
   */
  readonly innerBias: number | null;
};

/**
 * 6 艇の気象pt を順位・進入コースと並べて集計する。
 *
 * 気象pt は **コース** に付く値（同じ水面気象なら同じコースの艇は同じ pt）なので、
 * 枠番ではなく進入コースと一緒に読む必要がある。`innerBias` は「この気象で内が
 * 有利に振れているのか外なのか」を 1 つの数字にしたもので、気象pt の内訳ではない。
 */
export const computeWeatherPtAggregate = (
  inputs: readonly WeatherPtInput[],
): WeatherPtAggregate => {
  const sorted = [...inputs].sort((a, b) => a.boatNumber - b.boatNumber);

  // 気象pt は「大きいほど上位」なので符号を反転して順位付けに載せる
  const ptRanks = competitionRanks(
    sorted.map((i) => (i.weatherPt === undefined ? null : -i.weatherPt)),
  );

  const pts = sorted
    .map((i) => i.weatherPt)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  const topPt = pts.length > 0 ? Math.max(...pts) : null;
  const bottomPt = pts.length > 0 ? Math.min(...pts) : null;

  const boats: WeatherPtBoatAggregate[] = sorted.map((input, i) => ({
    boatNumber: input.boatNumber,
    courseNumber: input.courseNumber,
    courseShifted: input.courseNumber !== input.boatNumber,
    weatherPt: input.weatherPt,
    z:
      input.weatherPt === undefined
        ? null
        : (input.weatherPt - WEATHER_PT_SCALE.mean) / WEATHER_PT_SCALE.sd,
    ptRank: ptRanks[i] ?? null,
    gapToTopPt: input.weatherPt !== undefined && topPt !== null ? input.weatherPt - topPt : null,
  }));

  // 進入コースと気象pt の相関。内コースほど pt が高いと rho は負になるので符号を反転し、
  // 「+1 = 内有利」に揃える。
  const paired = boats.filter(
    (b): b is WeatherPtBoatAggregate & { weatherPt: number } => b.weatherPt !== undefined,
  );
  const rho = spearman(
    paired.map((b) => b.courseNumber),
    paired.map((b) => b.weatherPt),
  );

  return {
    boats,
    ptCount: pts.length,
    topPt,
    bottomPt,
    ptSpread: topPt !== null && bottomPt !== null ? topPt - bottomPt : null,
    allNeutral: pts.length > 0 && pts.every((v) => v === WEATHER_PT_DAILY_NEUTRAL),
    innerBias: rho === null ? null : -rho,
  };
};
