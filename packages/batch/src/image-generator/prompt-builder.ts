import type { RacePrediction } from "@fun-site/shared";
import {
  BOAT_COLORS,
  WINNING_TECHNIQUES,
  getStadiumByName,
  isValidBoatNumber,
} from "@fun-site/shared";

const boatColorDescriptions = Object.entries(BOAT_COLORS)
  .map(([num, color]) => `${num}号艇(${color.name} ${color.hex})`)
  .join(", ");

/** 画像生成プロンプトを構築 */
export const buildImagePrompt = (prediction: RacePrediction): string => {
  const stadium = getStadiumByName(prediction.stadium);
  const stadiumName = stadium?.name ?? prediction.stadium;
  const techniqueName =
    WINNING_TECHNIQUES[prediction.aiPrediction.predictedTechnique] ??
    prediction.aiPrediction.predictedTechnique;

  const courseEntries = [...prediction.aiPrediction.startFormation.entries]
    .sort((a, b) => a.courseNumber - b.courseNumber)
    .map((entry) => {
      const color = isValidBoatNumber(entry.boatNumber) ? BOAT_COLORS[entry.boatNumber] : undefined;
      return `- コース${entry.courseNumber}: ${entry.boatNumber}号艇(${color?.name ?? "不明"}) ST${entry.predictedST.toFixed(2)}秒`;
    })
    .join("\n");

  return `ボートレースの展開予想図を生成してください。鳥瞰図の視点で、以下の要素を含めてください。

【レイアウト】
- 水面を上から見た図（青い水面）
- 左側にスタートライン、右側に1マーク（ターンマーク）
- 反時計回りのコースレイアウト

【スタート隊形と各艇の配置】
${courseEntries}

【6艇の色は厳密に】
${boatColorDescriptions}

【予想展開】
- 予想決まり手: ${techniqueName}
- 予想着順: ${prediction.aiPrediction.predictedOrder.join("-")}
- ${prediction.aiPrediction.firstTurnScenario}

【表示テキスト】
- 各艇に番号ラベルのみ（日本語テキストは不要）

【スタイル】
- スポーツ解説図風のクリーンなイラスト
- 矢印で各艇の進行方向と展開を示す
- 背景は濃い青のグラデーション
- ${stadiumName} ${prediction.raceNumber}R の展開予想図`;
};

/** SVG生成用プロンプトを構築 */
export const buildSvgPrompt = (prediction: RacePrediction): string => {
  const stadium = getStadiumByName(prediction.stadium);
  const stadiumName = stadium?.name ?? prediction.stadium;
  const techniqueName =
    WINNING_TECHNIQUES[prediction.aiPrediction.predictedTechnique] ??
    prediction.aiPrediction.predictedTechnique;

  const courseEntries = [...prediction.aiPrediction.startFormation.entries]
    .sort((a, b) => a.courseNumber - b.courseNumber)
    .map((entry) => {
      const color = isValidBoatNumber(entry.boatNumber) ? BOAT_COLORS[entry.boatNumber] : undefined;
      return `コース${entry.courseNumber}: ${entry.boatNumber}号艇(${color?.name ?? "不明"}, ${color?.hex ?? "#999"})`;
    })
    .join("\n");

  return `以下の仕様でボートレース展開予想のSVGコードを生成してください。SVGコードのみを出力し、他のテキストは含めないでください。

仕様:
- サイズ: 800x450
- 背景: 水面を表す青のグラデーション (#1a2980 → #26d0ce)
- 左にスタートライン（白の縦線）、右に1マーク（オレンジの丸）
- 反時計回りのコースレイアウト
- 6艇を円で描画（各艇の色は指定通り）
- 矢印で進行方向を示す

進入コース:
${courseEntries}

予想決まり手: ${techniqueName}
予想着順: ${prediction.aiPrediction.predictedOrder.join("-")}

タイトル: ${stadiumName} ${prediction.raceNumber}R

SVGのみ出力してください（\`\`\`は不要）:`;
};
