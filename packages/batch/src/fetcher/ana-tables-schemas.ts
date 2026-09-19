import type { CourseTriple, KimariteTableRow, PairTableRow } from "@fun-site/shared";
import { KIMARITE_NAMES } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

// === 穴予想 v10_kimarite の根拠テーブル (静的・月次再生成) ===
//
// どちらも日付パーティションを持たず、boatracecsv の monthly-weights が月 1 回
// 作り直す。穴予想詳細ページが「なぜこの 5 点か」を出すために読むだけで、
// **買い目の計算には使わない** (買い目は picks CSV が正)。
//
// * `estimate/kimarite/tables/pair_table.csv` … Stage2 P(2着, 3着 | セル)。640 行
// * `estimate/suji/tables/kimarite_table.csv` … 出目 (コース並び) → 決まり手分布。120 行
//
// 設計: boatracecsv docs/design/ana_prediction.md §4.2 / §14.1

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

const toCourse = (raw: string | undefined): number | null => {
  const n = Number((raw ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
};

const toNumber = (raw: string | undefined): number | null => {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * `pair_table.csv` をパースする。列は `セル,2着コース,3着コース,n,確率`。
 * 確率が読めない行・コースが範囲外の行は落とす。
 */
export const parsePairTable = (csvText: string): PairTableRow[] => {
  const rows: PairTableRow[] = [];
  for (const row of parseCsv(csvText)) {
    const cell = (row["セル"] ?? "").trim();
    const second = toCourse(row["2着コース"]);
    const third = toCourse(row["3着コース"]);
    const probability = toNumber(row["確率"]);
    if (!cell || second === null || third === null || probability === null) continue;
    if (second === third) continue;
    rows.push({ cell, second, third, n: toNumber(row["n"]) ?? 0, probability });
  }
  return rows;
};

/**
 * `kimarite_table.csv` をパースする。
 * 列は `1着コース,2着コース,3着コース,n,最頻決まり手,逃げ,差し,まくり,まくり差し,抜き,恵まれ`。
 * 決まり手の割合列は `KIMARITE_NAMES` で引き、無い列は 0 として扱う。
 */
export const parseKimariteTable = (csvText: string): KimariteTableRow[] => {
  const rows: KimariteTableRow[] = [];
  for (const row of parseCsv(csvText)) {
    const c1 = toCourse(row["1着コース"]);
    const c2 = toCourse(row["2着コース"]);
    const c3 = toCourse(row["3着コース"]);
    if (c1 === null || c2 === null || c3 === null) continue;
    if (c1 === c2 || c2 === c3 || c1 === c3) continue;
    const shares: Record<string, number> = {};
    for (const name of KIMARITE_NAMES) {
      shares[name] = toNumber(row[name]) ?? 0;
    }
    const courses: CourseTriple = [c1, c2, c3];
    rows.push({
      courses,
      n: toNumber(row["n"]) ?? 0,
      mode: (row["最頻決まり手"] ?? "").trim(),
      shares,
    });
  }
  return rows;
};
