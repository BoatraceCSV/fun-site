import { predictorById } from "../predictors.js";
import type { AiEvaluation, RaceRacer } from "../types/prediction.js";

/**
 * 全国平均ST が 0.00(公表実績なし。新人・長期離脱明け等)の艇に適用する
 * フォールバック ST(秒)。実績なし艇を「最速スタート扱い」しないための遅め設定。
 *
 * スタート予想図の描画(`StartPredictionDiagram`)と 1 マーク走行距離計算
 * (`computeOneMarkDistances`)の両方がこの定数を共有する。
 * 検討の経緯は boatracecsv リポジトリの `docs/design/st_estimation.md`(H6)を参照。
 */
export const NO_RECORD_ST_FALLBACK = 0.25;

/**
 * 予測に使う実効平均ST を返す。全国平均ST が 0.00(実績なし)または未定義の
 * 場合は `NO_RECORD_ST_FALLBACK` に置き換える。
 */
export const effectiveAvgST = (nationalAvgST: number | undefined): number =>
  !nationalAvgST ? NO_RECORD_ST_FALLBACK : nationalAvgST;

/**
 * 予測 ST を返す。AI 推定 ST(estimate/racer_st 由来、実測 ST 履歴ベース)が
 * あればそれを優先し、無ければ全国平均 ST(0.00 は `NO_RECORD_ST_FALLBACK`
 * 補完)にフォールバックする。**AI 推定 ST を採用する予想者 (v5_slit)** の
 * スタート予想図と 1 マーク走行距離計算の共通ロジック。
 */
export const predictedST = (racer: Pick<RaceRacer, "estimatedST" | "nationalAvgST">): number =>
  racer.estimatedST ?? effectiveAvgST(racer.nationalAvgST);

/** 1艇分の走行距離計算結果 */
export type OneMarkDistanceEntry = {
  readonly boatNumber: number;
  /**
   * 計算に使った予測 ST。AI 推定 ST があればその値、無ければ実効平均 ST
   * (実績なしは `NO_RECORD_ST_FALLBACK` 補完後の値)。
   */
  readonly avgST: number;
  readonly strengthPt: number;
  /** 走行距離 = (1 - 予測ST) + 強さpt / 50 - 1.6 */
  readonly distance: number;
};

/** `computeOneMarkDistances` のオプション。 */
export type OneMarkDistanceOptions = {
  /**
   * true なら予測 ST に AI 推定 ST (`RaceRacer.estimatedST`) を優先して使う
   * (`predictedST`)。false / 未指定なら従来どおり全国平均 ST (`effectiveAvgST`)。
   * 予想者の `PredictorSpec.useEstimatedST` を渡す (現状 v5_slit のみ true)。
   */
  readonly useEstimatedST?: boolean;
};

/**
 * 1マーク予想の走行距離を全艇分計算する。
 * distance = (1 - 予測ST) + 強さpt / 50 - 1.6
 *
 * 予測 ST は既定で全国平均 ST。`options.useEstimatedST` が true の予想者
 * (v5_slit) のみ AI 推定 ST(estimate/racer_st)を優先する(`predictedST`)。
 * 全国平均 ST = 0.00(実績なし)の艇は `NO_RECORD_ST_FALLBACK`(0.25)で
 * 補完する。補完しないと 0.00 = 最速スタート扱いとなり、実績なし艇の距離が
 * 過大評価される(スタート予想図の描画側フォールバックと同じ値に統一)。
 */
export const computeOneMarkDistances = (
  racers: readonly RaceRacer[],
  aiEvaluation: AiEvaluation,
  options?: OneMarkDistanceOptions,
): readonly OneMarkDistanceEntry[] => {
  const aiByBoat = new Map(aiEvaluation.entries.map((e) => [e.boatNumber, e]));
  return racers.map((racer) => {
    const ai = aiByBoat.get(racer.boatNumber);
    const avgST = options?.useEstimatedST
      ? predictedST(racer)
      : effectiveAvgST(racer.nationalAvgST);
    const strengthPt = ai?.strengthPt ?? 0;
    const distance = 1 - avgST + strengthPt / 50 - 1.6;
    return { boatNumber: racer.boatNumber, avgST, strengthPt, distance };
  });
};

