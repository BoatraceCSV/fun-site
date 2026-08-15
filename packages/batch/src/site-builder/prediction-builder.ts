import type {
  AiEvaluation,
  AiEvaluationEntry,
  AnaPicksRow,
  BetHitStatus,
  BettingPicks,
  ComponentKey,
  IndexRow,
  KimariteRow,
  MotorStats,
  MotorStatsRow,
  OriginalExhibition,
  OriginalExhibitionRow,
  PredictorPrediction,
  PredictorSpec,
  RaceBetPayoutSummary,
  RaceCardRow,
  RacePayoutRow,
  RacePrediction,
  RacePreview,
  RacePreviewBoat,
  RaceRacer,
  RaceRecentForm,
  RaceResultRow,
  RaceTokutenHayami,
  RaceWaku10,
  RacerRecentForm,
  RacerStRow,
  RacerWaku10,
  RecentFormRow,
  RecentFormSessionView,
  StartPrediction,
  StartPredictionEntry,
  SttRow,
  SuiRow,
  TitleRow,
  TkzRow,
  TokutenHayamiRow,
  UpsetMeter,
  Waku10Row,
} from "@fun-site/shared";
import {
  activePredictors,
  bettingBasisFor,
  bettingStyleFor,
  bettingToleranceFor,
  checkBettingHit,
  computeBettingPicks,
  computeOneMarkDistances,
  computeRaceBetPayoutSummary,
  getStadiumById,
  isPreviewDerivedComponent,
  oneMarkDistanceOptionsFor,
  parseRaceCode,
} from "@fun-site/shared";
import type { PredictorIndexFetch } from "../fetcher/index.js";

const BOAT_COUNT = 6;

/**
 * 予測 ST。通常版 (useEstimated=false) は全国平均 ST (従来どおり)。
 * 推定 ST 版 (useEstimated=true) は AI 推定 ST (estimate/racer_st) を優先し、
 * 無い枠は全国平均 ST。0.00 = 実績なしの補完は描画側 / 距離計算側の共通
 * フォールバック (`NO_RECORD_ST_FALLBACK`) に委ねる。
 */
const startTimingFor = (racer: RaceRacer | undefined, useEstimated: boolean): number =>
  (useEstimated ? (racer?.estimatedST ?? racer?.nationalAvgST) : racer?.nationalAvgST) ?? 0;

/**
 * 予測 ST の 25/75 パーセンタイル。推定 ST 版で、かつ推定 ST 本体と帯の両方が
 * 揃っている枠にだけ付く。全国平均 ST にフォールバックした枠は帯なし
 * (その枠だけ帯が広く/狭く見えるのを避ける)。
 */
const startBandFor = (
  racer: RaceRacer | undefined,
  useEstimated: boolean,
): Pick<StartPredictionEntry, "startTimingP25" | "startTimingP75"> => {
  if (!useEstimated || racer?.estimatedST === undefined) return {};
  const { estimatedStP25: p25, estimatedStP75: p75 } = racer;
  return p25 !== undefined && p75 !== undefined ? { startTimingP25: p25, startTimingP75: p75 } : {};
};

/** stt が無い場合の進入コース＝枠番のフォールバック */
const buildFallbackStartPrediction = (
  racers: readonly RaceRacer[],
  useEstimated: boolean,
): StartPrediction => {
  const entries: StartPredictionEntry[] = racers.map((r) => ({
    boatNumber: r.boatNumber,
    courseNumber: r.boatNumber,
    startTiming: startTimingFor(r, useEstimated),
    exhibitionStartTiming: null,
    ...startBandFor(r, useEstimated),
  }));
  return {
    fromExhibition: false,
    ...(useEstimated ? { usesEstimatedST: true } : {}),
    entries: entries.toSorted((a, b) => a.courseNumber - b.courseNumber),
  };
};

/**
 * stt + 出走表からスタート予想を構築する。
 * useEstimated=false: 従来どおり全国平均 ST (`RacePrediction.startPrediction`)。
 * useEstimated=true: AI 推定 ST 版 (`RacePrediction.startPredictionEstimated`。
 * v5_slit のカードが表示する)。
 */
