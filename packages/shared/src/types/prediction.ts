import type { ComponentKey } from "../predictors.js";
import type { BetHitStatus } from "../utils/bet-hit.js";
import type { RaceBetPayoutSummary } from "../utils/bet-payout.js";
import type { IndexState, SessionResultSlot } from "./race-card.js";
import type { RacePayoutRow } from "./race-payout.js";
import type { RaceResultRow } from "./race-result.js";

/** 出走表に表示する選手情報（race_cards 由来の主要項目を集約） */
export type RaceRacer = {
  readonly boatNumber: number;
  readonly registrationNumber: number;
  readonly racerName: string;
  readonly classGrade: string;
  readonly age: number;
  readonly branch: string;
  readonly hometown: string;
  /** 賞金除外（補欠出走等） */
  readonly prizeExcluded: boolean;
  /** フライング累積本数 */
  readonly flyingCount: number;
  /** 出遅れ累積本数 */
  readonly lateCount: number;
  readonly nationalAvgST: number;
  readonly nationalWinRate: number;
  readonly nationalTop2Rate: number;
  readonly nationalTop3Rate: number;
  readonly localWinRate: number;
  readonly localTop2Rate: number;
  readonly localTop3Rate: number;
  readonly motorNumber: number;
  readonly motorTop2Rate: number;
  readonly motorTop3Rate: number;
  /** ボート（艇）番号 */
  readonly boatBodyNumber: number;
  readonly boatTop2Rate: number;
  readonly boatTop3Rate: number;
  /** 節間成績 14 スロット（時系列順、未出走含む） */
  readonly sessionResults: readonly SessionResultSlot[];
  /**
   * モーター期成績（motor_stats 由来、場×モーター番号で突合）。
   * 当日 motor_stats が未取得 / 当該場が未収録のレースでは undefined。
   */
  readonly motorStats?: MotorStats;
};

/**
 * 出走表に表示するモーター期成績（motor_stats の高価値フィールドの射影）。
 * `RaceRacer.motorStats` にぶら下がる。
 */
export type MotorStats = {
  /** 3連対率 (%) */
  readonly top3Rate: number;
  /** 3連対率順位（1 位が最高） */
  readonly top3Rank: number;
  /** 優勝回数 */
  readonly championCount: number;
  /** 優出回数 */
  readonly finalAppearances: number;
  /** 平均ラップ秒。連対実績ゼロは null */
  readonly avgLapSec: number | null;
};

/** スタート予想 - 1艇分のエントリ */
export type StartPredictionEntry = {
  /** 枠番 (1-6) */
  readonly boatNumber: number;
  /** 進入コース (1-6)。stt 未取得時は枠番と同一 */
  readonly courseNumber: number;
  /** スタートタイミング = race_cards の全国平均ST */
  readonly startTiming: number;
  /**
   * スタート展示の実測ST (previews/stt 由来)。
   * stt 未取得・展示未計測 (空欄→0) の場合は null。負値はフライング側。
   */
  readonly exhibitionStartTiming: number | null;
};

/** スタート予想全体 */
export type StartPrediction = {
  /** stt CSV から進入コースを取得できたか。false の場合は枠番=コースの仮表示 */
  readonly fromExhibition: boolean;
  /** 進入コース順に並んだエントリ */
  readonly entries: readonly StartPredictionEntry[];
};

/**
 * AI 評価の寄与pt 内訳。
 *
 * 採用成分は predictor によって異なる。`Partial` を用いる理由は、daily 状態の
 * 場合に preview 由来成分 (exhibit / weather) を 0 ではなく省略 / 0 で表現する
 * 余地を残すため。UI 側は `evaluation.componentKeys` で iterate して、未定義は
 * 0 として扱う。
 */
export type AiEvaluationContribution = Readonly<Partial<Record<ComponentKey, number>>>;

/** AI 評価 - 1枠分 */
export type AiEvaluationEntry = {
  readonly boatNumber: number;
  readonly contribution: AiEvaluationContribution;
  /** 強さpt（合計値の参考） */
  readonly strengthPt: number;
};

