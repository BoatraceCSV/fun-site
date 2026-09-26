import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { toJSTDateString } from "@fun-site/shared";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth } from "google-auth-library";
import { WEB_DIST_DIR, isStaleRemote, listFilesRecursively, mapWithConcurrency } from "./deploy.js";

/**
 * Firebase Hosting へのデプロイ (REST API 直叩き)。
 *
 * Firebase Hosting の version は「サイト全体のファイル一覧」のスナップショットで、
 * 差分だけを release することはできない。一方バッチの再ビルドは当日分のページ
 * だけを生成する (過去日付の race/ ページはローカルに無い) ため、前回 release の
 * ファイル一覧 (パス → ハッシュ) を manifest として Web バケットの `_meta/` に持ち、
 * 「前回の一覧 - 削除対象 + 今回の成果物」で新しい version を組み立てる。
 * 中身がすでに Firebase 側にあるファイル (ハッシュ一致) はアップロード不要なので、
 * 実際に送るのは変化したファイルだけになる。
 *
 * API の流れ: versions.create → versions.populateFiles (1,000 件ずつ) →
 * 要求されたハッシュだけ upload → versions.patch(status=FINALIZED) → releases.create
 */

const API = "https://firebasehosting.googleapis.com/v1beta1";

const SITE_ID = process.env["FIREBASE_HOSTING_SITE"] ?? "boatrace-fun";

const WEB_BUCKET = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web-boatrace-487212";

const MANIFEST_OBJECT_NAME = "_meta/firebase-hosting-manifest.json.gz";

/** populateFiles 1 回あたりの最大ファイル数 (API 上限) */
const POPULATE_BATCH_SIZE = 1000;

/**
 * populateFiles を並列に送る数。サイトは 5 万件超あり、差分が数十件でも毎回
 * 全件の一覧を送り直す必要がある。直列だと 54 回 × 約 2 秒 = 約 110 秒かかり、
 * 1 日 100 回走るバッチの課金時間を大きく押し上げていた。
 */
const POPULATE_CONCURRENCY = 8;

const UPLOAD_CONCURRENCY = 16;

/** パス (先頭 `/` なし、GCS の object name と同形式) → gzip 後内容の SHA-256 hex */
export type HostingFileMap = Readonly<Record<string, string>>;

type HostingManifest = {
  /** この一覧で release した version の name (`sites/{site}/versions/{id}`) */
  readonly version: string;
  readonly files: HostingFileMap;
};

/**
 * version に付ける配信設定。
 *
 * - `_astro/` … content-hash 命名なので 1 年 immutable
 * - HTML (ディレクトリ URL / 拡張子なし / `.html`) … ブラウザは毎回再検証。
 *   Firebase の CDN は release ごとに全キャッシュを破棄するので、CDN 側
 *   (`s-maxage`) は長くしても古いページは配信されない
 * - それ以外 … Firebase 既定 (`max-age=3600`)
 *
 * header の source はリクエスト URL のパスに対して評価されるため、
 * `/race/.../` のようなディレクトリ URL も HTML として扱う正規表現にしている。
 */
export const HOSTING_CONFIG = {
  headers: [
    {
      glob: "/_astro/**",
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
    {
      regex: "^/(?:.*/)?(?:[^/.]*|[^/]*\\.html)$",
      headers: { "Cache-Control": "public, max-age=0, s-maxage=86400, must-revalidate" },
    },
  ],
} as const;

/** 内容を gzip してハッシュを取る。Firebase Hosting は gzip 後の SHA-256 で内容を識別する */
export const gzipAndHash = (content: Buffer): { gzipped: Buffer; hash: string } => {
  // Node の gzip ヘッダは mtime=0 固定なので、同じ内容なら同じハッシュになる
  const gzipped = gzipSync(content);
  return { gzipped, hash: createHash("sha256").update(gzipped).digest("hex") };
};

/**
 * 前回 release のファイル一覧と今回の成果物から、新しい version のファイル一覧を
 * 作る (pure)。削除判定は GCS デプロイと同じ `isStaleRemote`。
 */
export const mergeHostingFiles = (
  previous: HostingFileMap,
  local: readonly { readonly path: string; readonly hash: string }[],
  today: string,
): Record<string, string> => {
  const localNames = new Set(local.map((e) => e.path));
  const merged: Record<string, string> = {};
  for (const [path, hash] of Object.entries(previous)) {
    if (!isStaleRemote(path, localNames, today)) merged[path] = hash;
  }
  for (const { path, hash } of local) merged[path] = hash;
  return merged;
};

/** 配列を size 件ずつに分ける */
export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

// -----------------------------------------------------------------------------
// REST client
// -----------------------------------------------------------------------------

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
  for (let attempt = 1; ; attempt++) {
    const token = await auth.getAccessToken();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    });
    if (res.ok) return res;
    if (attempt < 4 && RETRYABLE_STATUS.has(res.status)) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(
      `Firebase Hosting API ${init.method ?? "GET"} ${url} failed: ${res.status} ${await res.text()}`,
    );
  }
};