/**
 * 予想者 ID から 1 マーク走行距離計算のオプションを解決する。
 * レジストリ (`predictors.ts`) の `PredictorSpec.useEstimatedST` が唯一の
 * 情報源で、未登録 ID / 未指定なら既定（全国平均 ST）になる。
 *
 * `bettingToleranceFor` と対になるヘルパー。バッチ（回収率の集計対象になる
 * 買い目）と web（画面に表示する買い目）が **同じ距離計算になることを保証**
 * するために両方からこれを呼ぶ。片側だけが `useEstimatedST` を渡していると、
 * v5_slit / v7_aggregate のように AI 推定 ST を使う予想者で「表示された買い目」
 * と「的中・回収率の集計対象になった買い目」が食い違う。
 */
export const oneMarkDistanceOptionsFor = (predictorId?: string): OneMarkDistanceOptions => ({
  useEstimatedST: predictorId ? predictorById(predictorId)?.useEstimatedST === true : false,
});

/**
 * 買い目（フォーメーション） - 各着順の候補艇番リスト。
 * いずれも艇番昇順。各着のしきい値窓から、有効な出目（1-2-3 着が相異なる
 * 組合せ）に 1 つも使われないデッド候補を除いたもの（`computeBettingPicks`）。
 * 選定値は既定で 1 マーク走行距離、`basis="strength"` の予想者 (v8_aionly)
 * では強さpt。
 */
export type FormationPicks = {
  readonly kind: "formation";
  /** 1着候補: 選定値が最大の艇の値 ± `tolerance.first` 以内 */
  readonly first: readonly number[];
  /** 2着候補: 選定値降順で2位の艇の値 ± `tolerance.second` 以内 */
  readonly second: readonly number[];
  /** 3着候補: 選定値降順で3位の艇の値 ± `tolerance.third` 以内 */
  readonly third: readonly number[];
};

/** 三連単の 1 点 (1着艇, 2着艇, 3着艇)。 */
export type BetCombo = readonly [number, number, number];

/**
 * 買い目（出目リスト）- 個別の三連単出目をそのまま列挙したもの。
 *
 * スジ予想 (`v9_suji`) のようにフォーメーションで表現できない買い目のための形。
 * 例: `3-1-5` / `3-4-5` / `3-5-2` はどんな候補窓の直積でも作れない。
 * boatracecsv の `data/estimate/suji/YYYY/MM/DD.csv` から読んだ出目をそのまま持つ。
 */
export type ComboPicks = {
  readonly kind: "combos";
  /** 買う出目。重複・同一艇の重複使用は含めない前提（生成側で保証する） */
  readonly combos: readonly BetCombo[];
};

/**
 * 買い目。フォーメーション（既存の全予想者）か出目リスト（`v9_suji`）のいずれか。
 * `kind` で判別する。
 */
export type BettingPicks = FormationPicks | ComboPicks;

/**
 * 買い目の着順別しきい値（±許容幅）。
 * 各着候補は「基準艇の距離 ± 当該しきい値」以内の艇で構成する。
 */
export type BettingTolerance = {
  /** 1着候補のしきい値 */
  readonly first: number;
  /** 2着候補のしきい値 */
  readonly second: number;
  /** 3着候補のしきい値 */
  readonly third: number;
};

/** 既定のしきい値（経験則の ±0.10。全着順共通）。 */
export const DEFAULT_BETTING_TOLERANCE: BettingTolerance = {
  first: 0.1,
  second: 0.1,
  third: 0.1,
};

