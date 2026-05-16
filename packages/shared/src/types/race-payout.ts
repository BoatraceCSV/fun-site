/**
 * realtime 払戻 CSV 由来の型定義。
 *
 * `data/results/payouts/YYYY/MM/DD.csv` 由来（boatracecsv 側 preview-realtime
 * が当日確定直後に bc_rs2 をパースして追記する）。K-file 由来の翌日確定
 * (`data/results/daily/...`) はここでは扱わない。
 */

/** 単勝 / 複勝 1 件分（人気は出ない式別） */
export type SinglePayout = {
  /** 艇番 (1-6) */
  readonly boatNumber: number;
  /** 払戻金 (円) */
  readonly payout: number;
};

/** 2連単 / 2連複 / 拡連複 / 3連単 / 3連複 1 件分 */
export type CombinationPayout = {
  /** 組番文字列。例 "1-4" (2連単) / "1=4" (2連複) / "1-4-2" (3連単) / "1=2=4" (3連複) / "1=4" (拡連複)。 */
  readonly combination: string;
  /** 払戻金 (円) */
  readonly payout: number;
  /** 人気 (1 が最高人気)。CSV に値が無い場合は null */
  readonly popularity: number | null;
};

/** realtime 払戻 CSV の 1 行（= 1 レース） */
export type RacePayoutRow = {
  readonly raceCode: string;
  readonly raceDate: string;
  readonly stadiumId: string;
  readonly raceNumber: number;
  /** 締切時刻 (HH:MM) */
  readonly votingDeadline: string;
  /** 取得日時 (ISO 文字列) */
  readonly fetchedAt: string;

  /** 単勝。CSV に値が無いレースは null */
  readonly tansho: SinglePayout | null;
  /**
   * 複勝。要素 0-3 個（通常 2 個。1 着同着など特殊ケースで 3 個になり得る）。
   * `fukusho[0]` は 1 着艇、`fukusho[1]` は 2 着艇に対応する。
   */
  readonly fukusho: readonly SinglePayout[];

  /** 2連単 */
  readonly nirentan: CombinationPayout | null;
  /** 2連複 */
  readonly nirenpuku: CombinationPayout | null;
  /**
   * 拡連複。長さ 3 固定のスロット配列。位置不変条件:
   * - `kakurenfuku[0]` = 1-2 着ペア
   * - `kakurenfuku[1]` = 1-3 着ペア
   * - `kakurenfuku[2]` = 2-3 着ペア
   *
   * 販売されないレース (5 艇立て以下) や同着でスロットが欠ける場合は null。
   */
  readonly kakurenfuku: readonly (CombinationPayout | null)[];
  /** 3連単 */
  readonly sanrentan: CombinationPayout | null;
  /** 3連複 */
  readonly sanrenpuku: CombinationPayout | null;
};
