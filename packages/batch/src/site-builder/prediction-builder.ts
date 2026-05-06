import type {
  AiEvaluation,
  AiEvaluationEntry,
  IndexRow,
  ProgramRow,
  RaceCardRacer,
  RaceCardRow,
  RacePrediction,
  RaceRacer,
  StartPrediction,
  StartPredictionEntry,
  SttRow,
} from "@fun-site/shared";
import { getStadiumById, parseRaceCode } from "@fun-site/shared";

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

/** race_cards / stt / index / programs を 1 レース分の RacePrediction に統合 */
export const buildRacePrediction = (
  cards: RaceCardRow,
  stt: SttRow | undefined,
  idx: IndexRow | undefined,
  program: ProgramRow | undefined,
  generatedAt: string,
): RacePrediction => {
  const parsed = parseRaceCode(cards.raceCode);
  const stadium = getStadiumById(parsed.stadiumId);
  // programs CSV の "ボートレース桐生" 形式は prefix を取り除き正規名に揃える
  const stadiumName =
    stadium?.name ?? program?.stadium?.replace(/^ボートレース/, "") ?? parsed.stadiumId;

  return {
    raceCode: cards.raceCode,
    raceDate: cards.raceDate,
    stadiumId: parsed.stadiumId,
    stadiumName,
    raceNumber: parsed.raceNumber,
    raceName: program?.raceName ?? "",
    raceTitle: program?.title ?? "",
    votingDeadline: program?.votingDeadline ?? stt?.votingDeadline ?? "",
    racers: toRaceRacers(cards),
    startPrediction: buildStartPrediction(cards, stt),
    aiEvaluation: idx ? buildAiEvaluation(idx) : buildEmptyAiEvaluation(),
    generatedAt,
  };
};

/** 当日分の全 race_cards を起点に RacePrediction を組み立てる */
export const buildAllRacePredictions = (
  raceCards: readonly RaceCardRow[],
  stt: readonly SttRow[],
  indexes: readonly IndexRow[],
  programs: readonly ProgramRow[],
  generatedAt: string,
): RacePrediction[] => {
  const sttByCode = new Map(stt.map((s) => [s.raceCode, s]));
  const indexByCode = new Map(indexes.map((i) => [i.raceCode, i]));
  const programByCode = new Map(programs.map((p) => [p.raceCode, p]));

  return raceCards.map((cards) =>
    buildRacePrediction(
      cards,
      sttByCode.get(cards.raceCode),
      indexByCode.get(cards.raceCode),
      programByCode.get(cards.raceCode),
      generatedAt,
    ),
  );
};
