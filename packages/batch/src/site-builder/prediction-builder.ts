import type {
  AiEvaluation,
  AiEvaluationEntry,
  BetHitStatus,
  ComponentKey,
  IndexRow,
  PredictorPrediction,
  PredictorSpec,
  RaceBetPayoutSummary,
  RaceCardRacer,
  RaceCardRow,
  RacePayoutRow,
  RacePrediction,
  RaceRacer,
  RaceResultRow,
  StartPrediction,
  StartPredictionEntry,
  SttRow,
  TitleRow,
} from "@fun-site/shared";
import {
  activePredictors,
  bettingToleranceFor,
  checkBettingHit,
  computeBettingPicks,
  computeOneMarkDistances,
  computeRaceBetPayoutSummary,
  getStadiumById,
  isPreviewDerivedComponent,
  parseRaceCode,
} from "@fun-site/shared";
import type { PredictorIndexFetch } from "../fetcher/index.js";

const BOAT_COUNT = 6;

/** stt が無い場合の進入コース＝枠番のフォールバック */
const buildFallbackStartPrediction = (cards: RaceCardRow): StartPrediction => {
  const entries: StartPredictionEntry[] = cards.racers.map((r) => ({
    boatNumber: r.boatNumber,
    courseNumber: r.boatNumber,
    startTiming: r.nationalAvgST,
  }));
  return {
    fromExhibition: false,
    entries: entries.toSorted((a, b) => a.courseNumber - b.courseNumber),
  };
};

/** stt + race_cards からスタート予想を構築 */
const buildStartPrediction = (cards: RaceCardRow, stt: SttRow | undefined): StartPrediction => {
  if (!stt) return buildFallbackStartPrediction(cards);

  const racerByBoat = new Map<number, RaceCardRacer>(cards.racers.map((r) => [r.boatNumber, r]));

  const entries: StartPredictionEntry[] = stt.boats.map((boat) => {
    const racer = racerByBoat.get(boat.boatNumber);
    return {
      boatNumber: boat.boatNumber,
      courseNumber: boat.courseNumber || boat.boatNumber,
      startTiming: racer?.nationalAvgST ?? 0,
    };
  });

  return {
    fromExhibition: true,
    entries: entries.toSorted((a, b) => a.courseNumber - b.courseNumber),
  };
};

/** index 行から AI 総合評価を構築。state=daily の場合は preview 由来成分を 0 に揃える */
const buildAiEvaluation = (idx: IndexRow): AiEvaluation => {
  const isDaily = idx.state === "daily";
  const entries: AiEvaluationEntry[] = idx.entries.map((e) => {
    const contribution: Partial<Record<ComponentKey, number>> = {};
    for (const key of idx.componentKeys) {
      const raw = e.contributions[key] ?? 0;
      contribution[key] = isDaily && isPreviewDerivedComponent(key) ? 0 : raw;
    }
    return {
      boatNumber: e.boatNumber,
      contribution,
      strengthPt: e.strengthPt,
    };
  });
  return {
    state: idx.state,
    componentKeys: idx.componentKeys,
    entries: entries.toSorted((a, b) => a.boatNumber - b.boatNumber),
  };
};

/** index が無いレース用の中立な AI 評価(全枠 0、最初の active 予想者の成分構成で生成) */
const buildEmptyAiEvaluation = (): AiEvaluation => {
  const fallback = activePredictors()[0];
  const componentKeys: readonly ComponentKey[] = fallback?.componentKeys ?? [
    "waku",
    "racer",
    "motor",
    "exhibit",
    "weather",
  ];
  const zeros = Object.fromEntries(componentKeys.map((k) => [k, 0])) as Partial<
    Record<ComponentKey, number>
  >;
  return {
    state: "daily",
    componentKeys,
    entries: Array.from({ length: BOAT_COUNT }, (_, i) => ({
      boatNumber: i + 1,
      contribution: zeros,
      strengthPt: 0,
    })),
  };
};

