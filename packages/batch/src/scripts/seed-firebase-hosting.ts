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
 *   2. Web バケットの全オブジェクト (`_meta/` を除く) をダウンロードして
 *      gzip 後ハッシュを計算
 *   3. その一覧で version を作って release し、manifest を `_meta/` に保存
 *      (Firebase 側に中身が無いハッシュだけ再ダウンロードしてアップロード)
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
  gzipAndHash,
  releaseFiles,
  saveManifest,
  setMaxVersions,
} from "../site-builder/firebase-hosting.js";

const BUCKET = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web-boatrace-487212";
const MAX_VERSIONS = Number(process.env["FIREBASE_MAX_VERSIONS"] ?? "5");
const CONCURRENCY = 32;

const main = async (): Promise<void> => {
  await setMaxVersions(MAX_VERSIONS);
  console.info(`Set maxVersions=${MAX_VERSIONS}`);

  const bucket = new Storage().bucket(BUCKET);
  const [objects] = await bucket.getFiles();
  const names = objects
    .map((o) => o.name)
    .filter((n) => !(n.startsWith("_meta/") || n.endsWith("/")));
  console.info(`Hashing ${names.length} objects from gs://${BUCKET}...`);

  const nameByHash = new Map<string, string>();
  const files: Record<string, string> = {};
  let done = 0;
  await mapWithConcurrency(names, CONCURRENCY, async (name) => {
    const [content] = await bucket.file(name).download();
    const { hash } = gzipAndHash(content);
    files[name] = hash;
    nameByHash.set(hash, name);
    if (++done % 5000 === 0) console.info(`  hashed ${done}/${names.length}`);
  });

  const version = await releaseFiles(files, async (hash) => {
    const name = nameByHash.get(hash);
    if (!name) return undefined;
    const [content] = await bucket.file(name).download();
    return gzipAndHash(content).gzipped;
  });
  await saveManifest({ version, files });
  console.info("Seed completed");
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
