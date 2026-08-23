import type { ExhibitPtBasis } from "@fun-site/shared";
import { getStadiumByName } from "@fun-site/shared";
import type { StadiumWeightsFetch } from "../fetcher/index.js";

/**
 * 展示pt の根拠を場ごとに組み立てる。
 *
 * 枠番pt / 気象pt と違って **突き合わせる静的テーブルが無い**。展示pt の生値は
 * 「展示タイム + オリジナル展示 1〜3 をレース内で偏差値化して等重み平均した値」で、
 * そのレースの直前情報（レース JSON の `preview`）だけで閉じているためである。
 * したがってここでやるのは weights CSV の 展示pt 成分を場コードキーに読み替える
 * だけになる。
 *
 * weights が取れなかったときは空 Map を返す（画面側は undefined で
 * 「根拠テーブル未取得」の表示に倒す）。
 */
export const buildExhibitPtBasisByStadium = (
  weights: StadiumWeightsFetch | undefined,
): Map<string, ExhibitPtBasis> => {
  const out = new Map<string, ExhibitPtBasis>();
  if (!weights || weights.rows.length === 0) return out;

  for (const w of weights.rows) {
    const stadium = getStadiumByName(w.stadiumName);
    if (!stadium) continue;

    out.set(stadium.id, {
      predictorId: weights.predictorId,
      mu: w.mu,
      sigma: w.sigma,
      weight: w.weight,
      weightsMonth: weights.month,
    });
  }

  return out;
};
