import type { RacerStEntry, RacerStRow } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

/** 空欄・非数を null にする(欠場枠の 登録番号 / 推定ST 向け) */
const toNumberOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const num = Number(v);
  return Number.isNaN(num) ? null : num;
};

// === racer_st CSV (estimate/racer_st) ===
//
// 選手別 推定ST (boatracecsv scripts/build_racer_st.py 出力)。1 レース 1 行、
// 各枠の `N枠_登録番号` / `N枠_推定ST` を持つ。スリット予想と 1 マーク走行距離
// 計算が全国平均 ST の代わりに読む (boatracecsv docs/design/st_estimation.md)。
//
// `N枠_推定ST_p25` / `_p75` はスタート予想図の帯 (予測区間) 用。この 2 列より前に
// 生成された CSV も読めるよう、欠損は null に落とす (toNumberOrNull が undefined を
// 受けて null を返す)。

const parseRacerStRow = (row: Record<string, string>): RacerStRow => {
  const entries: RacerStEntry[] = [];
  for (let boat = 1; boat <= 6; boat++) {
    entries.push({
      boatNumber: boat,
      registrationNumber: toNumberOrNull(row[`${boat}枠_登録番号`]),
      estimatedST: toNumberOrNull(row[`${boat}枠_推定ST`]),
      estimatedStP25: toNumberOrNull(row[`${boat}枠_推定ST_p25`]),
      estimatedStP75: toNumberOrNull(row[`${boat}枠_推定ST_p75`]),
    });
  }
  return {
    raceCode: (row["レースコード"] ?? "").trim(),
    raceDate: (row["レース日"] ?? "").trim(),
    entries,
  };
};

export const parseRacerSt = (csvText: string): RacerStRow[] =>
  parseCsv(csvText).map(parseRacerStRow);
