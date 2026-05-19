import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { toJSTDateString } from "@fun-site/shared";
import { type File, Storage } from "@google-cloud/storage";

const WEB_DIST_DIR = resolve(import.meta.dirname, "../../../web/dist");
// バケット名は Terraform の `${local.prefix}-web-${var.project_id}` 規則で
// 生成される (例: fun-site-web-boatrace-487212)。Cloud Run Job では
// GCS_WEB_BUCKET 環境変数経由で渡されるが、ローカル実行用にもデフォルトを
// 同じ値に揃えておく。別プロジェクトで動かすときは GCS_WEB_BUCKET で上書き。
const BUCKET_NAME = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web-boatrace-487212";

// 並列アップロード数（asia-northeast1 GCS への HTTP/2 多重化を活かす）
const UPLOAD_CONCURRENCY = 16;

const storage = new Storage();

/** ディレクトリ内の全ファイルを再帰的に取得 */
const listFilesRecursively = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
};

/** ファイル拡張子から Content-Type を推定 */
const getContentType = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    xml: "application/xml",
    txt: "text/plain; charset=utf-8",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return contentTypes[ext ?? ""] ?? "application/octet-stream";
};

/** ファイルの MD5 を base64 文字列で返す（GCS metadata.md5Hash と同形式） */
const computeMd5Base64 = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("base64")));
  });

/** 並列度を制限しながら配列を処理 */
const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      results[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
};

/** Cloud Storage へデプロイ (@google-cloud/storage SDK)。
 *
 * 効率化:
 * - 既存オブジェクトの md5Hash を一括取得し、ローカルの MD5 と一致するものは
 *   アップロードを skip（毎回 ~330 ページ全部アップロードしていた状態を解消）
 * - アップロードは並列度 ${UPLOAD_CONCURRENCY} で実行
 * - 削除も並列化
 */
export const deployToStorage = async (): Promise<void> => {
  console.info(`Deploying ${WEB_DIST_DIR} to gs://${BUCKET_NAME}/...`);

  // ビルド成果物の存在確認
  const distStat = await stat(WEB_DIST_DIR).catch(() => null);
  if (!distStat?.isDirectory()) {
    throw new Error(`Build output directory not found: ${WEB_DIST_DIR}`);
  }

  const localFiles = await listFilesRecursively(WEB_DIST_DIR);
  if (localFiles.length === 0) {
    throw new Error("Build output directory is empty");
  }

  console.info(`Found ${localFiles.length} files locally`);

  const bucket = storage.bucket(BUCKET_NAME);

  // 既存ファイル一覧と md5Hash を一括取得
  const [existingFiles] = await bucket.getFiles();
  const existingByName = new Map<string, File>(existingFiles.map((f) => [f.name, f]));

  // ローカル MD5 を並列計算 + 既存と比較
  const localEntries = await mapWithConcurrency(
    localFiles,
    UPLOAD_CONCURRENCY,
    async (filePath) => {
      const destination = relative(WEB_DIST_DIR, filePath);
      const localMd5 = await computeMd5Base64(filePath);
      return { filePath, destination, localMd5 };
    },
  );

  const toUpload: typeof localEntries = [];
  let unchanged = 0;
  for (const entry of localEntries) {
    const existing = existingByName.get(entry.destination);
    const remoteMd5 = existing?.metadata.md5Hash;
    if (remoteMd5 && remoteMd5 === entry.localMd5) {
      unchanged++;
      continue;
    }
    toUpload.push(entry);
  }

  // アップロード（差分のみ、並列）
  await mapWithConcurrency(toUpload, UPLOAD_CONCURRENCY, async ({ filePath, destination }) => {
    await bucket.upload(filePath, {
      destination,
      metadata: { contentType: getContentType(filePath) },
    });
  });

  console.info(`Uploaded ${toUpload.length} changed files (skipped ${unchanged} unchanged)`);

  // ローカルに存在しないリモートファイルを削除（rsync -d 相当）
  // images/ プレフィックスは画像生成ステップで別途アップロードされるため除外
  // _meta/ は last-build.json などの内部メタを置く領域なので削除対象から除外
  // _astro/ は Astro が content-hash で名付ける CSS/JS のチャンク。残置される
  //   過去日付ページ(下記)がこれらを参照しているため、削除すると過去ページの
  //   CSS / JS が 404 になる。content-hash 命名なので同名上書きはなく、
  //   蓄積しても破綻しない (必要なら別途まとめてクリーンアップ)。
  //
  // 5 分サイクルでの再ビルドは当日分のみを対象とする (lib/data.ts) ため、
  // 過去日付の race / archive ページはローカルに存在せず、素朴な削除フィルタだと
  // GCS から消えてしまう。過去日付のページは既にデプロイ済みでそのまま公開可能なので、
  // `race/YYYY-MM-DD/...` / `archive/YYYY-MM-DD/...` のうち日付が当日以外のものは
  // 削除対象から除外する。
  const uploadedNames = new Set(localEntries.map((e) => e.destination));
  const todayJST = process.env["BUILD_TARGET_DATE"] ?? toJSTDateString(new Date());
  const DATE_PREFIX_RE = /^(race|archive)\/(\d{4}-\d{2}-\d{2})\//;
  const toDelete = [...existingByName.keys()].filter((name) => {
    if (uploadedNames.has(name)) return false;
    if (name.startsWith("images/") || name.startsWith("_meta/") || name.startsWith("_astro/")) {
      return false;
    }
    const m = name.match(DATE_PREFIX_RE);
    if (m && m[2] !== todayJST) return false;
    return true;
  });
  if (toDelete.length > 0) {
    await mapWithConcurrency(toDelete, UPLOAD_CONCURRENCY, async (name) => {
      await bucket.file(name).delete();
    });
    console.info(`Deleted ${toDelete.length} stale files`);
  }

  console.info("Deploy completed");
};
