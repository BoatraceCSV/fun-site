/**
 * モーターpt 素点の内訳 (`data/estimate/motor_pt/{runs,motors,baseline}/`) 由来の型。
 *
 * 素点は
 *
 *     素点 = n_eff / (n_eff + 10) × Σ(w × z) / Σw
 *       z  = (生得点 − μ_セル) / σ_セル      セル = 級別 × グレード分類 × 進入
 *       w  = exp(−ln2 / 60 × 経過日数)
 *
 * で決まるが、この μ/σ は **全 24 場を横断したコーパス**から算出される。1 基ぶんの
 * 素点でも全場の履歴に依存するので、当日ぶんの CSV しか取得しない fun-site 側では
 * 再現できない。そこで上流 (`build_motor_pt_breakdown.py`) が計算過程を明細として
 * 配り、fun-site はそれを読んで表示する。選手pt に対する `recent_national` /
 * `recent_local` と同じ立ち位置の CSV である。
 *
 * 上流スキーマ: BoatraceCSV `docs/data/motor_pt.md`
 */

import type { MotorPtGradeBucket } from "../utils/motor-pt.js";

// === runs/YYYY/MM/DD.csv (1 走 1 行) ===

/**
 * 素点に寄与した 1 走ぶんの明細。
 *
 * 集計対象外の走 (`F` / `L` / `失` / `妨` / `欠` / `不`) は **行として存在しない**。
 * 機材起因の `転` / `落` / `沈` / `エ` は `rawScore = -100` で計上される。
 */
export type MotorPtRunRow = {
  /** 記録日 (= 対象日 / 時間減衰の基準日, YYYY-MM-DD) */
  readonly recordDate: string;
  /** 場コード ("01"-"24") */
  readonly stadiumCode: string;
  /** 物理モーター番号 */
  readonly motorNumber: number;
  /** 節インデックス。0 = 直近節、新→旧で最大 5 */
  readonly sessionIndex: number;
  /** その節の最終開催日 (YYYY-MM-DD) */
  readonly sessionEnd: string;
  /** この走の実日付 (YYYY-MM-DD) */
  readonly raceDate: string;
  /** 節の何日目か (1-7)。0 は不明 */
  readonly day: number;
  /** その日の何走目か (1-2)。0 は不明 */
  readonly run: number;
  /** この走に乗っていた選手の級別 */
  readonly racerClass: string;
  /** スコア表のグレード分類 */
  readonly bucket: MotorPtGradeBucket;
  /** 進入コース (1-6)。0 は不明（コース補正のフォールバック対象） */
  readonly entryCourse: number;
  /** 正規化済み着順トークン (`"1"`〜`"6"` / `転` / `落` / `沈` / `エ`) */
  readonly finish: string;
  /** スコア表の生得点。`転落沈エ` は -100 */
  readonly rawScore: number;
  /** この走に適用されたコース補正セルの平均 */
  readonly cellMu: number;
  /** 同 標準偏差 */
  readonly cellSigma: number;
  /** z 残差 = (rawScore − cellMu) / cellSigma */
  readonly residual: number;
  /** 時間減衰の重み = exp(−ln2 / 60 × (recordDate − raceDate)) */
  readonly weight: number;
};

// === motors/YYYY/MM/DD.csv (1 モーター 1 行) ===

/**
 * 1 モーターぶんの素点集計。
 *
 * 採点対象の走が 1 本も無いモーターも 1 行来る（`runCount = 0` で `rawPt` 以下が
 * null）。「CSV に無い」と「履歴が無い」を区別できるようにするためで、後者の
 * モーターpt は上流で平均の 50 に補完される。
 */
export type MotorPtMotorRow = {
  readonly recordDate: string;
  readonly stadiumCode: string;
  readonly motorNumber: number;
  /** 素点に寄与した節の数 (0-6) */
  readonly sessionCount: number;
  /** runs に出ている行数 */
  readonly runCount: number;
  /** Σw。履歴なしは null */
  readonly sumW: number | null;
  /** Σw²。履歴なしは null */
  readonly sumW2: number | null;
  /** Kish の有効サンプル数 = Σw² / Σw2。履歴なしは null */
  readonly nEff: number | null;
  /** Σ(w × z) / Σw。収縮前の加重平均。履歴なしは null */
  readonly meanResidual: number | null;
  /** 素点 = n_eff / (n_eff + 10) × meanResidual。履歴なしは null */
  readonly rawPt: number | null;
};

