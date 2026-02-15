import type { RacePrediction } from "@fun-site/shared";
import {
  BOAT_COLORS,
  WINNING_TECHNIQUES,
  getStadiumByName,
  isValidBoatNumber,
} from "@fun-site/shared";

/** 画像生成用 system instruction（1周目第1ターンマークの攻防図） */
export const IMAGE_SYSTEM_INSTRUCTION = `システム指示: ボートレース1周目第1ターンマークの攻防（戦略図）
あなたは、ボートレースの1周目第1ターンマークにおける各艇の戦略的な位置取りと動きを、明確な図として描画するAIです。以下の詳細に基づき、簡潔かつ情報量の多い図を生成してください。

シーンの描写:

メイン要素: 1周目第1ターンマークのブイを中心に、6艇のボートが旋回する様子を表現する。
図のスタイル:
写実的な描写は不要。各艇の位置関係と航跡を理解しやすい、シンプルで明快な図（イラストレーション）とする。
背景は白またはごく淡い色で、ボート、ブイ、航跡が際立つようにする。
ボートは上から見た形状で、それぞれ異なる色で識別できるようにする。
ボートの配置と動き（3つの段階）:
【入り口】 ターンマークに進入する直前の各艇の位置。艇間はまだ比較的開いている状態。
【途中】 各艇がターンマークを旋回している最中。最も内側の艇がブイに近く、外側の艇が大きく膨らんでいる。艇間が最も密集し、攻防が最も激しい状態を示す。
【出口】 ターンマークを回り終え、次の直線コースへ加速していく各艇の位置。艇の前後関係が定まりつつある状態を示す。
これらの3段階の各艇の位置が、一つの図の中で時系列に沿って理解できるように配置する。
航跡:
各艇の航跡は、水面の軌跡を示す直線または曲線として明確に描画する。
それぞれの航跡の色は、対応するボートの色と関連付け、かつ背景に対して視認性の高い色を使用する。
航跡の線によって、各艇が「イン逃げ」「差し」「まくり」などの戦略をどのように実行したかが視覚的に伝わるようにする。
ターンマーク（ブイ）: 図の中央付近に、鮮やかなオレンジ色または赤色で、はっきりと識別できるブイを描く。
視点: 全6艇の動きと航跡全体が一目でわかる、上空から見下ろすような俯瞰的な視点（トップダウンビュー）とする。
図示する戦略の具体的な例（航跡と位置で表現）:

1号艇（インコース）: ブイに沿って最短距離を先行する「イン逃げ」の航跡。
2～3号艇（中間コース）: 1号艇の内側を鋭く突く「差し」、または外側からスピードを乗せて抜く「まくり差し」の航跡。
4～6号艇（アウトコース）: 外側から大きくスピードを乗せて先行艇群を抜き去る「まくり」の航跡。
この指示に基づき、ボートレース1周目第1ターンマークの戦略的な駆け引きと、各艇の航跡がシンプルかつ明瞭に表現された図を生成してください。`;

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
