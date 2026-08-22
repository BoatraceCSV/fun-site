import type { SuiParamsRow, WeatherPtBasis } from "@fun-site/shared";
import { getStadiumByName } from "@fun-site/shared";
import type { StadiumWeightsFetch } from "../fetcher/index.js";

/**
 * 気象pt の根拠を場ごとに組み立てる。
 *
 * 上流の静的テーブル 2 種（`sui_params.csv` の場別気象回帰係数と、weights CSV の
 * 場別 μ / σ / w）を突き合わせ、**その場のぶんだけ**を切り出して
 * `RacePrediction.weatherPtBasis` に載せられる形にする。
 *
 * 両方が揃った場だけを返す。片方しか無い場は 気象pt を再現できないので
 * エントリごと落とす（画面側は undefined で「根拠テーブル未取得」の表示に倒す）。
 *
 * どちらのテーブルも場名キー（"桐生"）なので、場マスタで場コードに読み替える。
 */
export const buildWeatherPtBasisByStadium = (
  suiParams: readonly SuiParamsRow[],
  weights: StadiumWeightsFetch | undefined,
): Map<string, WeatherPtBasis> => {
  const out = new Map<string, WeatherPtBasis>();
  if (!weights || weights.rows.length === 0 || suiParams.length === 0) return out;

  const coefsByStadiumName = new Map(suiParams.map((row) => [row.stadiumName, row.coefs]));

  for (const w of weights.rows) {
    const stadium = getStadiumByName(w.stadiumName);
    if (!stadium) continue;
    const coefs = coefsByStadiumName.get(w.stadiumName);
    if (!coefs) continue;

    out.set(stadium.id, {
      predictorId: weights.predictorId,
      coefs,
      mu: w.mu,
      sigma: w.sigma,
      weight: w.weight,
      weightsMonth: weights.month,
    });
  }

  return out;
};
