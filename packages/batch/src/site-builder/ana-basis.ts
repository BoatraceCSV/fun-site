import type {
  AnaBasis,
  AnaBasisState,
  AnaPairTableView,
  AnaPickBasis,
  AnaPicksRow,
  CourseTriple,
  KimariteRow,
  KimariteTableRow,
  PairTableRow,
  StartPrediction,
} from "@fun-site/shared";
import { ANA_BLEND_PARAMS, parseCellName } from "@fun-site/shared";

/**
 * 穴予想 (`v10_kimarite`) の根拠を `RacePrediction.anaBasis` に組み立てる。
 *
 * 入力は上流が配るものだけ:
 * - 荒れ度メーター CSV (`KimariteRow`): 荒れ度と Stage1 の 32 セル確率
 * - 買い目 CSV (`AnaPicksRow`): 出目・決まり手注釈・ブレンド後確率
 * - 静的テーブル 2 枚 (`pair_table.csv` / `kimarite_table.csv`)
 *
 * **買い目や確率をここで計算し直すことはしない。** 出目の並びを進入コースに写像し、
 * 静的テーブルから該当行を抜き出して並べるだけ。合成の再現 (強さpt 変調) は
 * 表示専用として web 側 (`modulatePairProbabilities`) で行う。
 */

/** 荒れ側で載せるセル数と、セルごとに載せるペア数。JSON の肥大化を抑えるための上限。 */
export const ANA_PAIR_TABLE_CELLS = 3;
export const ANA_PAIR_TABLE_PAIRS = 5;

/** 静的テーブル 2 枚を引きやすい形にしたもの。1 日 1 回作って全レースで使い回す。 */
export type AnaTables = {
  /** セル → ペア表 (確率降順) */
  readonly pairsByCell: ReadonlyMap<string, readonly PairTableRow[]>;
  /** "c1-c2-c3" → 決まり手分布 */
  readonly kimariteByCourses: ReadonlyMap<string, KimariteTableRow>;
};

const coursesKey = (c: CourseTriple): string => c.join("-");

/** テーブルが両方とも空なら undefined (根拠ページが「未取得」表示に倒れる)。 */
export const buildAnaTables = (
  pairRows: readonly PairTableRow[],
  kimariteRows: readonly KimariteTableRow[],
): AnaTables | undefined => {
  if (pairRows.length === 0 && kimariteRows.length === 0) return undefined;
  const pairsByCell = new Map<string, PairTableRow[]>();
  for (const row of pairRows) {
    const list = pairsByCell.get(row.cell) ?? [];
    list.push(row);
    pairsByCell.set(row.cell, list);
  }
  for (const list of pairsByCell.values()) {
    list.sort((a, b) => b.probability - a.probability || a.second - b.second || a.third - b.third);
  }
  return {
    pairsByCell,
    kimariteByCourses: new Map(kimariteRows.map((r) => [coursesKey(r.courses), r])),
  };
};

/** 枠なり (index 0 = 1 コース → 1 号艇)。 */
const WAKUNARI_BOAT_BY_COURSE: readonly number[] = [1, 2, 3, 4, 5, 6];

/**
 * スタート予想から「コース → 艇番」を作る。展示進入が取れていないか 6 コースが
 * 揃わない (前付けで重複など) 場合は枠なりにフォールバックする。上流の
 * `build_kimarite_picks.py` も同じ規約 (stt が無ければ枠なり) で出目を作っている。
 */
export const boatByCourseFrom = (
  startPrediction: StartPrediction | undefined,
): readonly number[] => {
  if (!startPrediction?.fromExhibition) return WAKUNARI_BOAT_BY_COURSE;
  const out = [0, 0, 0, 0, 0, 0];
  for (const e of startPrediction.entries) {
    if (e.courseNumber >= 1 && e.courseNumber <= 6) out[e.courseNumber - 1] = e.boatNumber;
  }
  const distinct = new Set(out);
  if (out.some((b) => b === 0) || distinct.size !== 6) return WAKUNARI_BOAT_BY_COURSE;
  return out;
};

