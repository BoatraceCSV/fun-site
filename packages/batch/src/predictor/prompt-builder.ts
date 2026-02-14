import type { EstimateRow, PredictionPreviewRow, ProgramRow } from "@fun-site/shared";
import { WINNING_TECHNIQUES, getBoatColor, isValidBoatNumber } from "@fun-site/shared";

const formatBoatInfo = (program: ProgramRow): string => {
  return program.boats
    .map((boat) => {
      if (!isValidBoatNumber(boat.boatNumber)) return "";
      const color = getBoatColor(boat.boatNumber);
      return [
        `${boat.boatNumber}号艇(${color.name}): ${boat.racerName}`,
        `  級別: ${boat.rank}, 全国勝率: ${boat.nationalWinRate}, 当地勝率: ${boat.localWinRate}`,
        `  モーター2連率: ${boat.motorTop2Rate}%, ボート2連率: ${boat.boatTop2Rate}%`,
        `  今節成績: ${boat.currentResults.join(", ") || "なし"}`,
      ].join("\n");
    })
    .join("\n\n");
};

const formatPredictionPreview = (preview: PredictionPreviewRow | undefined): string => {
  if (!preview) return "ML展示会予測データなし";
  return preview.boats
    .map(
      (boat) =>
        `${boat.boatNumber}号艇: コース${boat.predictedCourse}, ST${boat.predictedStartTiming.toFixed(3)}, 展示タイム${boat.predictedExhibitionTime.toFixed(2)}`,
    )
    .join("\n");
};

const formatEstimate = (estimate: EstimateRow | undefined): string => {
  if (!estimate) return "ML着順予想データなし";
  const lines = [
    `予想着順: ${estimate.predicted1st}-${estimate.predicted2nd}-${estimate.predicted3rd}`,
    `予想決まり手: ${estimate.predictedTechnique}`,
    "",
    ...estimate.boats.map(
      (boat) =>
        `${boat.boatNumber}号艇: 予想コース${boat.predictedCourse}, 予想ST${boat.predictedST.toFixed(3)}`,
    ),
  ];
  return lines.join("\n");
};

const winningTechniqueList = Object.entries(WINNING_TECHNIQUES)
  .map(([key, name]) => `"${key}" (${name})`)
  .join(", ");

/** 予想分析プロンプトを構築 */
export const buildAnalysisPrompt = (
  program: ProgramRow,
  predictionPreview: PredictionPreviewRow | undefined,
  estimate: EstimateRow | undefined,
): string => {
  return `あなたはボートレースの展開予想の専門家です。
以下の出走表データとML予測結果を分析し、レース展開を予想してください。

## レース情報
- 会場: ${program.stadium}
- レース: ${program.raceNumber}R ${program.raceName}
- 日付: ${program.raceDate}

## 出走表データ
${formatBoatInfo(program)}

## ML予測: 展示会予測 (Prediction Previews)
${formatPredictionPreview(predictionPreview)}

## ML予測: 着順予想 (Estimates)
${formatEstimate(estimate)}

## 分析のポイント
- ML予測の進入コースとSTをベースにスタート隊形を推定
- 級別・勝率・モーター成績から各艇の実力を評価
- 展開パターン（逃げ、差し、まくり、まくり差し、抜き、恵まれ）を判定
- 信頼度は 0.0〜1.0 で、予想の確実性を表す

## 出力形式（JSON）
以下の形式で出力してください。他のテキストは含めないでください。

{
  "startFormation": {
    "entries": [
      {"boatNumber": 1, "courseNumber": 1, "predictedST": 0.15},
      {"boatNumber": 2, "courseNumber": 2, "predictedST": 0.18}
    ],
    "pattern": "flat"
  },
  "firstTurnScenario": "1号艇がインから好スタートを決め...",
  "predictedTechnique": "nige",
  "predictedOrder": [1, 3, 4, 2, 5, 6],
  "confidence": 0.72,
  "narrative": "展開の解説テキスト...",
  "suggestedBets": ["1-3-4", "1-4-3", "1-3-2"]
}

注意:
- startFormation.entries は6艇すべて含めてください
- startFormation.pattern は "flat"（横一線）、"inner-late"（内凹み）、"middle-late"（中凹み）、"outer-late"（外凹み）のいずれか
- predictedTechnique は ${winningTechniqueList} のいずれか
- predictedOrder は6艇すべての着順予想（艇番の配列）
- suggestedBets は3連単の買い目（5〜10点）`;
};