// === baseline/YYYY/MM/DD.csv (コース補正セル) ===

/**
 * コース補正セルの μ / σ / サンプル数。
 *
 * **サンプル数が 5 未満のセルは行として存在しない**（上流 `LANE_BASELINE_MIN_SAMPLES`）。
 * そのため上流 `cell_stats()` のフォールバック階層は行の有無だけで再現できる:
 *
 * 1. `(級別, グレード分類, 進入)` の行
 * 2. 無ければ `(級別, グレード分類, entryCourse=0)` の行
 * 3. それも無ければ (μ, σ) = (0, 1) = コース補正なし
 */
export type MotorPtBaselineRow = {
  readonly recordDate: string;
  readonly racerClass: string;
  readonly bucket: MotorPtGradeBucket;
  /** 進入コース (1-6)。**0 は「級別 × グレード分類」のフォールバックセル** */
  readonly entryCourse: number;
  readonly mu: number;
  readonly sigma: number;
  /** このセルを構成した走の本数 */
  readonly sampleCount: number;
};

// === レース JSON に焼き込む形 ===

/**
 * レース JSON に焼き込む 1 走ぶんの明細。
 *
 * CSV 行 ({@link MotorPtRunRow}) から **モーター単位で一定の 3 列**
 * (`recordDate` / `stadiumCode` / `motorNumber`) を落としたもの。それらは親の
 * {@link MotorPtHistory} が持っているので、1 レース 230 走ぶん繰り返す意味がない
 * (整形済み JSON で 1 レースあたり 20KB 前後の差になる)。
 */
export type MotorPtHistoryRun = Omit<MotorPtRunRow, "recordDate" | "stadiumCode" | "motorNumber">;

/**
 * 1 モーターぶんの素点の内訳。`RaceRacer.motorPtHistory` に載る。
 *
 * 上流 CSV の motors 1 行 + その motor に紐づく runs 行をまとめたもの。上流は
 * 日次で全場ぶんを出すが、レース JSON にはそのレースの 6 基ぶんだけを焼き込む。
 *
 * `motorStats`（モーター期成績）とは別物である点に注意。あちらは 3連率・優勝回数
 * などの通算成績で、**モーターpt の入力ではない**。
 */
export type MotorPtHistory = {
  readonly stadiumCode: string;
  readonly motorNumber: number;
  /** 上流が内訳を出した日 (= 時間減衰の基準日) */
  readonly recordDate: string;
  /** 素点に寄与した節の数 (0-6) */
  readonly sessionCount: number;
  readonly sumW: number | null;
  readonly sumW2: number | null;
  readonly nEff: number | null;
  readonly meanResidual: number | null;
  /** 素点。有効な走が 1 本も無いモーターは null（上流が 50 補完する） */
  readonly rawPt: number | null;
  /** 時系列の明細（節 0 = 直近から新→旧、節内は日次・走の昇順） */
  readonly runs: readonly MotorPtHistoryRun[];
};

/**
 * そのレースの 6 基が実際に引いたコース補正セルだけを抜き出したもの。
 * `RacePrediction.motorPtBaseline` に載る。
 *
 * 全 24 場横断で作られる値で、これが「fun-site 側で素点を再現できない」理由その
 * ものなので、詳細ページで実物を出す。1 レースあたり最大 36 行（6 基 × 6 セル）、
 * 実際は 10〜20 行程度。
 */
export type MotorPtBaselineCell = {
  readonly racerClass: string;
  readonly bucket: MotorPtGradeBucket;
  /** 1-6。0 は「級別 × グレード分類」のフォールバックセル */
  readonly entryCourse: number;
  readonly mu: number;
  readonly sigma: number;
  readonly sampleCount: number;
};
