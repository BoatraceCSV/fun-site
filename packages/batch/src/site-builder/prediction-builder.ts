import type {
  AiEvaluation,
  AiEvaluationEntry,
  BetHitStatus,
  ComponentKey,
  IndexRow,
  MotorStats,
  MotorStatsRow,
  PredictorPrediction,
  PredictorSpec,
  RaceBetPayoutSummary,
  RaceCardRacer,
  RaceCardRow,
  RacePayoutRow,
  RacePrediction,
  RacePreview,
  RacePreviewBoat,
  RaceRacer,
  RaceRecentForm,
  RaceResultRow,
  RacerRecentForm,
  RecentFormRow,
  RecentFormSessionView,
  StartPrediction,
  StartPredictionEntry,
  SttRow,
  SuiRow,
  TitleRow,
  TkzRow,
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
    exhibitionStartTiming: null,
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
    // 展示ST: 0 (空欄=L 等で未計測) は実測なしとして null 化する
    const exhibitionStartTiming =
      boat.exhibitionStartTiming === 0 ? null : boat.exhibitionStartTiming;
    return {
      boatNumber: boat.boatNumber,
      courseNumber: boat.courseNumber || boat.boatNumber,
      startTiming: racer?.nationalAvgST ?? 0,
      exhibitionStartTiming,
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

/**
 * tkz（展示・体重・チルト）と sui（気象）から直前情報 RacePreview を構築。
 * どちらも未取得なら undefined を返す（RacePrediction.preview を省略する）。
 */
const buildRacePreview = (
  tkz: TkzRow | undefined,
  sui: SuiRow | undefined,
): RacePreview | undefined => {
  if (!(tkz || sui)) return undefined;

  const boats: RacePreviewBoat[] = (tkz?.boats ?? [])
    .map((b) => ({
      boatNumber: b.boatNumber,
      weightKg: b.weightKg,
      weightAdjustKg: b.weightAdjustKg,
      // 展示タイム 0 は未計測（L 等）として null 化する
      exhibitionTime: b.exhibitionTime === 0 ? null : b.exhibitionTime,
      tilt: b.tilt,
    }))
    .toSorted((a, b) => a.boatNumber - b.boatNumber);

  const weather = sui
    ? {
        observedAt: sui.observedAt,
        weather: sui.weather,
        windSpeed: sui.windSpeed,
        waveHeight: sui.waveHeight,
        airTemperature: sui.airTemperature,
        waterTemperature: sui.waterTemperature,
      }
    : null;

  return { boats, weather };
};

/** 空セッション（場名も着順も無い）を除外して表示用 SessionView へ変換 */
const toSessionViews = (
  sessions: ReadonlyArray<{
    startDate: string;
    endDate: string;
    stadiumName: string;
    grade: string;
    ranks: string;
  }>,
): RecentFormSessionView[] =>
  sessions
    .filter((s) => s.ranks !== "" || s.stadiumName !== "")
    .map((s) => ({
      startDate: s.startDate,
      endDate: s.endDate,
      stadiumName: s.stadiumName,
      grade: s.grade,
      ranks: s.ranks,
    }));

/**
 * recent_national / recent_local から近況5節 RaceRecentForm を構築。
 * どちらも未取得なら undefined を返す。各艇は艇番で突合する。
 */
const buildRecentForm = (
  national: RecentFormRow | undefined,
  local: RecentFormRow | undefined,
): RaceRecentForm | undefined => {
  if (!(national || local)) return undefined;

  const nationalByBoat = new Map((national?.boats ?? []).map((b) => [b.boatNumber, b]));
  const localByBoat = new Map((local?.boats ?? []).map((b) => [b.boatNumber, b]));
  const boatNumbers = new Set<number>([...nationalByBoat.keys(), ...localByBoat.keys()]);

  const boats: RacerRecentForm[] = [...boatNumbers]
    .toSorted((a, b) => a - b)
    .map((boatNumber) => {
      const nb = nationalByBoat.get(boatNumber);
      const lb = localByBoat.get(boatNumber);
      return {
        boatNumber,
        racerName: nb?.racerName ?? lb?.racerName ?? "",
        national: toSessionViews(nb?.sessions ?? []),
        local: toSessionViews(lb?.sessions ?? []),
      };
    });

  return { boats };
};

/** motor_stats の `(場コード, モーター番号)` 突合キー */
const motorStatsKey = (stadiumCode: string, motorNumber: number): string =>
  `${stadiumCode}-${motorNumber}`;

/**
 * motor_stats 行群を `(場コード-モーター番号) → MotorStats` の lookup に変換。
 * 同一キーが複数あれば記録日が新しい行を採用する。
 */
const buildMotorStatsLookup = (rows: readonly MotorStatsRow[]): Map<string, MotorStats> => {
  const latestRowByKey = new Map<string, MotorStatsRow>();
  for (const row of rows) {
    const key = motorStatsKey(row.stadiumCode, row.motorNumber);
    const existing = latestRowByKey.get(key);
    if (!existing || row.recordDate > existing.recordDate) {
      latestRowByKey.set(key, row);
    }
  }
  const lookup = new Map<string, MotorStats>();
  for (const [key, row] of latestRowByKey) {
    lookup.set(key, {
      top3Rate: row.top3Rate,
      top3Rank: row.top3Rank,
      championCount: row.championCount,
      finalAppearances: row.finalAppearances,
      avgLapSec: row.avgLapSec,
    });
  }
  return lookup;
};

/** race_cards の racers を出走表用 RaceRacer に詰め直す */
const toRaceRacers = (
  cards: RaceCardRow,
  stadiumCode: string,
  motorStatsByKey: ReadonlyMap<string, MotorStats>,
): RaceRacer[] =>
  cards.racers.map((r) => ({
    boatNumber: r.boatNumber,
    registrationNumber: r.registrationNumber,
    racerName: r.racerName,
    classGrade: r.classGrade,
    age: r.age,
    branch: r.branch,
    hometown: r.hometown,
    prizeExcluded: r.prizeExcluded,
    flyingCount: r.flyingCount,
    lateCount: r.lateCount,
    nationalAvgST: r.nationalAvgST,
    nationalWinRate: r.nationalWinRate,
    nationalTop2Rate: r.nationalTop2Rate,
    nationalTop3Rate: r.nationalTop3Rate,
    localWinRate: r.localWinRate,
    localTop2Rate: r.localTop2Rate,
    localTop3Rate: r.localTop3Rate,
    motorNumber: r.motorNumber,
    motorTop2Rate: r.motorTop2Rate,
    motorTop3Rate: r.motorTop3Rate,
    boatBodyNumber: r.boatBodyNumber,
    boatTop2Rate: r.boatTop2Rate,
    boatTop3Rate: r.boatTop3Rate,
    sessionResults: r.sessionResults,
    ...(motorStatsByKey.has(motorStatsKey(stadiumCode, r.motorNumber))
      ? { motorStats: motorStatsByKey.get(motorStatsKey(stadiumCode, r.motorNumber)) }
      : {}),
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
  tkz: TkzRow | undefined,
  sui: SuiRow | undefined,
  recentNational: RecentFormRow | undefined,
  recentLocal: RecentFormRow | undefined,
  motorStatsByKey: ReadonlyMap<string, MotorStats>,
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

  const racers = toRaceRacers(cards, parsed.stadiumId, motorStatsByKey);

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

  const preview = buildRacePreview(tkz, sui);
  const recentForm = buildRecentForm(recentNational, recentLocal);

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
    ...(preview !== undefined ? { preview } : {}),
    ...(recentForm !== undefined ? { recentForm } : {}),
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
  tkz: readonly TkzRow[],
  sui: readonly SuiRow[],
  recentNational: readonly RecentFormRow[],
  recentLocal: readonly RecentFormRow[],
  motorStats: readonly MotorStatsRow[],
  indexesByPredictor: readonly PredictorIndexFetch[],
  titles: readonly TitleRow[],
  results: readonly RaceResultRow[],
  payouts: readonly RacePayoutRow[],
  generatedAt: string,
): RacePrediction[] => {
  const sttByCode = new Map(stt.map((s) => [s.raceCode, s]));
  const tkzByCode = new Map(tkz.map((t) => [t.raceCode, t]));
  const suiByCode = new Map(sui.map((s) => [s.raceCode, s]));
  const recentNationalByCode = new Map(recentNational.map((r) => [r.raceCode, r]));
  const recentLocalByCode = new Map(recentLocal.map((r) => [r.raceCode, r]));
  const motorStatsByKey = buildMotorStatsLookup(motorStats);
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
      tkzByCode.get(cards.raceCode),
      suiByCode.get(cards.raceCode),
      recentNationalByCode.get(cards.raceCode),
      recentLocalByCode.get(cards.raceCode),
      motorStatsByKey,
      indexLookup.get(cards.raceCode) ?? new Map(),
      titleByCode.get(cards.raceCode),
      resultByCode.get(cards.raceCode),
      payoutByCode.get(cards.raceCode),
      generatedAt,
    ),
  );
};
