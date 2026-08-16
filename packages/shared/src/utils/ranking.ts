/**
 * 順位付けと順位相関の共通ヘルパー。
 *
 * 展示pt (`exhibit-pt.ts`) と気象pt (`weather-pt.ts`) の解説ページが、
 * 「pt の順位」と「同じスナップショットの計測値の順位」をつき合わせるために使う。
 * どちらも pt の再計算ではなく **参考値** の集計である。
 */

/**
 * 値が小さいほど上位の競技順位（1,1,3 形式）。同値は同順位で、次の順位は
 * その数だけ飛ぶ。null / 非有限値には順位を付けない。
 *
 * 「大きいほど上位」の値（pt 等）は符号を反転して渡すこと。
 */
export const competitionRanks = (values: readonly (number | null)[]): (number | null)[] => {
  const sorted = [
    ...new Set(values.filter((v): v is number => v !== null && Number.isFinite(v))),
  ].sort((a, b) => a - b);
  // 同値の艇数ぶん順位を飛ばすため、値 → その値より小さい艇の数 + 1 を引く表を作る
  const rankByValue = new Map<number, number>();
  let seen = 0;
  for (const v of sorted) {
    rankByValue.set(v, seen + 1);
    seen += values.filter((x) => x === v).length;
  }
  return values.map((v) =>
    v === null || !Number.isFinite(v) ? null : (rankByValue.get(v) ?? null),
  );
};

/** 平均順位（タイは平均）。スピアマン相関の入力に使う */
const averageRanks = (values: readonly number[]): number[] => {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const first = sorted.indexOf(v); // 0-based
    const count = sorted.filter((x) => x === v).length;
    // 1-based の first..first+count-1 の平均
    return first + 1 + (count - 1) / 2;
  });
};

/**
 * スピアマンの順位相関。ペアが 3 未満、またはどちらかの順位が全て同値なら null。
 * `xs[i]` と `ys[i]` は同じ艇の値であること。
 */
export const spearman = (xs: readonly number[], ys: readonly number[]): number | null => {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  const n = rx.length;
  const mean = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0) / n;
  const mx = mean(rx);
  const my = mean(ry);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (rx[i] ?? 0) - mx;
    const dy = (ry[i] ?? 0) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
};
