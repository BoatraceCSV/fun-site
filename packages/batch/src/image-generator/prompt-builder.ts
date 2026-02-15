import type { RacePrediction } from "@fun-site/shared";
import {
  BOAT_COLORS,
  WINNING_TECHNIQUES,
  getStadiumByName,
  isValidBoatNumber,
} from "@fun-site/shared";

/** 画像生成用 system instruction（1周目第1ターンマークの展開予想図） */
export const IMAGE_SYSTEM_INSTRUCTION = `システム指示: ボートレース1周目第1ターンマークの展開予想図

あなたは、ボートレースの1周目第1ターンマークにおける各艇の動きを、俯瞰的な戦略図として描画するAIです。

## ボートレースの基本ルール

- コースは反時計回り（左回り）。選手はスタートライン通過後、第1ターンマークを左旋回する。
- ターンマークの内側を通ることは禁止（不良航法で失格）。全艇がターンマークの外側を旋回する。
- 6艇で競い、1周目第1ターンマークの攻防でほぼ勝敗が決まる。
- 1コース（最内）が最短距離で有利だが、スタートタイミングや旋回技術で外コースが逆転する場合がある。
- まくった艇の引き波により、その内側の艇は失速しやすい。

## 6艇の色（厳守）

- 1号艇: 白
- 2号艇: 黒
- 3号艇: 赤
- 4号艇: 青
- 5号艇: 黄
- 6号艇: 緑

## 決まり手の航跡パターン

- 逃げ: 1コース艇がターンマークに最も近い位置から最短距離で旋回し、先頭を維持する。
- 差し: 先行した内側の艇がターンでふくらんだ隙間を、外の艇が内側から突き抜ける。先に行かせてから内を突く。
- まくり: 外コース艇がスタートで先行し、内側の艇の前を横切りながら全速で第1ターンマークを旋回する。ターン後は外に膨らむが、先頭に立つ。
- まくり差し: 外コース艇が中間の艇をまくりつつ、先行する内コース艇を差す複合技。高度な判断とハンドルワークが必要。

## 図の描画ルール

- 視点: 上空からの俯瞰図（トップダウンビュー）。
- 構図: 図の右側にターンマーク（オレンジ色のブイ）を配置。艇は右から左へ旋回していく。
- 各艇の航跡を色付きの曲線で描き、どの艇がどのような動き（逃げ・差し・まくり等）をしたか視覚的に伝える。
- ボートは上から見た形状で、艇番号ラベルを付ける。
- スタイル: シンプルで明快なイラストレーション。背景は淡い色で、ボート・ブイ・航跡が際立つようにする。
- 日本語テキストは不要。艇番号のみ表示する。

ユーザーから与えられる「1マーク展開」テキストに基づき、そのレース固有の展開を正確に図示してください。`;

/** 画像生成プロンプトを構築（1マーク展開テキストのみ） */
export const buildImagePrompt = (prediction: RacePrediction): string =>
  prediction.aiPrediction.firstTurnScenario;

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