const requestJson = async <T>(url: string, method: string, body?: unknown): Promise<T> => {
  const res = await request(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await res.json()) as T;
};

/** 現在 live の release が指す version name。release が無ければ undefined */
export const getLiveVersion = async (siteId = SITE_ID): Promise<string | undefined> => {
  const res = await requestJson<{ releases?: { version?: { name?: string } }[] }>(
    `${API}/sites/${siteId}/releases?pageSize=1`,
    "GET",
  );
  return res.releases?.[0]?.version?.name;
};

/** version のファイル一覧を API から取得する (manifest が無い・古いときの復元用) */
export const listVersionFiles = async (version: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = await requestJson<{
      files?: { path: string; hash: string }[];
      nextPageToken?: string;
    }>(`${API}/${version}/files?${query}`, "GET");
    for (const f of res.files ?? []) files[f.path.replace(/^\//, "")] = f.hash;
    pageToken = res.nextPageToken || undefined;
  } while (pageToken);
  return files;
};

/** サイトが保持する FINALIZED version 数の上限を設定する (ストレージ課金の抑制) */
export const setMaxVersions = async (maxVersions: number, siteId = SITE_ID): Promise<void> => {
  await requestJson(`${API}/sites/${siteId}/config?updateMask=maxVersions`, "PATCH", {
    maxVersions,
  });
};

/** 新しい version を作成し、その name (`sites/{site}/versions/{id}`) を返す */
export const createVersion = async (siteId = SITE_ID): Promise<string> => {
  const version = await requestJson<{ name: string }>(`${API}/sites/${siteId}/versions`, "POST", {
    config: HOSTING_CONFIG,
  });
  return version.name;
};

/**
 * version にファイル一覧 `entries` (パス → ハッシュ) を追加し、Firebase 側に中身が
 * 無いハッシュだけアップロードする。populateFiles の上限 (1,000 件) ごとに分け、
 * `POPULATE_CONCURRENCY` 並列で送る。
 *
 * `getUpload` はハッシュから gzip 済み内容を返す。中身が得られない場合
 * (= 前回一覧にあるのに Firebase 側に中身が無い) はエラーにする。
 *
 * @returns アップロードした件数
 */
export const populateVersion = async (
  version: string,
  entries: readonly (readonly [string, string])[],
  getUpload: (hash: string) => Promise<Buffer | undefined>,
): Promise<number> => {
  const uploadedPerBatch = await mapWithConcurrency(
    chunk(entries, POPULATE_BATCH_SIZE),
    POPULATE_CONCURRENCY,
    async (batch) => {
      const res = await requestJson<{ uploadRequiredHashes?: string[]; uploadUrl: string }>(
        `${API}/${version}:populateFiles`,
        "POST",
        { files: Object.fromEntries(batch.map(([path, hash]) => [`/${path}`, hash])) },
      );
      const required = res.uploadRequiredHashes ?? [];
      await mapWithConcurrency(required, UPLOAD_CONCURRENCY, async (hash) => {
        const body = await getUpload(hash);
        if (!body) {
          throw new Error(`Firebase Hosting requires content for ${hash}, but it is not available`);
        }
        await request(`${res.uploadUrl}/${hash}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(body),
        });
      });
      return required.length;
    },
  );
  return uploadedPerBatch.reduce((a, b) => a + b, 0);
};

/** version を確定 (FINALIZED) して release する */
export const finalizeAndRelease = async (version: string, siteId = SITE_ID): Promise<void> => {
  await requestJson(`${API}/${version}?updateMask=status`, "PATCH", { status: "FINALIZED" });
  await requestJson(
    `${API}/sites/${siteId}/releases?versionName=${encodeURIComponent(version)}`,
    "POST",
    {},
  );
};

/**
 * ファイル一覧 `files` で新しい version を作って release する。
 *
 * @returns release した version name
 */
export const releaseFiles = async (
  files: HostingFileMap,
  getUpload: (hash: string) => Promise<Buffer | undefined>,
  siteId = SITE_ID,
): Promise<string> => {
  const version = await createVersion(siteId);
  const entries = Object.entries(files);
  const uploaded = await populateVersion(version, entries, getUpload);
  await finalizeAndRelease(version, siteId);
  console.info(`Released ${version} (${entries.length} files, uploaded ${uploaded} new contents)`);
  return version;
};

// -----------------------------------------------------------------------------
// Manifest (前回 release のファイル一覧)
// -----------------------------------------------------------------------------

let storage: Storage | undefined;
const getStorage = (): Storage => {
  if (!storage) storage = new Storage();
  return storage;
};

const loadManifest = async (): Promise<HostingManifest | undefined> => {
  try {
    const [buffer] = await getStorage().bucket(WEB_BUCKET).file(MANIFEST_OBJECT_NAME).download();
    return JSON.parse(gunzipSync(buffer).toString("utf-8")) as HostingManifest;
  } catch (error) {
    if ((error as { code?: number } | undefined)?.code === 404) return undefined;
    throw error;
  }
};

export const saveManifest = async (manifest: HostingManifest): Promise<void> => {
  await getStorage()
    .bucket(WEB_BUCKET)
    .file(MANIFEST_OBJECT_NAME)
    .save(gzipSync(JSON.stringify(manifest)), {
      contentType: "application/gzip",
      metadata: { cacheControl: "no-store" },
    });
};

/**
 * live release のファイル一覧を得る。manifest が live version と一致すればそれを使い、
 * 食い違う (手動 rollback・前回の manifest 保存失敗など) ときは API から復元する。
 * release がまだ無い (seed 前) ときは undefined。
 */
const loadLiveFiles = async (): Promise<{ version: string; files: HostingFileMap } | undefined> => {
  const live = await getLiveVersion();
  if (!live) return undefined;
  const manifest = await loadManifest();
  if (manifest?.version === live) return manifest;
  console.warn(
    `Firebase Hosting manifest (${manifest?.version ?? "none"}) does not match live ${live}; rebuilding from API`,
  );
  return { version: live, files: await listVersionFiles(live) };
};

/** `packages/web/dist` を Firebase Hosting にデプロイする */
export const deployToFirebaseHosting = async (): Promise<void> => {
  console.info(`Deploying ${WEB_DIST_DIR} to Firebase Hosting site ${SITE_ID}...`);
  const todayJST = process.env["BUILD_TARGET_DATE"] ?? toJSTDateString(new Date());

  const localFiles = await listFilesRecursively(WEB_DIST_DIR);
  if (localFiles.length === 0) throw new Error("Build output directory is empty");

  const uploads = new Map<string, Buffer>();
  const local = await mapWithConcurrency(localFiles, UPLOAD_CONCURRENCY, async (filePath) => {
    const path = relative(WEB_DIST_DIR, filePath);
    const { gzipped, hash } = gzipAndHash(await readFile(filePath));
    uploads.set(hash, gzipped);
    return { path, hash };
  });

  // seed (過去日付ページの初回投入) 前に当日分だけで release すると、過去ページが
  // 全部 404 のサイトが公開されてしまう。seed されるまではスキップする。
  const live = await loadLiveFiles();
  if (!live) {
    console.warn(
      `Firebase Hosting site ${SITE_ID} has no release yet; skipping until seed-firebase-hosting is run`,
    );
    return;
  }
  const files = mergeHostingFiles(live.files, local, todayJST);
  const version = await releaseFiles(files, async (hash) => uploads.get(hash));
  await saveManifest({ version, files });
  console.info("Firebase Hosting deploy completed");
};