/** AI による総合評価（index CSV 由来） */
export type AiEvaluation = {
  readonly state: IndexState;
  /** この評価が採用する成分キー（描画順)。predictor.componentKeys と一致。 */
  readonly componentKeys: readonly ComponentKey[];
  readonly entries: readonly AiEvaluationEntry[];
};

/**
 * 1 予想者ぶんの予想内容。`RacePrediction.predictions[]` の要素として
 * レース 1 件に複数 (active 予想者の数だけ) 並ぶ。
 *
 * `betPayout` / `betHitStatus` は **その予想者の買い目** に対する集計。
 * `aiEvaluationDaily` / `aiEvaluationRealtime` の有無はその予想者の
 * index CSV に対応する状態の行が存在するかどうかに依存する。
 */
export type PredictorPrediction = {
  /** 予想者 ID (例: "v1_basic", "v2_tenkai")。 */
  readonly predictorId: string;
  /** UI 表示名 (レジストリから注入。例: "A君予想")。 */
  readonly predictorName: string;
  /** 表示順 (active 予想者の中での slot。低いほど先頭)。 */
  readonly slot: number;
  /** 朝バッチ時点の AI 評価。daily 行が無ければ undefined。 */
  readonly aiEvaluationDaily?: AiEvaluation;
  /** 直前情報反映後の AI 評価。realtime 行が無ければ undefined。 */
  readonly aiEvaluationRealtime?: AiEvaluation;
  /** この予想者の買い目・回収率集計。3連単 1 レース分。 */
  readonly betPayout: RaceBetPayoutSummary;
  /** この予想者の当日 / 直前買い目それぞれの的中状態。 */
  readonly betHitStatus: BetHitStatus;
};

/** 直前情報 - 1 艇分の展示データ（tkz 由来） */
export type RacePreviewBoat = {
  readonly boatNumber: number;
  /** 体重 (kg) */
  readonly weightKg: number;
  /** 体重調整 (kg) */
  readonly weightAdjustKg: number;
  /** 展示タイム (秒)。未計測は null */
  readonly exhibitionTime: number | null;
  /** チルト角度 */
  readonly tilt: number;
};

/** 直前情報 - 水面気象（sui 由来） */
export type RaceWeather = {
  /** 気象観測時刻 (HHMM) */
  readonly observedAt: string;
  /** 天候コード (1=晴 / 2=曇 / 3=雨 / 4=雪 / 5=霧 など、生値) */
  readonly weather: string;
  /** 風速 (m/s) */
  readonly windSpeed: number;
  /** 波高 (cm) */
  readonly waveHeight: number;
  /** 気温 (℃) */
  readonly airTemperature: number;
  /** 水温 (℃) */
  readonly waterTemperature: number;
};

/**
 * 直前情報（締切5分前スナップショット）の統合。
 * tkz（体重・展示タイム・チルト）と sui（水面気象）を結合したもの。
 * どちらの CSV も未取得のレースでは `preview` 自体が undefined になる。
 */
export type RacePreview = {
  /** 展示データ（艇番昇順）。tkz 未取得時は空配列 */
  readonly boats: readonly RacePreviewBoat[];
  /** 水面気象。sui 未取得時は null */
  readonly weather: RaceWeather | null;
};

/** 近況5節 - 1 節分の表示用データ（recent_national / recent_local 由来） */
export type RecentFormSessionView = {
  /** 節開始日 (YYYY-MM-DD) */
  readonly startDate: string;
  /** 節終了日 (YYYY-MM-DD) */
  readonly endDate: string;
  /** 場名 */
  readonly stadiumName: string;
  /** グレード（生文字列） */
  readonly grade: string;
  /** 着順時系列の生文字列。UI 側で `tokenizeRankString` により可視化する */
  readonly ranks: string;
};

/** 近況5節 - 1 艇分（全国・当地） */
export type RacerRecentForm = {
  readonly boatNumber: number;
  readonly racerName: string;
  /** 全国近況5節（前1節→前5節）。空セッションは除外済み */
  readonly national: readonly RecentFormSessionView[];
  /** 当地近況5節（前1節→前5節）。空セッションは除外済み */
  readonly local: readonly RecentFormSessionView[];
};

