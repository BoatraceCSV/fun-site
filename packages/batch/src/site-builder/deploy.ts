import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { toJSTDateString } from "@fun-site/shared";
import { type Bucket, type File, Storage } from "@google-cloud/storage";

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

/**
 * デプロイ先オブジェクトに付ける `Cache-Control` を決める。
 *
 * 背景: Cloud CDN は `CACHE_ALL_STATIC` + `default_ttl` (既定 3600s) で動くため、
 * オブジェクトに `Cache-Control` が無いと HTML まで最大 1 時間 (stale 配信なら最大
 * 1 日) キャッシュされ、5 分サイクルで再ビルドしても古いトップページが表示され得る。
 *
 * 方針:
 * - `.html` … `no-cache` (キャッシュはするが利用前に必ず再検証 = 常に最新)
 * - `_astro/` 配下 … content-hash 命名で内容が変われば URL も変わるため `immutable`
 *   で 1 年キャッシュ
 * - それ以外 (favicon / robots / sitemap など) … 1 時間キャッシュ
 *
 * 注意: 下流の差分アップロードは md5Hash 一致時にスキップするため、内容が変わら
 * ないオブジェクトには新しい `Cache-Control` は反映されない。HTML は再ビルドごとに
 * 内容が変わるため次サイクルで自動的に新ヘッダへ更新される。
 */
const getCacheControl = (destination: string): string => {
  if (destination.endsWith(".html")) return "no-cache";
  if (destination.startsWith("_astro/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
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

/** デプロイで削除しない固定プレフィックス (理由は deployToStorage 内のコメント参照) */
const PROTECTED_PREFIXES = ["images/", "_meta/", "_astro/"] as const;

/** 日付でパーティションされ、当日以外は削除しないプレフィックス */
const DATE_PARTITIONED_PREFIXES = ["race/", "archive/"] as const;

const DATE_PREFIX_RE = /^(race|archive)\/(\d{4}-\d{2}-\d{2})\//;

/**
 * 今回のデプロイで GCS から一覧取得するプレフィックスを決める (pure)。
 *
 * バケット全体を毎回一覧すると過去日付の `race/` ページ (数万オブジェクト) まで
 * 走査して Class A 操作 (1,000 件 1 ページ) を数十回消費する。差分判定に必要なのは
 * ローカルの成果物と同じ場所にある既存オブジェクトだけ、削除判定に必要なのは
 * 削除対象になり得るプレフィックス配下だけなので、以下に絞る:
 *
 * - `race/` / `archive/` … 当日 (`today`) とローカル成果物に含まれる日付のサブ
 *   プレフィックスのみ (過去日付は削除もアップロードもしない)
 * - 削除対象外の固定プレフィックス (`images/` 等) … ローカル成果物がその配下に
 *   ファイルを持つときだけ (md5 比較のため)。持たなければ触らない
 * - それ以外のプレフィックス … 丸ごと (削除対象になり得る)
 *
 * @param topLevelPrefixes ルート直下の delimiter 付き一覧で得たプレフィックス (`stadium/` 等)
 * @param localDestinations ローカル成果物のデプロイ先 object name
 */
export const selectRemotePrefixes = (
  topLevelPrefixes: readonly string[],
  localDestinations: readonly string[],
  today: string,
): string[] => {
  const localDates = new Set<string>([today]);
  for (const destination of localDestinations) {
    const m = destination.match(DATE_PREFIX_RE);
    if (m?.[2]) localDates.add(m[2]);
  }
  const selected = new Set<string>();
  for (const prefix of topLevelPrefixes) {
    if ((DATE_PARTITIONED_PREFIXES as readonly string[]).includes(prefix)) {
      for (const date of localDates) selected.add(`${prefix}${date}/`);
      continue;
    }
    if (
      (PROTECTED_PREFIXES as readonly string[]).includes(prefix) &&
      !localDestinations.some((d) => d.startsWith(prefix))
    ) {
      continue;
    }
    selected.add(prefix);
  }
  return [...selected].sort();
};

/**
 * ルート直下のオブジェクトと、ルート直下のプレフィックス一覧を取得する。
 * (`delimiter: "/"` 付き一覧。`_astro/` のような「ディレクトリ」は prefixes 側に来る)
 */
const listBucketRoot = async (bucket: Bucket): Promise<{ files: File[]; prefixes: string[] }> => {
  const files: File[] = [];
  const prefixes = new Set<string>();
  let pageToken: string | undefined;
  do {
    const [pageFiles, nextQuery, apiResponse] = await bucket.getFiles({
      delimiter: "/",
      autoPaginate: false,
      maxResults: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    files.push(...pageFiles);
    for (const prefix of (apiResponse as { prefixes?: string[] } | undefined)?.prefixes ?? []) {
      prefixes.add(prefix);
    }
    pageToken = (nextQuery as { pageToken?: string } | null)?.pageToken;
  } while (pageToken);
  return { files, prefixes: [...prefixes].sort() };
};

/** Cloud Storage へデプロイ (@google-cloud/storage SDK)。
 *
 * 効率化:
 * - 既存オブジェクトの md5Hash を取得し、ローカルの MD5 と一致するものは
 *   アップロードを skip（毎回 ~330 ページ全部アップロードしていた状態を解消）
 * - 一覧はバケット全体ではなく当日分・削除対象になり得るプレフィックスに限定
 *   (過去日付の race/ ページ数万件を毎回走査しない)
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
  const todayJST = process.env["BUILD_TARGET_DATE"] ?? toJSTDateString(new Date());

  // ローカル MD5 を並列計算
  const localEntries = await mapWithConcurrency(
    localFiles,
    UPLOAD_CONCURRENCY,
    async (filePath) => {
      const destination = relative(WEB_DIST_DIR, filePath);
      const localMd5 = await computeMd5Base64(filePath);
      return { filePath, destination, localMd5 };
    },
  );

  // 既存ファイル一覧と md5Hash を取得。バケット全体ではなく、差分判定・削除判定に
  // 必要なプレフィックスだけを一覧する (selectRemotePrefixes 参照)。
  const root = await listBucketRoot(bucket);
  const remotePrefixes = selectRemotePrefixes(
    root.prefixes,
    localEntries.map((e) => e.destination),
    todayJST,
  );
  const listedPerPrefix = await mapWithConcurrency(remotePrefixes, 8, async (prefix) => {
    const [files] = await bucket.getFiles({ prefix });
    return files;
  });
  const existingFiles = [...root.files, ...listedPerPrefix.flat()];
  const existingByName = new Map<string, File>(existingFiles.map((f) => [f.name, f]));
  console.info(
    `Listed ${existingFiles.length} existing objects under ${remotePrefixes.length} prefixes`,
  );

  // 既存と比較
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
      metadata: {
        contentType: getContentType(filePath),
        cacheControl: getCacheControl(destination),
      },
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
  const toDelete = [...existingByName.keys()].filter((name) => {
    if (uploadedNames.has(name)) return false;
    if (PROTECTED_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
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
