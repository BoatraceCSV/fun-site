import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type RacePrediction,
  type SeriesBetPayoutAggregate,
  toJSTDateString,
} from "@fun-site/shared";

const RACES_DIR = resolve(process.cwd(), "src/data/races");
const DATES_INDEX_PATH = resolve(process.cwd(), "src/data/_meta/dates.json");
const SERIES_SUMMARY_PATH = resolve(process.cwd(), "src/data/_meta/series-summary.json");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ビルド対象日（JST 当日）。
 *
 * `BUILD_TARGET_DATE` で明示指定可能（CI / バックフィル用）。
 * `BUILD_ALL_DATES=1` のときは過去日付も巻き込んでビルドする
 *  (`loadAvailableDates` 側で参照される)。
 */
const getBuildTargetDate = (): string => {
  const override = process.env["BUILD_TARGET_DATE"];
  return override && /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : toJSTDateString(new Date());
};

/** 新スキーマか判定（旧 RacePrediction JSON を読み飛ばすガード） */
const isNewSchema = (json: unknown): json is RacePrediction => {
  if (!json || typeof json !== "object") return false;
  const obj = json as Record<string, unknown>;
  return (
    typeof obj.raceCode === "string" &&
    typeof obj.stadiumId === "string" &&
    obj.startPrediction !== undefined &&
    obj.aiEvaluation !== undefined &&
    Array.isArray(obj.racers)
  );
};

/** 指定日付の全予想データを読み込み */
export const loadPredictions = async (date: string): Promise<RacePrediction[]> => {
  const dir = resolve(RACES_DIR, date);
  try {
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const parsed = await Promise.all(
      jsonFiles.map(async (f) => {
        const content = await readFile(resolve(dir, f), "utf-8");
        try {
          return JSON.parse(content) as unknown;
        } catch {
          return undefined;
        }
      }),
    );
    const predictions = parsed.filter(isNewSchema);
    // 古い JSON 互換: dayLabel / grade が未設定の場合は空文字で埋める
    const normalized = predictions.map((p) => ({
      ...p,
      dayLabel: typeof p.dayLabel === "string" ? p.dayLabel : "",
      grade: typeof p.grade === "string" ? p.grade : "",
    }));
    return normalized.sort((a, b) => {
      if (a.stadiumId !== b.stadiumId) return a.stadiumId.localeCompare(b.stadiumId);
      return a.raceNumber - b.raceNumber;
    });
  } catch {
    return [];
  }
};

/**
 * ビルド対象の日付一覧を取得する。
 *
 * 既定では JST 当日 1 件のみを返す（preview-realtime 5 分サイクルでの再ビルドを
 * 当日分に絞り、Astro の getStaticPaths が過去日付の JSON まで読み込んで
 * ページ数が線形に肥大化するのを防ぐ）。
 *
 * 過去日付の HTML / アセットは `deploy.ts` 側で削除フィルタに引っかからない
 * ため GCS 上に残置され、ユーザは引き続き URL で参照可能。
 *
 * `BUILD_ALL_DATES=1` を設定するとローカル / 開発用に全日付を返す。
 */
export const loadAvailableDates = async (): Promise<string[]> => {
  try {
    const entries = await readdir(RACES_DIR);
    const all = entries
      .filter((e) => DATE_RE.test(e))
      .sort()
      .reverse();
    if (process.env["BUILD_ALL_DATES"] === "1") return all;
    const target = getBuildTargetDate();
    return all.filter((d) => d === target);
  } catch {
    return [];
  }
};

/**
 * `src/data/_meta/dates.json` をベースにした「過去公開済み日付」一覧。
 *
 * バッチが GCS から取得した `_meta/dates.json` を Astro ビルド前にこの位置へ
 * 書き出しており、これまでに GCS Web バケットへデプロイされた全日付を返す
 * (降順)。`/archive/` インデックスや `/archive/[date]` の「他の日付」など、
 * 過去ページへの導線を描画するために使う。
 *
 * `loadAvailableDates` とは別関数。`loadAvailableDates` を変更すると
 * トップページや archive ページの getStaticPaths が過去日まで生成して
 * しまうため、用途を分けている。
 *
 * ファイルが無い / 壊れている場合は空配列を返す (ローカル開発で初回ビルド
 * 前など)。
 */
export const loadHistoricalDates = async (): Promise<string[]> => {
  try {
    const content = await readFile(DATES_INDEX_PATH, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const dates = (parsed as { dates?: unknown }).dates;
    if (!Array.isArray(dates)) return [];
    return dates
      .filter((d): d is string => typeof d === "string" && DATE_RE.test(d))
      .sort()
      .reverse();
  } catch {
    return [];
  }
};

/**
 * `_meta/series-summary.json` から会場別の節集計を読み込む。
 *
 * バッチ (`series-aggregator.ts`) が書き出した、当日基準の節集計
 * (`realtime` 戦略・初日〜当日)。ファイルが無い / 壊れている場合は null を返す
 * (会場ページ側で「節成績セクションを出さない」フォールバックを取る)。
 *
 * 形式:
 *
 * ```jsonc
 * {
 *   "updatedAt": "ISO 日時",
 *   "raceDate": "YYYY-MM-DD",
 *   "byStadium": { "01": SeriesBetPayoutAggregate, ... }
 * }
 * ```
 *
 * 24 会場分を 1 度ロードしてマップで持つ想定。`getStaticPaths` から呼ぶ場合は
 * 結果を呼び出し側でキャッシュすること (このロード自体はメモ化していない)。
 */
export type SeriesSummaryFile = {
  readonly updatedAt: string;
  readonly raceDate: string;
  readonly byStadium: Readonly<Record<string, SeriesBetPayoutAggregate>>;
};

export const loadSeriesSummary = async (): Promise<SeriesSummaryFile | null> => {
  try {
    const content = await readFile(SERIES_SUMMARY_PATH, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Partial<SeriesSummaryFile>;
    if (typeof obj.raceDate !== "string" || !DATE_RE.test(obj.raceDate)) return null;
    if (!obj.byStadium || typeof obj.byStadium !== "object") return null;
    return {
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : "",
      raceDate: obj.raceDate,
      byStadium: obj.byStadium,
    };
  } catch {
    return null;
  }
};
