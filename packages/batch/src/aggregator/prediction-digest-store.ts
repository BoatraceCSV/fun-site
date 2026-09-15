import type { RacePrediction } from "@fun-site/shared";
import { Storage } from "@google-cloud/storage";
import { mapHistoricalPredictions } from "../site-builder/data-writer.js";
import {
  PREDICTION_DIGEST_SCHEMA_VERSION,
  type PredictionDigest,
  toPredictionDigest,
} from "./prediction-digest.js";

/**
 * 予想者統計 / 分析軸別集計の incremental キャッシュ。
 *
 * 集計期間 (active 予想者の startedAt 〜 当日) の各日について、その日の
 * `PredictionDigest[]` を GCS に 1 ファイルずつ保持する。
 *
 * 配置: `gs://${GCS_DATA_BUCKET}/_meta/prediction-digests/{YYYY-MM-DD}.json`
 *
 * - **当日 (raceDate)** は毎ビルドでメモリ上の `RacePrediction[]` から作り直して上書きする
 *   (結果が順次確定していくため)。
 * - **過去日** はキャッシュがあればそれを使い、無ければ
 *   `gs://${GCS_DATA_BUCKET}/predictions/{date}/*.json` から射影して保存する。
 *   結果確定後の過去日は変わらないので、以後は再計算しない。
 * - `schemaVersion` が `PREDICTION_DIGEST_SCHEMA_VERSION` と違うキャッシュは無視して作り直す。
 *
 * バックフィル (`BUILD_TARGET_DATE`) ではその日が raceDate になるので、当日扱いで上書きされる。
 * 手動でキャッシュを捨てたいときは対象日のファイルを GCS から削除すればよい。
 */
export type PredictionDigestDay = {
  readonly schemaVersion: number;
  readonly date: string;
  readonly updatedAt: string;
  readonly races: readonly PredictionDigest[];
};

/** キャッシュの読み書きと、キャッシュ未ヒット時の元データからの生成。テストでは差し替える。 */
export type PredictionDigestStore = {
  /** 1 日ぶんのキャッシュ。未存在・破損時は undefined。 */
  readonly load: (date: string) => Promise<PredictionDigestDay | undefined>;
  readonly save: (day: PredictionDigestDay) => Promise<void>;
  /** キャッシュ未ヒット時に元の予想 JSON から射影する。 */
  readonly buildFromSource: (date: string) => Promise<PredictionDigest[]>;
};

const DATA_BUCKET = process.env["GCS_DATA_BUCKET"] ?? "fun-site-data-boatrace-487212";
const DIGEST_PREFIX = "_meta/prediction-digests";

export const digestObjectName = (date: string): string => `${DIGEST_PREFIX}/${date}.json`;

let storage: Storage | undefined;
const getStorage = (): Storage => {
  if (!storage) storage = new Storage();
  return storage;
};

const isDigestDay = (value: unknown): value is PredictionDigestDay => {
  if (!value || typeof value !== "object") return false;
  const obj = value as Partial<PredictionDigestDay>;
  return (
    typeof obj.schemaVersion === "number" &&
    typeof obj.date === "string" &&
    Array.isArray(obj.races)
  );
};

export const gcsPredictionDigestStore: PredictionDigestStore = {
  load: async (date) => {
    const file = getStorage().bucket(DATA_BUCKET).file(digestObjectName(date));
    try {
      const [buffer] = await file.download();
      const parsed = JSON.parse(buffer.toString("utf-8")) as unknown;
      return isDigestDay(parsed) ? parsed : undefined;
    } catch (error) {
      const code = (error as { code?: number } | undefined)?.code;
      if (code !== 404) {
        console.warn(
          `Failed to load prediction digest for ${date}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return undefined;
    }
  },
  save: async (day) => {
    const file = getStorage().bucket(DATA_BUCKET).file(digestObjectName(day.date));
    await file.save(JSON.stringify(day), {
      contentType: "application/json; charset=utf-8",
      metadata: { cacheControl: "no-store" },
    });
  },
  buildFromSource: (date) => mapHistoricalPredictions(date, toPredictionDigest),
};

const toDigestDay = (date: string, races: readonly PredictionDigest[]): PredictionDigestDay => ({
  schemaVersion: PREDICTION_DIGEST_SCHEMA_VERSION,
  date,
  updatedAt: new Date().toISOString(),
  races,
});

/** 過去日の再構築を同時に走らせる日数。1 日の中でさらに 16 並列で JSON を読む。 */
const DATE_CONCURRENCY = 4;

export type CollectPredictionDigestsArgs = {
  /** 集計対象の日付 (昇順・inclusive)。`datesForActivePredictors()` の結果。 */
  readonly dates: readonly string[];
  /** 今回ビルドしている日。`dates` に含まれていればメモリ上の予想から作り直す。 */
  readonly raceDate: string;
  /** 今回ビルドした `RacePrediction[]` (raceDate ぶん)。 */
  readonly currentPredictions: readonly RacePrediction[];
  readonly store?: PredictionDigestStore;
};

/**
 * 集計期間ぶんの `PredictionDigest[]` を日付順に平坦化して返す。
 *
 * 返り値は数か月ぶんでも数 MB に収まる (1 レース数百バイト × 予想者数)。
 * `RacePrediction` 全体を保持しないので、期間が伸びてもメモリはほぼ一定。
 * キャッシュの保存失敗は非致命 (次回また元データから作るだけ)。
 */
export const collectPredictionDigests = async (
  args: CollectPredictionDigestsArgs,
): Promise<PredictionDigest[]> => {
  const store = args.store ?? gcsPredictionDigestStore;
  const byDate = new Map<string, readonly PredictionDigest[]>();
  let cacheHits = 0;
  let rebuilt = 0;
  let saveFailures = 0;

  const persist = async (date: string, races: readonly PredictionDigest[]): Promise<void> => {
    try {
      await store.save(toDigestDay(date, races));
    } catch (error) {
      saveFailures += 1;
      console.warn(
        `Failed to save prediction digest for ${date} (non-fatal): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const resolveDate = async (date: string): Promise<void> => {
    if (date === args.raceDate) {
      const races = args.currentPredictions.map(toPredictionDigest);
      byDate.set(date, races);
      await persist(date, races);
      return;
    }
    const cached = await store.load(date);
    if (cached && cached.schemaVersion === PREDICTION_DIGEST_SCHEMA_VERSION) {
      cacheHits += 1;
      byDate.set(date, cached.races);
      return;
    }
    const races = await store.buildFromSource(date);
    rebuilt += 1;
    byDate.set(date, races);
    // 元データの一覧取得に失敗しても空配列が返るため、空の日は保存しない
    // (保存すると一時的な取得失敗が恒久的な「レース無し」として固定されてしまう)。
    if (races.length > 0) await persist(date, races);
  };

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(DATE_CONCURRENCY, args.dates.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= args.dates.length) return;
        const date = args.dates[i];
        if (!date) return;
        await resolveDate(date);
      }
    },
  );
  await Promise.all(workers);

  const out: PredictionDigest[] = [];
  for (const date of args.dates) {
    const races = byDate.get(date);
    if (races) out.push(...races);
  }
  console.info(
    `Collected ${out.length} prediction digests over ${args.dates.length} day(s) (cache hits=${cacheHits}, rebuilt=${rebuilt}, save failures=${saveFailures})`,
  );
  return out;
};
