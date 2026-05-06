/**
 * 的中実績ページ (web/src/pages/stats.astro) で使用する集計型。
 *
 * 旧 batch コード（predictor / image-generator / quality-checker）由来の
 * 予想・画像系の型は CSV 生成停止に伴い削除済み。
 * `content/stats/accuracy.json` のスキーマだけここに残している。
 */

export type MlAccuracy = {
  readonly hit1st: number;
  readonly hitAll: number;
  readonly hitTechnique: number;
  readonly avgCourseMatch: number;
  readonly avgSTMAE: number;
};

export type AiAccuracy = {
  readonly hit1st: number;
  readonly hitTrifecta: number;
  readonly hitTechnique: number;
};

export type AccuracyStats = {
  readonly period: string;
  readonly totalRaces: number;
  readonly ml: MlAccuracy;
  readonly ai: AiAccuracy;
};
