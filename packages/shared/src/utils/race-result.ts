import type { RaceResultRow } from "../types/race-result.js";

/**
 * 1〜3 着の艇番を `[1着, 2着, 3着]` のタプルで取り出す。
 * いずれかの着順が欠けている（部分確定・未着）場合は undefined を返す。
 */
export const extractTopThree = (
  result: RaceResultRow,
): readonly [number, number, number] | undefined => {
  const byRank = new Map<number, number>(
    result.finishes.map((f) => [f.rank, f.boatNumber] as const),
  );
  const first = byRank.get(1);
  const second = byRank.get(2);
  const third = byRank.get(3);
  if (first === undefined || second === undefined || third === undefined) return undefined;
  return [first, second, third] as const;
};

/**
 * レース結果が「確定済み」か判定する。
 *
 * 的中率・回収率の **母数（集計対象レース）** の判定に使う共通述語。結果が
 * 存在し、かつ 1〜3 着が相異なる艇番で揃っているときにのみ true を返す。
 *
 * false になるのは以下のケースで、これらは的中数・払戻（分子）と
 * 母数・購入額（分母）の **両方から除外** する（分子・分母の対象を揃える）:
 * - `result` 未着（当日進行中でまだ結果が来ていない）
 * - 1〜3 着が揃わない（部分確定）
 * - 中止・不成立（着順が出ない）
 *
 * 返還レースを「回収率 100% のレース」として計上せず丸ごと除外するのは、
 * 予想の当否を判定できないレースを母数に入れない方針のため。除外は購入額を
 * 計上しない = 全額返還の会計上も整合する。
 */
export const isSettledResult = (result: RaceResultRow | undefined): boolean => {
  if (!result) return false;
  const top = extractTopThree(result);
  if (!top) return false;
  const [a, b, c] = top;
  return a !== b && b !== c && a !== c;
};
