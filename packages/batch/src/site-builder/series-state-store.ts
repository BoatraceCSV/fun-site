import type { DailyBetPayoutSnapshot, RacePrediction } from "@fun-site/shared";
import { buildDailySnapshot, isSettledResult } from "@fun-site/shared";
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
  /**
   * Primary predictor (= slot=1 / A君) の per-day snapshot。
   * 旧 UI / 後方互換のため必須フィールドとして保持。
   */
  readonly perDay: Readonly<Record<string, DailyBetPayoutSnapshot>>;
  /**
   * 予想者別の per-day snapshot (`predictor_id` → `date` → snapshot)。
   * 旧 state JSON では未設定のため optional。新スキーマでは A君含め全 active
   * 予想者を格納する (primary も含めて重複保持しておく方が UI 側の分岐が
   * 単純になる)。
   */
  readonly perDayByPredictor?: Readonly<
    Record<string, Readonly<Record<string, DailyBetPayoutSnapshot>>>
  >;
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
 *
 * - `snapshot`: primary predictor (slot=1) の集計 (後方互換)。
 *   `betPayout?.realtime` 必須 (無いレースは集計対象外)。
 * - `byPredictor`: `prediction.predictions[]` を予想者 ID 別に分解した
 *   per-predictor 集計。新規 JSON のみで作成され、旧 JSON では空 Map。
 *   A君 (= primary) も含む。
 */
export type DailySnapshotByStadium = ReadonlyMap<
  string,
  {
    snapshot: DailyBetPayoutSnapshot;
    byPredictor: ReadonlyMap<string, DailyBetPayoutSnapshot>;
    dayLabel: string;
  }
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
  const out = new Map<
    string,
    {
      snapshot: DailyBetPayoutSnapshot;
      byPredictor: ReadonlyMap<string, DailyBetPayoutSnapshot>;
      dayLabel: string;
    }
  >();
  for (const [stadiumId, group] of grouped) {
    // 未確定レース（結果未着・中止・不成立）は母数・購入額から除外する。
    const settled = group.filter((p) => isSettledResult(p.raceResult));
    // primary (後方互換): 既存の betPayout?.realtime をそのまま使う
    const realtimeResults = settled
      .map((p) => p.betPayout?.realtime)
      .filter((r): r is NonNullable<typeof r> => r !== undefined);
    const snapshot = buildDailySnapshot(date, realtimeResults);

    // 予想者別: prediction.predictions[] 配列から predictor_id ごとに分解
    const perPredictorBuckets = new Map<
      string,
      NonNullable<RacePrediction["betPayout"]>["realtime"][]
    >();
    for (const p of settled) {
      for (const pp of p.predictions ?? []) {
        const rt = pp.betPayout?.realtime;
        if (!rt) continue;
        const bucket = perPredictorBuckets.get(pp.predictorId) ?? [];
        bucket.push(rt);
        perPredictorBuckets.set(pp.predictorId, bucket);
      }
    }
    const byPredictor = new Map<string, DailyBetPayoutSnapshot>();
    for (const [predictorId, results] of perPredictorBuckets) {
      byPredictor.set(predictorId, buildDailySnapshot(date, results));
    }

    // 会場内で dayLabel は基本どのレースも同じ。先頭の non-empty を採用する。
    const dayLabel = group.find((p) => p.dayLabel)?.dayLabel ?? "";
    out.set(stadiumId, { snapshot, byPredictor, dayLabel });
  }
  return out;
};

/**
 * 当日分のスナップショットを既存の state にマージし、新しい state を返す。
 *
 * 既存の過去日エントリはそのまま残し、当日分のみ上書き。
 * `perDayByPredictor` も同様に当日分のみ各予想者の slot を上書き。
 */
export const mergeDailySnapshots = (
  state: SeriesState,
  date: string,
  daily: DailySnapshotByStadium,
): SeriesState => {
  const byStadium: Record<string, StadiumSeriesState> = { ...state.byStadium };
  for (const [stadiumId, { snapshot, byPredictor, dayLabel }] of daily) {
    const prev = byStadium[stadiumId] ?? {
      perDay: {},
      perDayByPredictor: {},
      dayLabels: {},
    };
    // 予想者別: 既存予想者の他日付エントリを保持しつつ、当日分の各予想者
    // snapshot を上書き。byPredictor が空の旧 JSON 由来データに対しては
    // ループが回らないので perDayByPredictor は維持される。
    const nextPerDayByPredictor: Record<
      string,
      Readonly<Record<string, DailyBetPayoutSnapshot>>
    > = { ...(prev.perDayByPredictor ?? {}) };
    for (const [predictorId, snap] of byPredictor) {
      const prevForPredictor = nextPerDayByPredictor[predictorId] ?? {};
      nextPerDayByPredictor[predictorId] = {
        ...prevForPredictor,
        [date]: snap,
      };
    }
    byStadium[stadiumId] = {
      perDay: { ...prev.perDay, [date]: snapshot },
      perDayByPredictor: nextPerDayByPredictor,
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
    // 予想者別: 各 predictor の per-day を同じ閾値で剪定
    const perDayByPredictor: Record<string, Readonly<Record<string, DailyBetPayoutSnapshot>>> = {};
    for (const [predictorId, predictorPerDay] of Object.entries(s.perDayByPredictor ?? {})) {
      const kept: Record<string, DailyBetPayoutSnapshot> = {};
      for (const [date, snap] of Object.entries(predictorPerDay)) {
        if (date >= oldestKeepDate) kept[date] = snap;
      }
      // 全日剪定された predictor は entry ごと削除 (退役予想者の自動掃除)
      if (Object.keys(kept).length > 0) {
        perDayByPredictor[predictorId] = kept;
      }
    }
    byStadium[stadiumId] = { perDay, perDayByPredictor, dayLabels };
  }
  return { ...state, byStadium };
};
