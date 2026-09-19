import type { AnaPick, AnaPicksRow, BetCombo } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

// === 穴予想の買い目 CSV ===
//
// A案 `v9_suji`      … estimate/suji           (build_suji_picks.py)
// B案 `v10_kimarite` … estimate/kimarite/picks (build_kimarite_picks.py)
//
// **2 つは同じスキーマ**(レース × 状態 で 1 行、`買い目1..5` に "3-1-4" 形式の
// 出目、`決まり手1..5` にその出目の最頻決まり手)なので 1 つのパーサで読む。
// suji CSV には `1着コース` / `1着艇番` 列もあるが、B案には 1着が 1 つに
// 決まらないため型には持たせない(A案でも `picks[0].combo[0]` で足りる)。
//
// **fun-site は買い目を計算しない。** boatracecsv が確定させた出目をそのまま
// 使う (boatracecsv docs/design/ana_prediction.md §13 / §8.1)。
// 1 レースにつき daily 行と realtime 行の両方が来るので、呼び出し側は
// `state` で振り分ける。

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

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

/** "0.036130" → 0.03613。空欄・非数・0〜1 の範囲外は undefined。 */
const parseProbability = (raw: string | undefined): number | undefined => {
  const s = (raw ?? "").trim();
  if (s === "") return undefined;
  const p = Number(s);
  return Number.isFinite(p) && p >= 0 && p <= 1 ? p : undefined;
};

const parseRow = (row: Record<string, string>): AnaPicksRow | null => {
  const raceCode = (row["レースコード"] ?? "").trim();
  if (!raceCode) return null;
  const state = (row["状態"] ?? "").trim();
  if (state !== "daily" && state !== "realtime") return null;

  const picks: AnaPick[] = [];
  for (let i = 1; i <= 5; i++) {
    const combo = parseCombo(row[`買い目${i}`]);
    // 買い目が 5 点未満のレースもある (該当スジが無い等)。空欄は読み飛ばす。
    if (!combo) continue;
    // 確率N は 2026-09-19 に追加された列。列が無い / 空欄 (列追加前に書かれた行) は
    // undefined のまま (穴予想詳細ページが確率列を出さないだけで、買い目には影響しない)。
    const probability = parseProbability(row[`確率${i}`]);
    picks.push({
      combo,
      kimarite: (row[`決まり手${i}`] ?? "").trim(),
      ...(probability !== undefined ? { probability } : {}),
    });
  }

  return {
    raceCode,
    raceDate: (row["レース日"] ?? "").trim(),
    state,
    picks,
  };
};

export const parseAnaPicks = (csvText: string): AnaPicksRow[] =>
  parseCsv(csvText)
    .map(parseRow)
    .filter((r): r is AnaPicksRow => r !== null);
