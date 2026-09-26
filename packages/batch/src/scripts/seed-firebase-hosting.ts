/**
 * GCS Web バケットの公開ファイルを丸ごと Firebase Hosting に release するワンショット。
 *
 * 背景:
 *   バッチの再ビルドは当日分のページしか生成しないため、Firebase Hosting への
 *   通常デプロイ (`deployToFirebaseHosting`) は「前回 release のファイル一覧 +
 *   今回の成果物」で version を組み立てる。最初の 1 回は前回 release が無いので、
 *   これまで GCS Web バケットで配信してきた過去日付のページを含む全ファイルを
 *   このスクリプトで release しておく。
 *
 * 動作:
 *   1. サイトの保持 version 数の上限を設定 (FIREBASE_MAX_VERSIONS)
 *   2. Web バケットの全オブジェクト (`_meta/` を除く) を 1,000 件ずつダウンロード →
 *      gzip 後ハッシュを計算 → version に追加し、Firebase 側に中身が無いものだけ
 *      アップロード (4 チャンク並列)
 *   3. version を確定して release し、manifest を `_meta/` に保存
 *
 *   何度実行しても同じ結果になる (中身が同じファイルはアップロードされない)。
 *   移行期間中 (DEPLOY_TARGETS=gcs のまま) に日をまたいだ場合は、
 *   DEPLOY_TARGETS に firebase を加える直前にもう一度実行すること。
 *
 * 実行:
 *   pnpm --filter @fun-site/batch run seed-firebase-hosting
 *
 * 環境変数:
 *   GCS_WEB_BUCKET         (既定: fun-site-web-boatrace-487212)
 *   FIREBASE_HOSTING_SITE  (既定: boatrace-fun)
 *   FIREBASE_MAX_VERSIONS  (既定: 5)
 */
import { Storage } from "@google-cloud/storage";
import { mapWithConcurrency } from "../site-builder/deploy.js";
import {
  chunk,
  createVersion,
  finalizeAndRelease,
  gzipAndHash,
  populateVersion,
  saveManifest,
  setMaxVersions,
} from "../site-builder/firebase-hosting.js";

const BUCKET = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web-boatrace-487212";
const MAX_VERSIONS = Number(process.env["FIREBASE_MAX_VERSIONS"] ?? "5");
/** 1 チャンクの中でダウンロードする並列数 */
const DOWNLOAD_CONCURRENCY = 32;
/** 同時に処理するチャンク数 (チャンク = populateFiles 1 回ぶんの 1,000 件) */
const CHUNK_CONCURRENCY = 4;
const CHUNK_SIZE = 1000;

const main = async (): Promise<void> => {
  await setMaxVersions(MAX_VERSIONS);
  console.info(`Set maxVersions=${MAX_VERSIONS}`);

  const bucket = new Storage().bucket(BUCKET);
  const [objects] = await bucket.getFiles();
  const targets = objects.filter((o) => !(o.name.startsWith("_meta/") || o.name.endsWith("/")));
  const chunks = chunk(targets, CHUNK_SIZE);
  console.info(`Seeding ${targets.length} objects from gs://${BUCKET} in ${chunks.length} chunks`);

  // 1,000 件ずつ「ダウンロード → ハッシュ → populateFiles → 要求された分だけ
  // アップロード」を 1 パスで行う。ハッシュを取った内容をそのまま送るので、
  // 実行中にバッチが当日ページを上書きしても内容とハッシュは食い違わない。
  const version = await createVersion();
  const files: Record<string, string> = {};
  let done = 0;
  let uploaded = 0;
  const startedAt = Date.now();
  await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, async (objectsInChunk) => {
    const contents = new Map<string, Buffer>();
    const entries = await mapWithConcurrency(
      objectsInChunk,
      DOWNLOAD_CONCURRENCY,
      async (object): Promise<[string, string]> => {
        const [content] = await object.download();
        const { gzipped, hash } = gzipAndHash(content);
        contents.set(hash, gzipped);
        return [object.name, hash];
      },
    );
    // await より前に uploaded を読むと並列チャンク間で加算が失われるので、先に待つ
    const uploadedInChunk = await populateVersion(version, entries, async (hash) =>
      contents.get(hash),
    );
    uploaded += uploadedInChunk;
    for (const [name, hash] of entries) files[name] = hash;
    done += entries.length;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.info(`  ${done}/${targets.length} files (uploaded ${uploaded}) in ${elapsed}s`);
  });

  await finalizeAndRelease(version);
  console.info(`Released ${version} (${done} files, uploaded ${uploaded} new contents)`);
  await saveManifest({ version, files });
  console.info("Seed completed");
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
