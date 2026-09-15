import type { AiEvaluation, AiEvaluationEntry, RacePrediction } from "@fun-site/shared";
import { isSettledResult } from "@fun-site/shared";

/**
 * 予想者統計 (`/predictors`) と分析軸別集計 (`/stats`) が 1 レースから読む項目だけを
 * 抜き出した軽量な射影。
 *
 * `RacePrediction` は選手成績・近況・過去10走などを抱えて 1 件 100KB 超になり、
 * 集計期間 (active 予想者の startedAt 〜 当日 = 数か月) ぶんを丸ごとメモリに
 * 載せると Node のヒープ上限を超える。集計器はこの型だけを受け取り、
 * `RacePrediction` は日単位で読んだ直後にこの型へ畳んで捨てる。
 *
 * 過去日のダイジェストは GCS にキャッシュされる (`prediction-digest-store.ts`) ので、
 * 形を変えるときは `PREDICTION_DIGEST_SCHEMA_VERSION` を上げてキャッシュを無効化する。
 */
export type PredictionDigest = {
  readonly raceCode: string;
  readonly raceDate: string; // "YYYY-MM-DD"
  readonly stadiumId: string;
  /** レースグレードの上流コード。旧 JSON では空文字。 */
  readonly grade: string;
  /** `isSettledResult(raceResult)`。false のレースは集計母数に入らない。 */
  readonly settled: boolean;
  /** 確定結果の風速 (m/s)。結果未着なら undefined。 */
  readonly windSpeed?: number;
  /** 予想者ごとの直前買い目の採点結果。 */
  readonly predictors: readonly PredictorDigest[];
};

export type PredictorDigest = {
  readonly predictorId: string;
  /** 直前買い目の点数 (`betPayout.realtime.betCount`)。 */
  readonly betCount: number;
  /** 直前買い目の購入額 (`betPayout.realtime.betCostYen`)。0 なら買い目が組めていない。 */
  readonly betCostYen: number;
  /** 直前買い目の払戻額 (`betPayout.realtime.payoutYen`)。 */
  readonly payoutYen: number;
  /** 当日買い目の的中 (参考値)。 */
  readonly dailyHit: boolean;
  /** 直前買い目の的中。 */
  readonly realtimeHit: boolean;
  /** 直前 AI 評価の strengthPt 最大艇 (= 本命) の枠番。評価が無ければ undefined。 */
  readonly honmeiWaku?: number;
  /** 確定 3連単 配当 (円)。未確定・欠損なら undefined。 */
  readonly sanrentanPayout?: number;
};

/** ダイジェストの形を変えたら上げる。GCS キャッシュの読み込み時に不一致なら作り直す。 */
export const PREDICTION_DIGEST_SCHEMA_VERSION = 1 as const;

/** 直前 AI 評価の strengthPt 最大艇 (= 本命) の枠番。同 pt は若い枠番優先。 */
export const honmeiWakuOf = (evaluation: AiEvaluation | undefined): number | undefined => {
  let best: AiEvaluationEntry | undefined;
  for (const e of evaluation?.entries ?? []) {
    if (!best || e.strengthPt > best.strengthPt) best = e;
  }
  return best?.boatNumber;
};

/** `RacePrediction` 1 件を集計用ダイジェストに畳む。純関数。 */
export const toPredictionDigest = (pred: RacePrediction): PredictionDigest => {
  const predictors: PredictorDigest[] = (pred.predictions ?? []).map((pp) => {
    const realtime = pp.betPayout.realtime;
    const sanrentanPayout = realtime.actualSanrentan?.payout;
    const honmeiWaku = honmeiWakuOf(pp.aiEvaluationRealtime);
    return {
      predictorId: pp.predictorId,
      betCount: realtime.betCount,
      betCostYen: realtime.betCostYen,
      payoutYen: realtime.payoutYen,
      dailyHit: pp.betHitStatus.dailyHit,
      realtimeHit: pp.betHitStatus.realtimeHit,
      ...(honmeiWaku === undefined ? {} : { honmeiWaku }),
      ...(sanrentanPayout === undefined ? {} : { sanrentanPayout }),
    };
  });
  const windSpeed = pred.raceResult?.weather.windSpeed;
  return {
    raceCode: pred.raceCode,
    raceDate: pred.raceDate,
    stadiumId: pred.stadiumId,
    grade: pred.grade ?? "",
    settled: isSettledResult(pred.raceResult),
    ...(windSpeed === undefined ? {} : { windSpeed }),
    predictors,
  };
};
