/**
 * 統計ページ (`/stats`) 用の分析軸別集計レポートの型定義。
 *
 * バッチの `aggregator/predictor-breakdown.ts` が生成し
 * `packages/web/src/data/predictors/breakdown.json` に書き出す。web 側は
 * これを読み込んで描画する。値はすべて **直前 (realtime) のみ** を対象とする
 * (`metric: "realtime"`)。当日 (daily) は集計対象外。
 *
 * 集計対象レースの条件は「直前買い目が組めた」= `betPayout.realtime.betCostYen > 0`。
 * 1 レースは各分析軸へちょうど 1 回だけ加算される。
 */

/**
 * 1 セル (= 1 区分 / 1 時点) の集計値。すべて直前 (realtime) のみ。
 *
 * 回収率・的中率は分母が 0 のとき `null` (= 集計母数なし)。
 */
export type Metrics = {
  /** n: 直前買い目が組めたレース数。 */
  readonly raceCount: number;
  /** 直前的中レース数。 */
  readonly hitCount: number;
  /** 的中率 = hitCount / raceCount。`raceCount === 0` のとき `null`。 */
  readonly hitRate: number | null;
  /** 直前購入額の総和 (1 点 ¥100)。 */
  readonly betCostYen: number;
  /** 直前払戻額の総和。 */
  readonly payoutYen: number;
  /** 回収率 = payoutYen / betCostYen。`betCostYen === 0` のとき `null`。 */
  readonly recoveryRate: number | null;
};

/**
 * 分析軸の 1 区分。`key` は機械処理用、`label` は表示用。
 * 配列順がそのまま表示順を表す。
 */
export type Bucket = {
  readonly key: string;
  readonly label: string;
  readonly metrics: Metrics;
};

/**
 * 時系列の 1 点。当日単独 (`metrics`) と開始日からの累積 (`cumulative`)。
 */
export type TimeseriesPoint = {
  /** YYYY-MM-DD。 */
  readonly date: string;
  /** その日単独の集計 (直前のみ)。 */
  readonly metrics: Metrics;
  /** `startedAt` 〜 当日 の累積集計 (直前のみ)。 */
  readonly cumulative: Metrics;
};

/**
 * 1 予想者ぶんの分析軸別集計。
 *
 * `byPayoutBand` / `byWindSpeed` は外部データ (確定払戻 / 確定結果) に依存する
 * ため、データ欠損レースを `key: "unknown"` バケットに含める。これにより各軸の
 * `raceCount` 合計が `total.raceCount` と一致し、監査可能になる。
 */
export type PredictorBreakdown = {
  readonly predictorId: string;
  readonly predictorName: string;
  readonly slot: number;
  readonly status: "active" | "retired";
  readonly startedAt: string;
  /** 直前通算。 */
  readonly total: Metrics;
  /** 日次推移 (古→新)。各点は当日単独 + 累積を持つ。 */
  readonly timeseries: readonly TimeseriesPoint[];
  /** 場別 (stadiumId 昇順、出走のあった場のみ)。 */
  readonly byStadium: readonly Bucket[];
  /** グレード別 (SG → 一般 → 不明)。 */
  readonly byGrade: readonly Bucket[];
  /** 買い目点数別 (フォーメーション点数のビン)。 */
  readonly byBetCount: readonly Bucket[];
  /** 本命枠番別 (直前 AI 評価の strengthPt 最大艇の枠番、1〜6)。 */
  readonly byHonmeiWaku: readonly Bucket[];
  /** 配当帯別 (確定 3連単 配当のビン、不明含む)。 */
  readonly byPayoutBand: readonly Bucket[];
  /** 風速別 (確定結果の風速 m/s のビン、不明含む)。 */
  readonly byWindSpeed: readonly Bucket[];
};

/**
 * 統計ページ用レポート全体。
 */
export type PredictorBreakdownReport = {
  /** スキーマ版数。互換のない変更時にインクリメント。 */
  readonly schemaVersion: 1;
  /** 生成時刻 (ISO)。 */
  readonly updatedAt: string;
  /** 集計対象の指標。現状は直前 (realtime) のみ。 */
  readonly metric: "realtime";
  readonly predictors: readonly PredictorBreakdown[];
};