/**
 * 近況5節（全国 + 当地）の統合。
 * recent_national / recent_local のどちらも未取得のレースでは undefined。
 */
export type RaceRecentForm = {
  readonly boats: readonly RacerRecentForm[];
};

/** レース予想（新スキーマ） */
export type RacePrediction = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly stadiumName: string;
  readonly raceNumber: number;
  readonly raceName: string;
  readonly raceTitle: string;
  /**
   * 開催日次の表示用ラベル。"最終日" / "初日" / "1日目" など、上流 CSV の生文字列。
   * 古い JSON では未設定の場合があるため、UI 側では空文字フォールバックすること。
   */
  readonly dayLabel: string;
  /**
   * レースグレードの上流コード。"SG" / "PG1" / "G1" / "G2" / "G3" / "IP" など。
   * "IP" は一般戦相当。バッジ表示判定の対象外として UI 側で扱う。
   * 古い JSON では未設定の場合があるため、UI 側では空文字フォールバックすること。
   */
  readonly grade: string;
  readonly votingDeadline: string;
  readonly racers: readonly RaceRacer[];
  readonly startPrediction: StartPrediction;
  /**
   * 直前情報（締切5分前の展示・気象スナップショット）。
   * previews/tkz / previews/sui のどちらも未取得のレースでは undefined。
   * 古い JSON では未設定のため、UI 側は undefined フォールバックすること。
   */
  readonly preview?: RacePreview;
  /**
   * 近況5節（全国 + 当地）。programs/recent_national / recent_local のどちらも
   * 未取得のレースでは undefined。古い JSON では未設定のため undefined フォールバック。
   */
  readonly recentForm?: RaceRecentForm;
  /**
   * AI 総合評価（後方互換用）。realtime が利用可能ならそちらを、無ければ daily を採用する。
   * 1マーク予想や AI 評価チャートの既存表示はこの値を参照する。
   */
  readonly aiEvaluation: AiEvaluation;
  /**
   * 朝バッチ時点の AI 評価（直前情報反映前）。買い目「当日買い目」表示に利用する。
   * index CSV に daily 行が存在しない場合は undefined。
   */
  readonly aiEvaluationDaily?: AiEvaluation;
  /**
   * 直前情報反映後の AI 評価。買い目「直前買い目」表示に利用する。
   * index CSV に realtime 行が存在しない場合（直前情報未反映時）は undefined。
   */
  readonly aiEvaluationRealtime?: AiEvaluation;
  /**
   * realtime 結果。当該レースが確定し results/realtime CSV に行が存在する
   * 場合のみセットされる。未確定 / CSV 未取得時は undefined。
   */
  readonly raceResult?: RaceResultRow;
  /**
   * 当日買い目 / 直前買い目それぞれが結果に対して的中したか。
   * `raceResult` が無い、または 1〜3 着が揃っていない場合は両方 false。
   * 古い JSON では未設定の場合があるため、UI 側では undefined フォールバックすること。
   */
  readonly betHitStatus?: BetHitStatus;
  /**
   * realtime 払戻。当該レースが確定し results/payouts CSV に行が存在する
   * 場合のみセットされる。未確定 / CSV 未取得時は undefined。
   */
  readonly racePayout?: RacePayoutRow;
  /**
   * 当日買い目 / 直前買い目それぞれの 3連単 ベット結果（点数・賭け金・払戻）。
   * `raceResult` または `racePayout` が無い場合は payoutYen=0 / hit=false。
   * 古い JSON では未設定の場合があるため、UI 側では undefined フォールバックすること。
   * **後方互換用フィールド**。新しい UI は `predictions` 配列の各 `PredictorPrediction`
   * から各予想者ぶんの集計を参照する。
   */
  readonly betPayout?: RaceBetPayoutSummary;
  /**
   * Active な予想者ぶんの予想内容(A君 / B君 ...)。
   * `slot` 昇順で並んでいる。
   * 古い JSON ではこのフィールドが無いため、UI 側は空配列フォールバックすること。
   */
  readonly predictions?: readonly PredictorPrediction[];
  readonly generatedAt: string;
};