/** race_cards の racers を出走表用 RaceRacer に詰め直す */
const toRaceRacers = (cards: RaceCardRow): RaceRacer[] =>
  cards.racers.map((r) => ({
    boatNumber: r.boatNumber,
    registrationNumber: r.registrationNumber,
    racerName: r.racerName,
    classGrade: r.classGrade,
    age: r.age,
    branch: r.branch,
    nationalAvgST: r.nationalAvgST,
    nationalWinRate: r.nationalWinRate,
    nationalTop2Rate: r.nationalTop2Rate,
    localWinRate: r.localWinRate,
    localTop2Rate: r.localTop2Rate,
    motorNumber: r.motorNumber,
    motorTop2Rate: r.motorTop2Rate,
  }));

/**
 * 1 レース × 1 予想者ぶんの PredictorPrediction を組み立てる。
 *
 * `dailyIdx` / `realtimeIdx` は **同じ予想者の** index CSV 由来の daily / realtime
 * 行。同レースに対して両方存在する場合があり、それぞれを独立した AI 評価として
 * 保持し、買い目・的中状態・回収率も daily / realtime の両方で計算する。
 */
const buildPredictorPrediction = (
  predictor: PredictorSpec,
  racers: readonly RaceRacer[],
  dailyIdx: IndexRow | undefined,
  realtimeIdx: IndexRow | undefined,
  result: RaceResultRow | undefined,
  payout: RacePayoutRow | undefined,
): PredictorPrediction => {
  const aiEvaluationDaily = dailyIdx ? buildAiEvaluation(dailyIdx) : undefined;
  const aiEvaluationRealtime = realtimeIdx ? buildAiEvaluation(realtimeIdx) : undefined;

  const tolerance = bettingToleranceFor(predictor.id);
  const dailyPicks = aiEvaluationDaily
    ? computeBettingPicks(computeOneMarkDistances(racers, aiEvaluationDaily), tolerance)
    : undefined;
  const realtimePicks = aiEvaluationRealtime
    ? computeBettingPicks(computeOneMarkDistances(racers, aiEvaluationRealtime), tolerance)
    : undefined;
  const betHitStatus = checkBettingHit(result, dailyPicks, realtimePicks);
  const betPayout = computeRaceBetPayoutSummary(dailyPicks, realtimePicks, result, payout);

  return {
    predictorId: predictor.id,
    predictorName: predictor.displayName,
    slot: predictor.slot,
    aiEvaluationDaily,
    aiEvaluationRealtime,
    betPayout,
    betHitStatus,
  };
};

/**
 * 1 レース分の RacePrediction に統合。
 *
 * `indexRowsByPredictor` は predictor ごとの daily / realtime 行 (どちらか / 両方 /
 * どちらも無し)。各 predictor について `PredictorPrediction` を作り、
 * `predictions` 配列に slot 昇順で並べる。
 *
 * 後方互換: 旧 UI が参照する `aiEvaluation` / `aiEvaluationDaily` /
 * `aiEvaluationRealtime` / `betPayout` / `betHitStatus` フィールドには、
 * **最初の active 予想者 (slot=1)** = A君予想 の値をコピーして残す。
 */
