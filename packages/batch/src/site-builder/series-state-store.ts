import type { DailyBetPayoutSnapshot, RacePrediction } from "@fun-site/shared";
import { buildDailySnapshot } from "@fun-site/shared";
import { Storage } from "@google-cloud/storage";

/**
 * 節集計の incremental キャッシュ。
 *
 * 1 stadium × 1 date の `realtime` 戦略スナップショットを保持する。
 * 当日分は毎ビルドで上書き、過去日分は確定後は変わらないので再利用される。
 *
 * 配置: `gs://${GCS_DATA_BUCKET}/_meta/series-state.json`
 *
 * 形式:
 *
 * ```jsonc
 * {
 *   "updatedAt": "2026-05-21T07:00:00.000Z",
 *   "byStadium": {
 *     "21": {
 *       "perDay": {
 *         "2026-05-19": { "date": "2026-05-19", "settledRaceCount": 12, ... },
 *         "2026-05-20": { "date": "2026-05-20", "settledRaceCount": 12, ... },
 *         "2026-05-21": { "date": "2026-05-21", "settledRaceCount": 6,  ... }
 *       },
 *       "dayLabels": {
 *         "2026-05-19": "初日",
 *         "2026-05-20": "2日目",
 *         "2026-05-21": "3日目"
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * `dayLabels` も併せて保持するのは、過去日の予想 JSON を再取得しなくても節境界
 * (初日マーカー) を判定できるようにするため。
 */
export type SeriesState = {
  readonly updatedAt: string;
  readonly byStadium: Readonly<Record<string, StadiumSeriesState>>;
};

export type StadiumSeriesState = {
  readonly perDay: Readonly<Record<string, DailyBetPayoutSnapshot>>;
  readonly dayLabels: Readonly<Record<string, string>>;
};

const META_OBJECT_NAME = "_meta/series-state.json";

const DATA_BUCKET = process.env["GCS_DATA_BUCKET"] ?? "fun-site-data-boatrace-487212";

let storage: Storage | undefined;
const getStorage = (): Storage => {
  if (!storage) storage = new Storage();
  return storage;
};

/** GCS から series-state.json を読み込む。未存在/破損時は空 state を返す */
export const loadSeriesState = async (): Promise<SeriesState> => {
  const file = getStorage().bucket(DATA_BUCKET).file(META_OBJECT_NAME);
  try {
    const [buffer] = await file.download();
    const parsed = JSON.parse(buffer.toString("utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyState();
    const obj = parsed as Partial<SeriesState>;
    const byStadium = obj.byStadium;
    if (!byStadium || typeof byStadium !== "object") return emptyState();
    return {
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date().toISOString(),
      byStadium,
    };
  } catch (error) {
    const code = (error as { code?: number } | undefined)?.code;
    if (code === 404) return emptyState();
    console.warn(
      `Failed to load series state: ${error instanceof Error ? error.message : String(error)}`,
    );
    return emptyState();
  }
};

/** GCS に series-state.json を書き出す */
export const saveSeriesState = async (state: SeriesState): Promise<void> => {
  const file = getStorage().bucket(DATA_BUCKET).file(META_OBJECT_NAME);
  await file.save(JSON.stringify(state, null, 2), {
    contentType: "application/json; charset=utf-8",
    metadata: { cacheControl: "no-store" },
  });
};

const emptyState = (): SeriesState => ({
  updatedAt: new Date().toISOString(),
  byStadium: {},
});

/**
 * 当日の `RacePrediction[]` から会場別のスナップショット + dayLabel を抽出する。
 *
 * `realtime` 戦略のみが対象 (会場ページに出すのは直前買い目のため)。
 * `betPayout?.realtime` が無いレースは集計対象外。
 */
export type DailySnapshotByStadium = ReadonlyMap<
  string,
  { snapshot: DailyBetPayoutSnapshot; dayLabel: string }
>;

export const extractDailySnapshotsByStadium = (
  predictions: readonly RacePrediction[],
  date: string,
): DailySnapshotByStadium => {
  const grouped = new Map<string, RacePrediction[]>();
  for (const p of predictions) {
    const arr = grouped.get(p.stadiumId) ?? [];
    arr.push(p);
    grouped.set(p.stadiumId, arr);
  }
  const out = new Map<string, { snapshot: DailyBetPayoutSnapshot; dayLabel: string }>();
  for (const [stadiumId, group] of grouped) {
    const realtimeResults = group
      .map((p) => p.betPayout?.realtime)
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
    const snapshot = buildDailySnapshot(date, realtimeResults);
    // 会場内で dayLabel は基本どのレースも同じ。先頭の non-empty を採用する。
    const dayLabel = group.find((p) => p.dayLabel)?.dayLabel ?? "";
    out.set(stadiumId, { snapshot, dayLabel });
  }
  return out;
};

/**
 * 当日分のスナップショットを既存の state にマージし、新しい state を返す。
 *
 * 既存の過去日エントリはそのまま残し、当日分のみ上書き。
 */
export const mergeDailySnapshots = (
  state: SeriesState,
  date: string,
  daily: DailySnapshotByStadium,
): SeriesState => {
  const byStadium: Record<string, StadiumSeriesState> = { ...state.byStadium };
  for (const [stadiumId, { snapshot, dayLabel }] of daily) {
    const prev = byStadium[stadiumId] ?? { perDay: {}, dayLabels: {} };
    byStadium[stadiumId] = {
      perDay: { ...prev.perDay, [date]: snapshot },
      dayLabels: { ...prev.dayLabels, [date]: dayLabel },
    };
  }
  return {
    updatedAt: new Date().toISOString(),
    byStadium,
  };
};

/**
 * `lookbackDays` を超えた過去日エントリを各 stadium の state から削除する。
 *
 * GCS state が無限に肥大化するのを防ぐためのハウスキーピング。
 */
export const pruneSeriesState = (state: SeriesState, oldestKeepDate: string): SeriesState => {
  const byStadium: Record<string, StadiumSeriesState> = {};
  for (const [stadiumId, s] of Object.entries(state.byStadium)) {
    const perDay: Record<string, DailyBetPayoutSnapshot> = {};
    const dayLabels: Record<string, string> = {};
    for (const [date, snap] of Object.entries(s.perDay)) {
      if (date >= oldestKeepDate) perDay[date] = snap;
    }
    for (const [date, label] of Object.entries(s.dayLabels)) {
      if (date >= oldestKeepDate) dayLabels[date] = label;
    }
    byStadium[stadiumId] = { perDay, dayLabels };
  }
  return { ...state, byStadium };
};
