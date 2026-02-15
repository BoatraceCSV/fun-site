import type { RacePrediction } from "@fun-site/shared";
import {
  BOAT_COLORS,
  WINNING_TECHNIQUES,
  getStadiumByName,
  isValidBoatNumber,
} from "@fun-site/shared";

/** 画像生成用 system instruction（1周目第1ターンマークの展開予想図） */
export const IMAGE_SYSTEM_INSTRUCTION = `システム指示: ボートレース展開予想図の描画

競艇予想サイトに掲載されるような、シンプルな2Dの図解イラストを生成してください。

## 図のレイアウト（厳守）

1. 背景は均一な水色。装飾・波・光沢は不要。
2. 図の中央に小さな赤白のブイ（ターンマーク）を置く。
3. 図の下部にボートの「進入位置」を横一列に並べる。右端が1コース（ブイに最も近い）、左端が外コース。
4. 図の上部にボートの「ターン後の位置」を描く。先頭艇が最も上。
5. 進入位置のボートとターン後のボートを、太い色付き曲線（航跡）で結ぶ。
6. 航跡の曲がる向き: 進入位置（下）→ ブイの右側を通過 → ブイの上を通って左へ → ターン後位置（上）。
   つまり航跡はブイを「上から見て反時計回り（左回り）」に巻く。絶対に時計回り（右回り）にしないこと。
7. ボートは上から見た船形シルエットで、中に大きく艇番号を書く。
8. 主要な3〜4艇のみ描画する。全6艇は不要。

## ボートの色（厳守・番号と色は必ず一致させること）

- 1号艇のボートと航跡は「白」
- 2号艇のボートと航跡は「黒」
- 3号艇のボートと航跡は「赤」
- 4号艇のボートと航跡は「青」
- 5号艇のボートと航跡は「黄」
- 6号艇のボートと航跡は「緑」

## 決まり手による航跡の違い

- 逃げ: ブイに最も近い小さなカーブ。
- 差し: 先行艇がふくらんだ隙間を内から突く。
- まくり: 外から大きくスピードで回り込む。航跡は大きなカーブ。
- まくり差し: 途中まで外を回り、最後に内へ切り込む。

ユーザーのテキストに基づいてレース展開を図示してください。`;

/** 画像生成プロンプトを構築 */
export const buildImagePrompt = (prediction: RacePrediction): string => {
  const courseEntries = [...prediction.aiPrediction.startFormation.entries]
    .sort((a, b) => a.courseNumber - b.courseNumber)
    .map((entry) => {
      const color = isValidBoatNumber(entry.boatNumber) ? BOAT_COLORS[entry.boatNumber] : undefined;
      return `${entry.courseNumber}コース: ${entry.boatNumber}号艇(${color?.name ?? "不明"})`;
    })
    .join(", ");

  return `${prediction.aiPrediction.firstTurnScenario}

進入隊形: ${courseEntries}`;
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
