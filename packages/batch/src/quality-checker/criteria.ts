/** 品質チェックの判定基準 */

export const QUALITY_THRESHOLD = 70;
export const MAX_RETRY_COUNT = 2;

export const QUALITY_CRITERIA = [
  "6艇すべてが描画されているか",
  "各艇の色が正しいか（1白, 2黒, 3赤, 4青, 5黄, 6緑）",
  "水面・コースのレイアウトが適切か",
  "テキスト（艇番ラベル）が読み取り可能か",
  "全体のレイアウトが破綻していないか",
  "予想テキストの内容と画像の配置が矛盾していないか",
] as const;

export type QualityCheckResult = {
  readonly passed: boolean;
  readonly score: number;
  readonly issues: readonly string[];
  readonly retryInstruction: string;
};