/**
 * 買い目候補の選定基準。
 * - `"distance"`: 1 マーク走行距離 (予測 ST + 強さpt/50) 基準（既定）。
 * - `"strength"`: 強さpt のみ基準（v8_aionly。予測 ST は買い目に影響しない）。
 */
export type BettingBasis = "distance" | "strength";

/**
 * 強さpt 基準 (`basis="strength"`) のしきい値（±5.0pt。全着順共通）。
 * 距離式は強さpt/50 を項に持つので、距離 ±0.10 と等価スケール
 * (0.10 × 50 = 5.0)。距離基準から ST 項だけを外した窓になる。
 */
export const STRENGTH_BETTING_TOLERANCE: BettingTolerance = {
  first: 5.0,
  second: 5.0,
  third: 5.0,
};

/**
 * 予想者 ID から買い目候補の選定基準を解決する。レジストリ
 * (`predictors.ts`) の `PredictorSpec.strengthOnlyBetting` が唯一の情報源で、
 * 未登録 ID / 未指定なら既定の走行距離基準になる。
 *
 * `bettingToleranceFor` / `oneMarkDistanceOptionsFor` と対になるヘルパー。
 * バッチ（回収率の集計対象になる買い目）と web（画面に表示する買い目）が
 * **同じ選定基準になることを保証**するために両方からこれを呼ぶ。
 */
export const bettingBasisFor = (predictorId?: string): BettingBasis =>
  predictorId && predictorById(predictorId)?.strengthOnlyBetting === true ? "strength" : "distance";

/**
 * 買い目の作り方を予想者 ID から解決する。レジストリ (`predictors.ts`) の
 * `PredictorSpec.bettingStyle` が唯一の情報源で、未登録 ID / 未指定なら
 * 既定の `"formation"`(fun-site 側でフォーメーションを計算)になる。
 *
 * `"suji"` の予想者 (`v9_suji`) は fun-site では買い目を **計算しない**。
 * boatracecsv が `data/estimate/suji/YYYY/MM/DD.csv` に確定させた出目を読む。
 *
 * `bettingBasisFor` / `bettingToleranceFor` / `oneMarkDistanceOptionsFor` と
 * 対になるヘルパー。バッチ(回収率の集計対象になる買い目)と web(画面に表示する
 * 買い目)が **同じ買い目になることを保証**するために両方からこれを呼ぶ。
 */
export const bettingStyleFor = (predictorId?: string): "formation" | "suji" | "kimarite" => {
  const style = predictorId ? predictorById(predictorId)?.bettingStyle : undefined;
  return style === "suji" || style === "kimarite" ? style : "formation";
};

/**
 * 予想者 ID ごとのしきい値オーバーライド。未登録の予想者は
 * `DEFAULT_BETTING_TOLERANCE`（±0.10）を使う。
 *
 * 現在オーバーライドは無し（全予想者が ±0.10）。
 * 以前は `v2_tenkai`（現 モーター評価変更予想）に `1着0.02 / 2着0.10 / 3着0.20` を設定していたが、
 * 展開予想の撤去に伴い同予想者を本命予想（control）と同一 recipe に揃えるため
 * 2026-06-13 に削除した。予想者別に再最適化する場合はここへ追記する
 * （`notebooks/threshold_optimization.ipynb`）。
 */
export const BETTING_TOLERANCE_BY_PREDICTOR: Readonly<Record<string, BettingTolerance>> = {};

/**
 * 予想者 ID に対応するしきい値を返す。強さpt 基準の予想者
 * (`strengthOnlyBetting`) は `STRENGTH_BETTING_TOLERANCE`（±5.0pt）、
 * それ以外はオーバーライド → 既定値（±0.10）の順に解決する。
 */
export const bettingToleranceFor = (predictorId?: string): BettingTolerance => {
  if (bettingBasisFor(predictorId) === "strength") return STRENGTH_BETTING_TOLERANCE;
  return (predictorId && BETTING_TOLERANCE_BY_PREDICTOR[predictorId]) || DEFAULT_BETTING_TOLERANCE;
};

