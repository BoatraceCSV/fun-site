/**
 * 穴予想 (`v10_kimarite`) の **表示用** ユーティリティ。
 *
 * 買い目と確率は boatracecsv が確定させて CSV で配る (fun-site は再計算しない)。
 * ここにあるのは、配られた Stage1 のセル確率と Stage2 のペア表を穴予想詳細ページで
 * 読み解くための集計だけ。定数は boatracecsv `scripts/boatrace/kimarite_blend.py`
 * が定義元で、**値を動かすときは上流を先に変える**。
 *
 * 設計: boatracecsv docs/design/ana_prediction.md §4 / §6.2 / §14。
 */

/**
 * 合成のハイパラ (boatracecsv `kimarite_blend.py` と同期)。
 * γ は Stage2 の強さpt 変調、β は Plackett-Luce の強さ倍率、blendWeight は
 * 決まり手モデルの重み (残りが PL)。topK と excludedFirstCourse は買い目ルール。
 */
export const ANA_BLEND_PARAMS = {
  gamma: 0.5,
  beta: 2.4,
  blendWeight: 0.7,
  topK: 5,
  excludedFirstCourse: 1,
} as const;

/** 決まり手の種類 (公式の 6 分類)。セル名・決まり手注釈テーブルのキー。 */
export const KIMARITE_NAMES = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"] as const;
export type KimariteName = (typeof KIMARITE_NAMES)[number];

/** n < 60 のセルを畳んだ受け皿クラスの決まり手名 (`その他_3` 等)。 */
export const OTHER_KIMARITE = "その他";

/** 荒れ度の定義に使うセル。荒れ度 = 1 − P(このセル)。 */
export const NIGE_CELL = "逃げ_1";

/** セル名 `まくり差し_3` → { kimarite: "まくり差し", firstCourse: 3 }。形式外は null。 */
export const parseCellName = (cell: string): { kimarite: string; firstCourse: number } | null => {
  const i = cell.lastIndexOf("_");
  if (i <= 0) return null;
  const firstCourse = Number(cell.slice(i + 1));
  if (!Number.isInteger(firstCourse) || firstCourse < 1 || firstCourse > 6) return null;
  return { kimarite: cell.slice(0, i), firstCourse };
};

/** 1着コース別の確率 (index 0 = 1 コース)。セル確率を 1着コースで合計する。 */
export const firstCourseDistribution = (
  cells: Readonly<Record<string, number>>,
): readonly number[] => {
  const out = [0, 0, 0, 0, 0, 0];
  for (const [cell, p] of Object.entries(cells)) {
    const parsed = parseCellName(cell);
    if (!parsed) continue;
    out[parsed.firstCourse - 1] = (out[parsed.firstCourse - 1] ?? 0) + p;
  }
  return out;
};

/**
 * 「荒れるなら何コース頭か」— 1 コース以外が 1着になる条件での 1着コース分布。
 * `P(1着 = c) / Σ_{c≠1} P(1着 = c)` を降順で返す。分母が 0 なら空配列。
 *
 * 設計書 §11.1 で「当てられているのは 1着コース (45.1% 対ベースライン 30.1%)」と
 * 検証された表示要素。決まり手 (レース単位) はここには出さない。
 */
export const upsetFirstCourseShares = (
  cells: Readonly<Record<string, number>>,
): readonly { course: number; share: number }[] => {
  const dist = firstCourseDistribution(cells);
  const total = dist.slice(1).reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return dist
    .map((p, i) => ({ course: i + 1, share: p / total }))
    .filter((e) => e.course !== 1)
    .sort((a, b) => b.share - a.share);
};

/**
 * 決まり手別の確率 (全種類を並べる)。`KIMARITE_NAMES` の順 + `その他`。
 * 設計書 §14.3: 分布としては校正が良いので出せるが、**1 つを強調してはいけない**。
 */
export const kimariteDistribution = (
  cells: Readonly<Record<string, number>>,
): readonly { kimarite: string; probability: number }[] => {
  const acc = new Map<string, number>([...KIMARITE_NAMES, OTHER_KIMARITE].map((k) => [k, 0]));
  for (const [cell, p] of Object.entries(cells)) {
    const parsed = parseCellName(cell);
    if (!parsed) continue;
    const key = acc.has(parsed.kimarite) ? parsed.kimarite : OTHER_KIMARITE;
    acc.set(key, (acc.get(key) ?? 0) + p);
  }
  return [...acc.entries()].map(([kimarite, probability]) => ({ kimarite, probability }));
};

/**
 * 決まり手 × 1着コース の行列 (穴予想詳細ページの Stage1 表)。
 * 行は `KIMARITE_NAMES` + `その他`、列は 1〜6 コース。存在しないセルは 0。
 */
export const cellProbabilityMatrix = (
  cells: Readonly<Record<string, number>>,
): readonly { kimarite: string; byCourse: readonly number[] }[] => {
  const rows = new Map<string, number[]>(
    [...KIMARITE_NAMES, OTHER_KIMARITE].map((k) => [k, [0, 0, 0, 0, 0, 0]]),
  );
  for (const [cell, p] of Object.entries(cells)) {
    const parsed = parseCellName(cell);
    if (!parsed) continue;
    const key = rows.has(parsed.kimarite) ? parsed.kimarite : OTHER_KIMARITE;
    const row = rows.get(key);
    if (row) row[parsed.firstCourse - 1] = (row[parsed.firstCourse - 1] ?? 0) + p;
  }
  return [...rows.entries()].map(([kimarite, byCourse]) => ({ kimarite, byCourse }));
};

/** 強さpt → z 得点 (`(pt − 50) / 10`)。Stage2 の変調と PL が使う尺度。 */
export const strengthZScore = (strengthPt: number): number => (strengthPt - 50) / 10;

/**
 * Stage2 のペア表に強さpt の変調を掛けて正規化する (表示用の再現)。
 *
 * `P(c2, c3 | セル) ∝ tab[c2][c3] · exp(γ·z_c2) · exp(γ·z_c3 / 2)`
 * (boatracecsv `kimarite_blend.kimarite_joint` と同じ式)。渡されたペアの中だけで
 * 正規化するので、上位ペアだけを渡した場合は「その中での比率」になる。
 *
 * @param zByCourse index 0 = 1 コースに入る艇の z 得点
 */
export const modulatePairProbabilities = (
  pairs: readonly { second: number; third: number; probability: number }[],
  zByCourse: readonly number[],
  gamma: number = ANA_BLEND_PARAMS.gamma,
): readonly number[] => {
  const raw = pairs.map(
    (p) =>
      p.probability *
      Math.exp(gamma * (zByCourse[p.second - 1] ?? 0)) *
      Math.exp((gamma * (zByCourse[p.third - 1] ?? 0)) / 2),
  );
  const total = raw.reduce((a, b) => a + b, 0);
  if (total <= 0) return pairs.map(() => 0);
  return raw.map((v) => v / total);
};
