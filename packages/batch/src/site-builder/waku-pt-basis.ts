import type { CourseRates, WakuPtBasis, WakuSeason, WakuTableRow } from "@fun-site/shared";
import { WAKU_SEASONS, getStadiumByName, seasonForDate } from "@fun-site/shared";
import type { WakuWeightsFetch } from "../fetcher/index.js";

/**
 * 枠番pt の根拠を場ごとに組み立てる。
 *
 * 上流の静的テーブル 2 種（`win_rate.csv` の場×季節×コース勝率と、weights CSV の
 * 場別 μ / σ / w）を突き合わせ、**その場のぶんだけ**を切り出して
 * `RacePrediction.wakuPtBasis` に載せられる形にする。
 *
 * 両方が揃った場だけを返す。片方しか無い場は 枠番pt を再現できないので
 * エントリごと落とす（画面側は undefined で「根拠テーブル未取得」の表示に倒す）。
 *
 * weights CSV は場名キー（"桐生"）、win_rate.csv は場コードキー（"01"）なので、
 * 場マスタで突合する。
 */
export const buildWakuPtBasisByStadium = (
  wakuTable: readonly WakuTableRow[],
  weights: WakuWeightsFetch | undefined,
  raceDate: string,
): Map<string, WakuPtBasis> => {
  const out = new Map<string, WakuPtBasis>();
  if (!weights || weights.rows.length === 0 || wakuTable.length === 0) return out;

  // 場コード → 季節 → 6 コース勝率
  const ratesByStadium = new Map<string, Map<WakuSeason, CourseRates>>();
  for (const row of wakuTable) {
    const bySeason = ratesByStadium.get(row.stadiumId) ?? new Map<WakuSeason, CourseRates>();
    bySeason.set(row.season, row.rates);
    ratesByStadium.set(row.stadiumId, bySeason);
  }

  const season = seasonForDate(raceDate);

  for (const w of weights.rows) {
    const stadium = getStadiumByName(w.stadiumName);
    if (!stadium) continue;
    const bySeason = ratesByStadium.get(stadium.id);
    if (!bySeason) continue;

    // 4 季節すべて揃っている場だけを対象にする（季節間の比較表示をするため）
    const ratesBySeason = {} as Record<WakuSeason, CourseRates>;
    let complete = true;
    for (const s of WAKU_SEASONS) {
      const rates = bySeason.get(s);
      if (!rates) {
        complete = false;
        break;
      }
      ratesBySeason[s] = rates;
    }
    if (!complete) continue;

    out.set(stadium.id, {
      predictorId: weights.predictorId,
      season,
      ratesBySeason,
      mu: w.mu,
      sigma: w.sigma,
      weight: w.weight,
      weightsMonth: weights.month,
    });
  }

  return out;
};