/**
 * 走行距離から買い目（三連単フォーメーションの候補）を導出する。
 * - 1着候補: 距離が最大の艇の距離 ± `tolerance.first` 以内
 * - 2着候補: 距離降順で2番目の艇の距離 ± `tolerance.second` 以内
 * - 3着候補: 距離降順で3番目の艇の距離 ± `tolerance.third` 以内
 *
 * 各着のしきい値窓を独立に取った後、**有効な三連単フォーメーション
 * （1-2-3 着で同一艇を使わない出目）に 1 つも登場しない艇を各着候補から
 * 除外する**。これにより、しきい値が着順別（例: 1着0.02 / 3着0.20 のように
 * 1着を絞り 3着を広げる設定）のとき、1着の本命艇が窓の広い 3着候補に重複
 * 表示される不具合を解消する。
 *
 * 除外するのは「どの有効出目にも使えないデッド候補」のみなので、買える
 * 組合せの集合は変わらず、`countBetCombinations` /
 * `isBetHit`（組合せ数・的中・回収率）の結果は不変。1着候補が
 * 複数艇ある場合、その艇は別の艇が 1着になる出目で下位着に使えるため
 * 残る。
 *
 * 各候補リストは艇番昇順。`tolerance` 省略時は
 * `DEFAULT_BETTING_TOLERANCE`（±0.10）。予想者ごとに変える場合は
 * `bettingToleranceFor(predictorId)` を渡す。
 *
 * `basis` 省略時は従来どおり走行距離基準。`"strength"` を渡すと各艇の
 * 強さpt を選定値に使う（v8_aionly。しきい値は `STRENGTH_BETTING_TOLERANCE`
 * とセットで渡すこと。予想者 ID からの解決は `bettingBasisFor`）。
 */
export const computeBettingPicks = (
  entries: readonly OneMarkDistanceEntry[],
  tolerance: BettingTolerance = DEFAULT_BETTING_TOLERANCE,
  basis: BettingBasis = "distance",
): FormationPicks => {
  const pickValue = (e: OneMarkDistanceEntry): number =>
    basis === "strength" ? e.strengthPt : e.distance;
  const sortedDesc = [...entries].sort((a, b) => pickValue(b) - pickValue(a));

  const pickWithin = (reference: number | undefined, tol: number): readonly number[] => {
    if (reference === undefined) return [];
    return entries
      .filter((e) => Math.abs(pickValue(e) - reference) <= tol + 1e-9)
      .map((e) => e.boatNumber)
      .sort((a, b) => a - b);
  };

  const first = sortedDesc[0];
  const second = sortedDesc[1];
  const third = sortedDesc[2];
  const rawFirst = pickWithin(first === undefined ? undefined : pickValue(first), tolerance.first);
  const rawSecond = pickWithin(
    second === undefined ? undefined : pickValue(second),
    tolerance.second,
  );
  const rawThird = pickWithin(third === undefined ? undefined : pickValue(third), tolerance.third);

  // 有効な出目（1-2-3 着が相異なる組合せ）に登場する艇だけを各着で残す。
  // これは bet-payout.ts の countBetCombinations と同じ制約。
  const usedFirst = new Set<number>();
  const usedSecond = new Set<number>();
  const usedThird = new Set<number>();
  for (const a of rawFirst) {
    for (const b of rawSecond) {
      if (a === b) continue;
      for (const c of rawThird) {
        if (c === a || c === b) continue;
        usedFirst.add(a);
        usedSecond.add(b);
        usedThird.add(c);
      }
    }
  }

  const ascending = (set: ReadonlySet<number>): readonly number[] => [...set].sort((a, b) => a - b);

  return {
    kind: "formation",
    first: ascending(usedFirst),
    second: ascending(usedSecond),
    third: ascending(usedThird),
  };
};
