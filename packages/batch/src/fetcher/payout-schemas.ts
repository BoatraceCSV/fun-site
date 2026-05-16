import type {
  CombinationPayout,
  RacePayoutRow,
  SinglePayout,
} from "@fun-site/shared";
import { parse } from "csv-parse/sync";

const stripRSuffix = (raw: string | undefined): number => {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9]/g, "");
  return cleaned ? Number(cleaned) : 0;
};

const toInt = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const cleaned = v.replace(/[^\d-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const parseCsv = (csvText: string): Record<string, string>[] =>
  parse(csvText, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

const buildSinglePayout = (
  boatRaw: string | undefined,
  payoutRaw: string | undefined,
): SinglePayout | null => {
  const boat = toInt(boatRaw);
  const payout = toInt(payoutRaw);
  if (boat === null || payout === null || boat <= 0) return null;
  return { boatNumber: boat, payout };
};

const buildCombinationPayout = (
  comboRaw: string | undefined,
  payoutRaw: string | undefined,
  popularityRaw: string | undefined,
): CombinationPayout | null => {
  const combination = (comboRaw ?? "").trim();
  if (!combination) return null;
  const payout = toInt(payoutRaw);
  if (payout === null) return null;
  const popularity = toInt(popularityRaw);
  return { combination, payout, popularity };
};

const parsePayoutRow = (row: Record<string, string>): RacePayoutRow => {
  const fukusho: SinglePayout[] = [];
  for (const rank of [1, 2, 3] as const) {
    const entry = buildSinglePayout(
      row[`複勝_${rank}着_艇番`],
      row[`複勝_${rank}着_払戻金`],
    );
    if (entry) fukusho.push(entry);
  }

  // 拡連複 は位置不変条件 (1-2着 / 1-3着 / 2-3着) を維持するためスロット配列で保持する。
  // 欠損スロットは null を入れて長さ 3 を固定。
  const kakurenfuku: (CombinationPayout | null)[] = (["1-2着", "1-3着", "2-3着"] as const).map(
    (label) =>
      buildCombinationPayout(
        row[`拡連複_${label}_組番`],
        row[`拡連複_${label}_払戻金`],
        row[`拡連複_${label}_人気`],
      ),
  );

  return {
    raceCode: row["レースコード"] ?? "",
    raceDate: row["レース日"] ?? "",
    stadiumId: row["レース場"] ?? "",
    raceNumber: stripRSuffix(row["レース回"]),
    votingDeadline: row["締切時刻"] ?? "",
    fetchedAt: row["取得日時"] ?? "",
    tansho: buildSinglePayout(row["単勝_艇番"], row["単勝_払戻金"]),
    fukusho,
    nirentan: buildCombinationPayout(
      row["2連単_組番"],
      row["2連単_払戻金"],
      row["2連単_人気"],
    ),
    nirenpuku: buildCombinationPayout(
      row["2連複_組番"],
      row["2連複_払戻金"],
      row["2連複_人気"],
    ),
    kakurenfuku,
    sanrentan: buildCombinationPayout(
      row["3連単_組番"],
      row["3連単_払戻金"],
      row["3連単_人気"],
    ),
    sanrenpuku: buildCombinationPayout(
      row["3連複_組番"],
      row["3連複_払戻金"],
      row["3連複_人気"],
    ),
  };
};

/**
 * realtime 払戻 CSV (`data/results/payouts/YYYY/MM/DD.csv`) をパースする。
 *
 * 1 行 = 1 レース。preview-realtime が当日確定直後に bc_rs2 をパースして
 * 追記するため、当日のすべてのレースが揃うとは限らない（締切前 / 結果未着 /
 * 払戻未取得のレースは単に行が無いだけ）。
 */
export const parsePayouts = (csvText: string): RacePayoutRow[] =>
  parseCsv(csvText).map(parsePayoutRow);
