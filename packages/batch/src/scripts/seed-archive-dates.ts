/**
 * 過去にデプロイされた archive ページを GCS Web バケットから列挙し、
 * `_meta/dates.json` をシードするワンショットスクリプト。
 *
 * 通常運用ではバッチが毎ビルドで dates.json を追記する。本スクリプトは
 * 機能導入直後にだけ実行し、既存の公開済み過去ページをインデックスへ取り込む。
 *
 * 実行:
 *   pnpm --filter @fun-site/batch run seed-archive-dates
 *   DRY_RUN=1 pnpm --filter @fun-site/batch run seed-archive-dates
 *
 * 環境変数:
 *   GCS_WEB_BUCKET (既定: fun-site-web-boatrace-487212)
 *   DRY_RUN=1       書き込まずに内容のみ標準出力に表示
 *
 * 要: gcloud auth application-default login
 */
import { Storage } from "@google-cloud/storage";
import { fetchDatesIndex, saveDatesIndex } from "../site-builder/dates-index.js";

const BUCKET = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web-boatrace-487212";
const DRY_RUN = process.env["DRY_RUN"] === "1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const storage = new Storage();

/**
 * `archive/` プレフィックス配下のディレクトリ (delimiter "/") を列挙して
 * YYYY-MM-DD 形式の日付を抽出する。
 *
 * @google-cloud/storage の getFiles は autoPaginate=false 時に
 * [files, nextQuery, apiResponse] を返し、apiResponse.prefixes に
 * デリミタで切られたサブディレクトリ名が入る。
 */
const listArchiveDates = async (): Promise<string[]> => {
  const bucket = storage.bucket(BUCKET);
  const dates = new Set<string>();
  let pageToken: string | undefined;
  while (true) {
    const response = await bucket.getFiles({
      prefix: "archive/",
      delimiter: "/",
      autoPaginate: false,
      maxResults: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    // [files, nextQuery, apiResponse]
    const apiResponse = response[2] as { prefixes?: string[]; nextPageToken?: string } | undefined;
    const prefixes = apiResponse?.prefixes ?? [];
    for (const p of prefixes) {
      const m = p.match(/^archive\/(\d{4}-\d{2}-\d{2})\/$/);
      if (m?.[1] && DATE_RE.test(m[1])) dates.add(m[1]);
    }
    pageToken = apiResponse?.nextPageToken;
    if (!pageToken) break;
  }
  return [...dates].sort();
};

const main = async (): Promise<void> => {
  console.info(`Bucket: gs://${BUCKET}`);
  console.info("Listing archive/<date>/ prefixes...");
  const fromBucket = await listArchiveDates();
  console.info(`Found ${fromBucket.length} dates from bucket listing`);

  const existing = await fetchDatesIndex();
  console.info(`Existing dates.json had ${existing.length} entries`);

  // saveDatesIndex 内部で normalize (重複除去 + ソート) するため、ここでは結合のみ。
  const merged = [...existing, ...fromBucket];

  if (DRY_RUN) {
    const unique = [...new Set(merged)].sort();
    console.info(`DRY_RUN=1 → not writing. Merged total: ${unique.length} dates`);
    console.info(JSON.stringify({ dates: unique }, null, 2));
    return;
  }

  await saveDatesIndex(merged);
  console.info(`Wrote gs://${BUCKET}/_meta/dates.json`);
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
