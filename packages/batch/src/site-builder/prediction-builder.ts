import type {
  AiEvaluation,
  AiEvaluationEntry,
  BetHitStatus,
  IndexRow,
  RaceCardRacer,
  RaceCardRow,
  RacePrediction,
  RaceRacer,
  RaceResultRow,
  StartPrediction,
  StartPredictionEntry,
  SttRow,
  TitleRow,
} from "@fun-site/shared";
import {
  checkBettingHit,
  computeBettingPicks,
  computeOneMarkDistances,
  getStadiumById,
  parseRaceCode,
} from "@fun-site/shared";

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

/** index 行から AI 総合評価を構築。state=daily の場合は展示・気象を 0 に揃える */
const buildAiEvaluation = (idx: IndexRow): AiEvaluation => {
  const entries: AiEvaluationEntry[] = idx.entries.map((e) => {
    const isDaily = idx.state === "daily";
    return {
      boatNumber: e.boatNumber,
      contribution: {
        frame: e.framePtContribution,
        racer: e.racerPtContribution,
        motor: e.motorPtContribution,
        exhibition: isDaily ? 0 : e.exhibitionPtContribution,
        weather: isDaily ? 0 : e.weatherPtContribution,
      },
      strengthPt: e.strengthPt,
    };
  });
  return {
    state: idx.state,
    entries: entries.toSorted((a, b) => a.boatNumber - b.boatNumber),
  };
};

/** index が無いレース用の中立な AI 評価（全枠 0） */
const buildEmptyAiEvaluation = (): AiEvaluation => ({
  state: "daily",
  entries: Array.from({ length: BOAT_COUNT }, (_, i) => ({
    boatNumber: i + 1,
    contribution: { frame: 0, racer: 0, motor: 0, exhibition: 0, weather: 0 },
    strengthPt: 0,
  })),
});

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

/** race_cards / stt / index / programs/title / results を 1 レース分の RacePrediction に統合
 *
 * `dailyIdx` は朝バッチの index 行（直前情報反映前）、`realtimeIdx` は直前情報反映後の
 * index 行。両方が同一レースに存在する場合があり、`aiEvaluationDaily` /
 * `aiEvaluationRealtime` にそれぞれ格納する。`aiEvaluation` は後方互換用に realtime を
 * 優先し、無ければ daily を、それも無ければ空評価を採用する。
 */
export const buildRacePrediction = (
  cards: RaceCardRow,
  stt: SttRow | undefined,
  dailyIdx: IndexRow | undefined,
  realtimeIdx: IndexRow | undefined,
  title: TitleRow | undefined,
  result: RaceResultRow | undefined,
  generatedAt: string,
): RacePrediction => {
  const parsed = parseRaceCode(cards.raceCode);
  const stadium = getStadiumById(parsed.stadiumId);
  // title CSV の "ボートレース桐生" 形式は prefix を取り除き正規名に揃える
  const stadiumName =
    stadium?.name ?? title?.stadium?.replace(/^ボートレース/, "") ?? parsed.stadiumId;

  const aiEvaluationDaily = dailyIdx ? buildAiEvaluation(dailyIdx) : undefined;
  const aiEvaluationRealtime = realtimeIdx ? buildAiEvaluation(realtimeIdx) : undefined;
  const aiEvaluation = aiEvaluationRealtime ?? aiEvaluationDaily ?? buildEmptyAiEvaluation();

  // 当日 / 直前それぞれの買い目フォーメーションを 1 度だけ算出し、
  // 結果が確定していれば的中状態を計算する。BettingPicks コンポーネントと
  // 同じ計算式 (computeOneMarkDistances → computeBettingPicks) を使う。
  const racers = toRaceRacers(cards);
  const dailyPicks = aiEvaluationDaily
    ? computeBettingPicks(computeOneMarkDistances(racers, aiEvaluationDaily))
    : undefined;
  const realtimePicks = aiEvaluationRealtime
    ? computeBettingPicks(computeOneMarkDistances(racers, aiEvaluationRealtime))
    : undefined;
  const betHitStatus: BetHitStatus = checkBettingHit(result, dailyPicks, realtimePicks);

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
    betHitStatus,
    generatedAt,
  };
};

/** 当日分の全 race_cards を起点に RacePrediction を組み立てる
 *
 * `indexes` には同一 raceCode で state="daily" / "realtime" の 2 行が混在し得る。
 * 状態ごとに Map を分けることで両方の AI 評価を保持する。
 */
export const buildAllRacePredictions = (
  raceCards: readonly RaceCardRow[],
  stt: readonly SttRow[],
  indexes: readonly IndexRow[],
  titles: readonly TitleRow[],
  results: readonly RaceResultRow[],
  generatedAt: string,
): RacePrediction[] => {
  const sttByCode = new Map(stt.map((s) => [s.raceCode, s]));
  const dailyIndexByCode = new Map(
    indexes.filter((i) => i.state === "daily").map((i) => [i.raceCode, i]),
  );
  const realtimeIndexByCode = new Map(
    indexes.filter((i) => i.state === "realtime").map((i) => [i.raceCode, i]),
  );
  const titleByCode = new Map(titles.map((t) => [t.raceCode, t]));
  const resultByCode = new Map(results.map((r) => [r.raceCode, r]));

  return raceCards.map((cards) =>
    buildRacePrediction(
      cards,
      sttByCode.get(cards.raceCode),
      dailyIndexByCode.get(cards.raceCode),
      realtimeIndexByCode.get(cards.raceCode),
      titleByCode.get(cards.raceCode),
      resultByCode.get(cards.raceCode),
      generatedAt,
    ),
  );
};
