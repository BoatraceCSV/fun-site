import type { KimariteRow } from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

// === kimarite CSV (estimate/kimarite) ===
//
// 荒れ度メーター (boatracecsv scripts/build_kimarite_probs.py 出力)。
// レース × 状態 で 1 行。`荒れ度` と `P_{クラス}` × 32 を持つ。
//
// **argmax は使わない。** レース単位の決まり手予測はベースレートを超えないため
// (boatracecsv docs/design/ana_prediction.md §14.2)。使ってよいのは確率値だけ。

const CELL_PREFIX = "P_";

const parseKimariteRow = (row: Record<string, string>): KimariteRow | null => {
  const raceCode = (row["レースコード"] ?? "").trim();
  const state = (row["状態"] ?? "").trim();
  if (!raceCode || (state !== "daily" && state !== "realtime")) return null;
  // 空欄を Number() に通すと 0 (= 絶対に荒れない) になってしまうので先に弾く
  const rawUpset = (row["荒れ度"] ?? "").trim();
  if (rawUpset === "") return null;
  const upsetRate = Number(rawUpset);
  if (!Number.isFinite(upsetRate) || upsetRate < 0 || upsetRate > 1) return null;

  const cellProbabilities: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith(CELL_PREFIX)) continue;
    const raw = (value ?? "").trim();
    if (raw === "") continue;
    const p = Number(raw);
    if (Number.isFinite(p)) cellProbabilities[key.slice(CELL_PREFIX.length)] = p;
  }

  return {
    raceCode,
    raceDate: (row["レース日"] ?? "").trim(),
    state,
    upsetRate,
    cellProbabilities,
  };
};

export const parseKimarite = (csvText: string): KimariteRow[] =>
  parseCsv(csvText)
    .map(parseKimariteRow)
    .filter((r): r is KimariteRow => r !== null);
