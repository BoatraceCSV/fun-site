import type { BetCombo, SujiPick, SujiRow } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

// === suji CSV (estimate/suji) ===
//
// 穴予想 v9_suji の買い目 (boatracecsv scripts/build_suji_picks.py 出力)。
// レース × 状態 で 1 行。`買い目1..5` に "3-1-4" 形式の出目、`決まり手1..5` に
// その出目の最頻決まり手が入る。
//
// **fun-site は買い目を計算しない。** boatracecsv が確定させた出目をそのまま
// 使う (boatracecsv docs/design/ana_prediction.md §13 / §8.1)。
// 1 レースにつき daily 行と realtime 行の両方が来るので、呼び出し側は
// `state` で振り分ける。

/** "3-1-4" → [3, 1, 4]。形式が違う / 艇番が範囲外なら null。 */
const parseCombo = (raw: string | undefined): BetCombo | null => {
  if (!raw) return null;
  const parts = raw.trim().split("-");
  if (parts.length !== 3) return null;
  const boats = parts.map((p) => Number(p));
  if (boats.some((b) => !Number.isInteger(b) || b < 1 || b > 6)) return null;
  const [a, b, c] = boats;
  // 同一艇の重複は実出目として有り得ない
  if (a === b || b === c || a === c) return null;
  return [a, b, c] as BetCombo;
};

const toIntOr = (raw: string | undefined, fallback: number): number => {
  const n = Number((raw ?? "").trim());
  return Number.isInteger(n) ? n : fallback;
};

const parseSujiRow = (row: Record<string, string>): SujiRow | null => {
  const raceCode = (row["レースコード"] ?? "").trim();
  if (!raceCode) return null;
  const state = (row["状態"] ?? "").trim();
  if (state !== "daily" && state !== "realtime") return null;

  const picks: SujiPick[] = [];
  for (let i = 1; i <= 5; i++) {
    const combo = parseCombo(row[`買い目${i}`]);
    // 買い目が 5 点未満のレースもある (該当スジが無い等)。空欄はそこで打ち切る。
    if (!combo) continue;
    picks.push({ combo, kimarite: (row[`決まり手${i}`] ?? "").trim() });
  }

  return {
    raceCode,
    raceDate: (row["レース日"] ?? "").trim(),
    state,
    firstCourse: toIntOr(row["1着コース"], 0),
    firstBoat: toIntOr(row["1着艇番"], 0),
    picks,
  };
};

export const parseSuji = (csvText: string): SujiRow[] =>
  parseCsv(csvText)
    .map(parseSujiRow)
    .filter((r): r is SujiRow => r !== null);