const buildStartPrediction = (
  racers: readonly RaceRacer[],
  stt: SttRow | undefined,
  useEstimated: boolean,
): StartPrediction => {
  if (!stt) return buildFallbackStartPrediction(racers, useEstimated);

  const racerByBoat = new Map<number, RaceRacer>(racers.map((r) => [r.boatNumber, r]));

  const entries: StartPredictionEntry[] = stt.boats.map((boat) => {
    const racer = racerByBoat.get(boat.boatNumber);
    // 展示ST: 0 (空欄=L 等で未計測) は実測なしとして null 化する
    const exhibitionStartTiming =
      boat.exhibitionStartTiming === 0 ? null : boat.exhibitionStartTiming;
    return {
      boatNumber: boat.boatNumber,
      courseNumber: boat.courseNumber || boat.boatNumber,
      startTiming: startTimingFor(racer, useEstimated),
      exhibitionStartTiming,
      ...startBandFor(racer, useEstimated),
    };
  });

  return {
    fromExhibition: true,
    ...(useEstimated ? { usesEstimatedST: true } : {}),
    entries: entries.toSorted((a, b) => a.courseNumber - b.courseNumber),
  };
};

/** index 行から AI 総合評価を構築。state=daily の場合は preview 由来成分を 0 に揃える */
const buildAiEvaluation = (idx: IndexRow): AiEvaluation => {
  const isDaily = idx.state === "daily";
  const entries: AiEvaluationEntry[] = idx.entries.map((e) => {
    const contribution: Partial<Record<ComponentKey, number>> = {};
    // 成分pt（偏差値）は 0 に潰さずそのまま持つ。偏差値スケールの 0 は「中立」ではなく
    // 「平均から -5σ」を意味してしまうため。daily の preview 由来成分には中立値 50 が
    // 入っており、UI 側は contribution と同じく isPreviewDerivedComponent で伏せる。
    const components: Partial<Record<ComponentKey, number>> = {};
    for (const key of idx.componentKeys) {
      const raw = e.contributions[key] ?? 0;
      contribution[key] = isDaily && isPreviewDerivedComponent(key) ? 0 : raw;
      const pt = e.components[key];
      if (pt !== undefined) components[key] = pt;
    }
    return {
      boatNumber: e.boatNumber,
      contribution,
      components,
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
  origEx: OriginalExhibitionRow | undefined,
): RacePreview | undefined => {
  if (!(tkz || sui || origEx)) return undefined;

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

  // オリジナル展示: 計測項目が 1 つ以上ある場合のみ採用
  const originalExhibition: OriginalExhibition | null =
    origEx && origEx.itemLabels.length > 0
      ? {
          labels: origEx.itemLabels,
          boats: origEx.boats
            .map((b) => ({ boatNumber: b.boatNumber, values: b.values }))
            .toSorted((a, b) => a.boatNumber - b.boatNumber),
        }
      : null;

  return { boats, weather, originalExhibition };
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

/**
 * waku10 から枠番別過去10走 RaceWaku10 を構築。未取得なら undefined を返す。
 *
 * waku10 CSV は登録番号を持たないため、突合は艇番 (`艇1`〜`艇6` の位置) で行う。
 * 出走歴が 10 走に満たない選手は古い側のスロットが全列空欄になるので、
 * 着順が空のスロットは落とす。進入コースは空欄 = 枠なり進入なので枠番で補完し、
 * 補完したことを `courseIsAsWaku` で示す。
 */
const buildWaku10 = (waku10: Waku10Row | undefined): RaceWaku10 | undefined => {
  if (!waku10) return undefined;

  const boats: RacerWaku10[] = waku10.boats
    .map((b) => ({
      boatNumber: b.boatNumber,
      racerName: b.racerName,
      winRate: b.winRate,
      avgST: b.avgST,
      avgStartOrder: b.avgStartOrder,
      runs: b.runs
        .filter((r) => r.rank !== "")
        .map((r) => ({
          rank: r.rank,
          entryCourse: r.entryCourse > 0 ? r.entryCourse : b.boatNumber,
          courseIsAsWaku: r.entryCourse === 0,
          grade: r.grade,
        })),
    }))
    // 全艇が空 (CSV に行はあるが中身が無い) のときはセクションごと出さない
    .filter((b) => b.racerName !== "" || b.runs.length > 0);

  return boats.length > 0 ? { boats } : undefined;
};

/**
 * tokuten_hayami から得点率早見 RaceTokutenHayami を構築。行が無ければ undefined。
 *
 * 上流は「公開済み (status=1)」の行しか書かないので、行があれば表示できる。
 * 予選最終日を過ぎた節・得点率早見を出さない節では恒久的に行が来ない。
 */
const buildTokutenHayami = (row: TokutenHayamiRow | undefined): RaceTokutenHayami | undefined => {
  if (!row || row.racers.length === 0) return undefined;
  return {
    borderRank: row.borderRank,
    rankPoints: row.rankPoints,
    racers: [...row.racers].sort((a, b) => a.boatNumber - b.boatNumber),
  };
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
  racerSt: RacerStRow | undefined,
): RaceRacer[] => {
  const estimatedByBoat = new Map<number, number>();
  const bandByBoat = new Map<number, { p25: number; p75: number }>();
  for (const e of racerSt?.entries ?? []) {
    if (e.estimatedST !== null) estimatedByBoat.set(e.boatNumber, e.estimatedST);
    if (e.estimatedStP25 !== null && e.estimatedStP75 !== null) {
      bandByBoat.set(e.boatNumber, { p25: e.estimatedStP25, p75: e.estimatedStP75 });
    }
  }
  return cards.racers.map((r) => ({
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
    ...(estimatedByBoat.has(r.boatNumber)
      ? { estimatedST: estimatedByBoat.get(r.boatNumber) }
      : {}),
    ...(bandByBoat.has(r.boatNumber)
      ? {
          estimatedStP25: bandByBoat.get(r.boatNumber)?.p25,
          estimatedStP75: bandByBoat.get(r.boatNumber)?.p75,
        }
      : {}),
  }));
};

/**
 * 1 レース × 1 予想者ぶんの PredictorPrediction を組み立てる。
 *
 * `dailyIdx` / `realtimeIdx` は **同じ予想者の** index CSV 由来の daily / realtime
 * 行。同レースに対して両方存在する場合があり、それぞれを独立した AI 評価として
 * 保持し、買い目・的中状態・回収率も daily / realtime の両方で計算する。
 */
const toComboPicks = (row: AnaPicksRow | undefined): BettingPicks | undefined =>
  row && row.picks.length > 0
    ? { kind: "combos", combos: row.picks.map((p) => p.combo) }
    : undefined;

/** 1 レース分の穴予想の買い目を、買い目スタイル別 → 状態別に引ける形。 */
export type AnaPicksSlot = { readonly daily?: AnaPicksRow; readonly realtime?: AnaPicksRow };
export type AnaPicksByStyle = {
  readonly suji?: AnaPicksSlot;
  readonly kimarite?: AnaPicksSlot;
};

const buildPredictorPrediction = (
  predictor: PredictorSpec,
  racers: readonly RaceRacer[],
  dailyIdx: IndexRow | undefined,
  realtimeIdx: IndexRow | undefined,
  result: RaceResultRow | undefined,
  payout: RacePayoutRow | undefined,
  anaPicks?: AnaPicksByStyle,
): PredictorPrediction => {
  const aiEvaluationDaily = dailyIdx ? buildAiEvaluation(dailyIdx) : undefined;
  const aiEvaluationRealtime = realtimeIdx ? buildAiEvaluation(realtimeIdx) : undefined;

  const tolerance = bettingToleranceFor(predictor.id);
  // useEstimatedST な予想者 (v5_slit / v7_aggregate) のみ AI 推定 ST を距離計算に
  // 使う (他予想者は従来どおり全国平均 ST)。web の BettingPicks.astro と同じ
  // ヘルパーで解決し、表示される買い目と集計対象の買い目を一致させる。
  const stOptions = oneMarkDistanceOptionsFor(predictor.id);
  // strengthOnlyBetting な予想者 (v8_aionly) は走行距離ではなく強さpt のみで
  // 候補を選定する (basis="strength"、しきい値 ±5.0pt)。
  const basis = bettingBasisFor(predictor.id);
  // 穴予想 (v9_suji = "suji" / v10_kimarite = "kimarite") は fun-site で
  // 買い目を計算しない。boatracecsv が確定させた出目をそのまま使う
  // (フォーメーションでは表現できない出目集合のため)。どちらの CSV を読むかは
  // bettingStyle が決め、以降の表示・集計の経路は共通。
  const style = bettingStyleFor(predictor.id);
  const ana = style === "formation" ? undefined : anaPicks?.[style];
  const dailyPicks =
    style !== "formation"
      ? toComboPicks(ana?.daily)
      : aiEvaluationDaily
        ? computeBettingPicks(
            computeOneMarkDistances(racers, aiEvaluationDaily, stOptions),
            tolerance,
            basis,
          )
        : undefined;
  const realtimePicks =
    style !== "formation"
      ? toComboPicks(ana?.realtime)
      : aiEvaluationRealtime
        ? computeBettingPicks(
            computeOneMarkDistances(racers, aiEvaluationRealtime, stOptions),
            tolerance,
            basis,
          )
        : undefined;
  const betHitStatus = checkBettingHit(result, dailyPicks, realtimePicks);
  const betPayout = computeRaceBetPayoutSummary(dailyPicks, realtimePicks, result, payout);
  // 採点した買い目そのものを載せる。web はこれを描画するので、表示と集計が
  // 食い違わない (穴予想は CSV 由来で web 側から再計算できないため必須)。
  const marks = (row: AnaPicksRow | undefined): readonly string[] | undefined =>
    row ? row.picks.map((p) => p.kimarite) : undefined;

  return {
    dailyPicks,
    realtimePicks,
    dailyKimarite: marks(ana?.daily),
    realtimeKimarite: marks(ana?.realtime),
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
  racerSt: RacerStRow | undefined,
  tkz: TkzRow | undefined,
  sui: SuiRow | undefined,
  origEx: OriginalExhibitionRow | undefined,
  recentNational: RecentFormRow | undefined,
  recentLocal: RecentFormRow | undefined,
  waku10Row: Waku10Row | undefined,
  tokutenHayamiRow: TokutenHayamiRow | undefined,
  motorStatsByKey: ReadonlyMap<string, MotorStats>,
  indexRowsByPredictor: ReadonlyMap<
    string,
    { readonly daily?: IndexRow; readonly realtime?: IndexRow }
  >,
  title: TitleRow | undefined,
  result: RaceResultRow | undefined,
  payout: RacePayoutRow | undefined,
  generatedAt: string,
  /** 穴予想の買い目。買い目スタイル (suji / kimarite) ごとに daily / realtime。 */
  anaPicks?: AnaPicksByStyle,
  /** 荒れ度メーター (estimate/kimarite)。daily / realtime それぞれ。 */
  kimariteRows?: { readonly daily?: KimariteRow; readonly realtime?: KimariteRow },
): RacePrediction => {
  const parsed = parseRaceCode(cards.raceCode);
  const stadium = getStadiumById(parsed.stadiumId);
  // title CSV の "ボートレース桐生" 形式は prefix を取り除き正規名に揃える
  const stadiumName =
    stadium?.name ?? title?.stadium?.replace(/^ボートレース/, "") ?? parsed.stadiumId;

  const racers = toRaceRacers(cards, parsed.stadiumId, motorStatsByKey, racerSt);

  // active 予想者ごとに PredictorPrediction を作成
  const predictors = activePredictors();
  const predictions: PredictorPrediction[] = predictors.map((p) => {
    const rows = indexRowsByPredictor.get(p.id) ?? {};
    return buildPredictorPrediction(p, racers, rows.daily, rows.realtime, result, payout, anaPicks);
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

  const preview = buildRacePreview(tkz, sui, origEx);
  const recentForm = buildRecentForm(recentNational, recentLocal);
  const waku10 = buildWaku10(waku10Row);
  const tokutenHayami = buildTokutenHayami(tokutenHayamiRow);

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
    startPrediction: buildStartPrediction(racers, stt, false),
    ...(racers.some((r) => r.estimatedST !== undefined)
      ? { startPredictionEstimated: buildStartPrediction(racers, stt, true) }
      : {}),
    ...(preview !== undefined ? { preview } : {}),
    ...(recentForm !== undefined ? { recentForm } : {}),
    ...(waku10 !== undefined ? { waku10 } : {}),
    ...(tokutenHayami !== undefined ? { tokutenHayami } : {}),
    aiEvaluation,
    aiEvaluationDaily,
    aiEvaluationRealtime,
    raceResult: result,
    racePayout: payout,
    betHitStatus,
    ...(betPayout !== undefined ? { betPayout } : {}),
    predictions,
    // 荒れ度メーター (レース単位)。CSV が無ければ undefined のまま。
    upsetMeter: ((): UpsetMeter | undefined => {
      const d = kimariteRows?.daily?.upsetRate;
      const rt = kimariteRows?.realtime?.upsetRate;
      return d === undefined && rt === undefined ? undefined : { daily: d, realtime: rt };
    })(),
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
  racerSt: readonly RacerStRow[],
  suji: readonly AnaPicksRow[],
  kimaritePicks: readonly AnaPicksRow[],
  kimarite: readonly KimariteRow[],
  tkz: readonly TkzRow[],
  sui: readonly SuiRow[],
  originalExhibition: readonly OriginalExhibitionRow[],
  recentNational: readonly RecentFormRow[],
  recentLocal: readonly RecentFormRow[],
  waku10: readonly Waku10Row[],
  tokutenHayami: readonly TokutenHayamiRow[],
  motorStats: readonly MotorStatsRow[],
  indexesByPredictor: readonly PredictorIndexFetch[],
  titles: readonly TitleRow[],
  results: readonly RaceResultRow[],
  payouts: readonly RacePayoutRow[],
  generatedAt: string,
): RacePrediction[] => {
  const sttByCode = new Map(stt.map((s) => [s.raceCode, s]));
  const racerStByCode = new Map(racerSt.map((r) => [r.raceCode, r]));
  const tkzByCode = new Map(tkz.map((t) => [t.raceCode, t]));
  const suiByCode = new Map(sui.map((s) => [s.raceCode, s]));
  const origExByCode = new Map(originalExhibition.map((o) => [o.raceCode, o]));
  const recentNationalByCode = new Map(recentNational.map((r) => [r.raceCode, r]));
  const recentLocalByCode = new Map(recentLocal.map((r) => [r.raceCode, r]));
  const waku10ByCode = new Map(waku10.map((w) => [w.raceCode, w]));
  const tokutenHayamiByCode = new Map(tokutenHayami.map((t) => [t.raceCode, t]));
  const motorStatsByKey = buildMotorStatsLookup(motorStats);
  const titleByCode = new Map(titles.map((t) => [t.raceCode, t]));
  const resultByCode = new Map(results.map((r) => [r.raceCode, r]));
  const payoutByCode = new Map(payouts.map((p) => [p.raceCode, p]));
  // 穴予想の買い目。1 レースにつき daily / realtime の 2 行が来る。
  // A案 (suji) と B案 (kimarite) を 1 つの Map にまとめ、予想者側は
  // bettingStyle で自分のぶんだけ引く。
  const anaByCode = new Map<string, { suji?: AnaPicksSlot; kimarite?: AnaPicksSlot }>();
  const putAna = (style: "suji" | "kimarite", rows: readonly AnaPicksRow[]): void => {
    for (const row of rows) {
      const entry = anaByCode.get(row.raceCode) ?? {};
      anaByCode.set(row.raceCode, {
        ...entry,
        [style]: { ...entry[style], [row.state]: row },
      });
    }
  };
  putAna("suji", suji);
  putAna("kimarite", kimaritePicks);
  // 荒れ度メーター。同じく 1 レースにつき daily / realtime の 2 行。
  const kimariteByCode = new Map<string, { daily?: KimariteRow; realtime?: KimariteRow }>();
  for (const row of kimarite) {
    const slot = kimariteByCode.get(row.raceCode) ?? {};
    kimariteByCode.set(row.raceCode, { ...slot, [row.state]: row });
  }

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
      racerStByCode.get(cards.raceCode),
      tkzByCode.get(cards.raceCode),
      suiByCode.get(cards.raceCode),
      origExByCode.get(cards.raceCode),
      recentNationalByCode.get(cards.raceCode),
      recentLocalByCode.get(cards.raceCode),
      waku10ByCode.get(cards.raceCode),
      tokutenHayamiByCode.get(cards.raceCode),
      motorStatsByKey,
      indexLookup.get(cards.raceCode) ?? new Map(),
      titleByCode.get(cards.raceCode),
      resultByCode.get(cards.raceCode),
      payoutByCode.get(cards.raceCode),
      generatedAt,
      anaByCode.get(cards.raceCode),
      kimariteByCode.get(cards.raceCode),
    ),
  );
};