export const buildRacePrediction = (
  cards: RaceCardRow,
  stt: SttRow | undefined,
  indexRowsByPredictor: ReadonlyMap<
    string,
    { readonly daily?: IndexRow; readonly realtime?: IndexRow }
  >,
  title: TitleRow | undefined,
  result: RaceResultRow | undefined,
  payout: RacePayoutRow | undefined,
  generatedAt: string,
): RacePrediction => {
  const parsed = parseRaceCode(cards.raceCode);
  const stadium = getStadiumById(parsed.stadiumId);
  // title CSV の "ボートレース桐生" 形式は prefix を取り除き正規名に揃える
  const stadiumName =
    stadium?.name ?? title?.stadium?.replace(/^ボートレース/, "") ?? parsed.stadiumId;

  const racers = toRaceRacers(cards);

  // active 予想者ごとに PredictorPrediction を作成
  const predictors = activePredictors();
  const predictions: PredictorPrediction[] = predictors.map((p) => {
    const rows = indexRowsByPredictor.get(p.id) ?? {};
    return buildPredictorPrediction(p, racers, rows.daily, rows.realtime, result, payout);
  });

  // 後方互換: 既存 UI 用に primary predictor (= slot 最小) の値を平坦化
  const primary = predictions[0];
  const aiEvaluationDaily = primary?.aiEvaluationDaily;
  const aiEvaluationRealtime = primary?.aiEvaluationRealtime;
  const aiEvaluation = aiEvaluationRealtime ?? aiEvaluationDaily ?? buildEmptyAiEvaluation();
  const betHitStatus: BetHitStatus = primary?.betHitStatus ?? {
    dailyHit: false,
    realtimeHit: false,
  };
  // betPayout は primary が存在しないケースがあれば computeRaceBetPayoutSummary
  // の ZERO_SUMMARY を再現する形だが、primary は必ず存在する (active 予想者 > 0)。
  const betPayout: RaceBetPayoutSummary | undefined = primary?.betPayout;

  return {
    raceCode: cards.raceCode,
    raceDate: cards.raceDate,
    stadiumId: parsed.stadiumId,
    stadiumName,
    raceNumber: parsed.raceNumber,
    raceName: title?.raceName ?? "",
    raceTitle: title?.title ?? "",
    dayLabel: title?.dayLabel ?? "",
    grade: title?.grade ?? "",
    votingDeadline: title?.votingDeadline ?? stt?.votingDeadline ?? "",
    racers,
    startPrediction: buildStartPrediction(cards, stt),
    aiEvaluation,
    aiEvaluationDaily,
    aiEvaluationRealtime,
    raceResult: result,
    racePayout: payout,
    betHitStatus,
    ...(betPayout !== undefined ? { betPayout } : {}),
    predictions,
    generatedAt,
  };
};

/**
 * 当日分の全 race_cards を起点に RacePrediction を組み立てる
 *
 * `indexesByPredictor` は predictor ごとの index CSV 行配列。
 * 各予想者の CSV 内では同一 raceCode で state="daily" / "realtime" の 2 行が
 * 混在し得るので、`(predictorId, raceCode)` でグループ化して 1 レース 1 予想者
 * 単位の daily/realtime 行ペアにまとめる。
 */
export const buildAllRacePredictions = (
  raceCards: readonly RaceCardRow[],
  stt: readonly SttRow[],
  indexesByPredictor: readonly PredictorIndexFetch[],
  titles: readonly TitleRow[],
  results: readonly RaceResultRow[],
  payouts: readonly RacePayoutRow[],
  generatedAt: string,
): RacePrediction[] => {
  const sttByCode = new Map(stt.map((s) => [s.raceCode, s]));
  const titleByCode = new Map(titles.map((t) => [t.raceCode, t]));
  const resultByCode = new Map(results.map((r) => [r.raceCode, r]));
  const payoutByCode = new Map(payouts.map((p) => [p.raceCode, p]));

  // raceCode → predictorId → { daily?, realtime? }
  const indexLookup = new Map<string, Map<string, { daily?: IndexRow; realtime?: IndexRow }>>();
  for (const { predictor, rows } of indexesByPredictor) {
    for (const row of rows) {
      let perRace = indexLookup.get(row.raceCode);
      if (!perRace) {
        perRace = new Map();
        indexLookup.set(row.raceCode, perRace);
      }
      const slot = perRace.get(predictor.id) ?? {};
      if (row.state === "daily") {
        perRace.set(predictor.id, { ...slot, daily: row });
      } else {
        perRace.set(predictor.id, { ...slot, realtime: row });
      }
    }
  }

  return raceCards.map((cards) =>
    buildRacePrediction(
      cards,
      sttByCode.get(cards.raceCode),
      indexLookup.get(cards.raceCode) ?? new Map(),
      titleByCode.get(cards.raceCode),
      resultByCode.get(cards.raceCode),
      payoutByCode.get(cards.raceCode),
      generatedAt,
    ),
  );
};