/**
 * 荒れ側 (1着コース ≠ 除外コース) のセルを確率降順に取り、上位 N セルのペア表を返す。
 * 買い目と同じく 1 コース頭のセルは載せない (穴予想の立場に合わせる)。
 */
const selectPairTables = (
  cells: Readonly<Record<string, number>>,
  tables: AnaTables | undefined,
): AnaPairTableView[] => {
  if (!tables) return [];
  const ranked = Object.entries(cells)
    .map(([cell, cellProbability]) => ({ cell, cellProbability, parsed: parseCellName(cell) }))
    .filter(
      (e): e is { cell: string; cellProbability: number; parsed: NonNullable<typeof e.parsed> } =>
        e.parsed !== null && e.parsed.firstCourse !== ANA_BLEND_PARAMS.excludedFirstCourse,
    )
    .sort((a, b) => b.cellProbability - a.cellProbability || a.cell.localeCompare(b.cell))
    .slice(0, ANA_PAIR_TABLE_CELLS);
  return ranked.map(({ cell, cellProbability }) => ({
    cell,
    cellProbability,
    pairs: (tables.pairsByCell.get(cell) ?? [])
      .slice(0, ANA_PAIR_TABLE_PAIRS)
      .map((p) => ({ second: p.second, third: p.third, n: p.n, probability: p.probability })),
  }));
};

/**
 * 1 状態ぶんの根拠。荒れ度メーター CSV に行が無ければ undefined
 * (上流は Stage1 の確率が無いレースでは買い目も出さないので、両方欠ける)。
 */
export const buildAnaBasisState = (
  kimariteRow: KimariteRow | undefined,
  picksRow: AnaPicksRow | undefined,
  boatByCourse: readonly number[],
  tables: AnaTables | undefined,
): AnaBasisState | undefined => {
  if (!kimariteRow) return undefined;
  const courseOfBoat = new Map(boatByCourse.map((boat, i) => [boat, i + 1]));
  const picks: AnaPickBasis[] = (picksRow?.picks ?? []).map((pick) => {
    const courses: CourseTriple = [
      courseOfBoat.get(pick.combo[0]) ?? pick.combo[0],
      courseOfBoat.get(pick.combo[1]) ?? pick.combo[1],
      courseOfBoat.get(pick.combo[2]) ?? pick.combo[2],
    ];
    const table = tables?.kimariteByCourses.get(coursesKey(courses));
    return {
      combo: pick.combo,
      courses,
      kimarite: pick.kimarite,
      ...(pick.probability !== undefined ? { probability: pick.probability } : {}),
      ...(table ? { kimariteShares: { n: table.n, shares: table.shares } } : {}),
    };
  });
  return {
    upsetRate: kimariteRow.upsetRate,
    cellProbabilities: kimariteRow.cellProbabilities,
    boatByCourse,
    picks,
    pairTables: selectPairTables(kimariteRow.cellProbabilities, tables),
  };
};

/**
 * レース単位の `AnaBasis`。daily は枠なり、realtime は展示進入でコースに写像する
 * (上流の買い目生成と同じ規約)。どちらの状態も無ければ undefined。
 */
export const buildAnaBasis = (
  kimariteRows: { readonly daily?: KimariteRow; readonly realtime?: KimariteRow } | undefined,
  picks: { readonly daily?: AnaPicksRow; readonly realtime?: AnaPicksRow } | undefined,
  startPrediction: StartPrediction | undefined,
  tables: AnaTables | undefined,
): AnaBasis | undefined => {
  const daily = buildAnaBasisState(
    kimariteRows?.daily,
    picks?.daily,
    WAKUNARI_BOAT_BY_COURSE,
    tables,
  );
  const realtime = buildAnaBasisState(
    kimariteRows?.realtime,
    picks?.realtime,
    boatByCourseFrom(startPrediction),
    tables,
  );
  if (daily === undefined && realtime === undefined) return undefined;
  return { ...(daily ? { daily } : {}), ...(realtime ? { realtime } : {}) };
};
