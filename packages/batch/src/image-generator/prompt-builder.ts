import type { RacePrediction } from "@fun-site/shared";
import {
  BOAT_COLORS,
  WINNING_TECHNIQUES,
  getStadiumByName,
  isValidBoatNumber,
} from "@fun-site/shared";

/** 画像生成用 system instruction（1周目第1ターンマークの展開予想図） */
export const IMAGE_SYSTEM_INSTRUCTION = `システム指示: ボートレース1周目第1ターンマークの展開予想図

あなたは、ボートレースの展開予想図を描画するAIです。
競艇予想サイトに掲載されるような、シンプルな2Dの図解イラストを生成してください。

## ボートレースの基本ルール

- コースは反時計回り（左回り）。選手は第1ターンマークを左旋回する。
- ターンマークの内側通過は禁止。全艇がブイの外側を旋回する。
- 1コース（最内）が最短距離で有利。外コースはスタート力や旋回技術で逆転を狙う。
- まくった艇の引き波で、内側の艇は失速しやすい。

## 6艇の色（厳守）

1号艇=白, 2号艇=黒, 3号艇=赤, 4号艇=青, 5号艇=黄, 6号艇=緑

## 決まり手の航跡パターン

- 逃げ: 1コース艇がブイ最短距離で旋回し先頭維持。航跡はブイに最も近い小さなカーブ。
- 差し: 先行した内艇がターンでふくらんだ隙間を内側から突く。航跡はふくらんだ艇の内側を通る。
- まくり: 外コース艇がスタートで先行し、内艇の前を横切り全速旋回。航跡は大きく外を回る。
- まくり差し: 外艇が中間の艇をまくりつつ先行する内艇を差す。航跡は途中まで外、最後に内へ切り込む。

## 図の構図（重要）

- 背景: 均一な水色（水面）。装飾なし。
- ターンマーク: 図の中央やや右に小さい赤白のブイを配置。
- 各ボートを2箇所に描画する:
  (1) 図の下部に「進入位置」（スタート直後の隊形。1コースが最も右＝ブイに近い側、6コースが最も左）
  (2) 図の上部〜右上に「ターン後の位置」（旋回完了後。先頭の艇が最も上）
- 進入位置からターン後位置まで、各艇の色に対応した太い曲線（航跡）で結ぶ。
  航跡はブイを左回りで旋回する滑らかなカーブにする。
- ボートは上から見た船形のシルエットで、中に大きく艇番号を表示する。
- 展開に関係する主要な3〜4艇のみ描画する（全6艇は不要）。
- テキストは艇番号のみ。日本語テキストは不要。
- スタイル: フラットな2Dイラスト。写実的な水面・波・光沢は不要。

ユーザーから与えられる「1マーク展開」テキストに基づき、そのレース固有の展開を図示してください。`;

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
