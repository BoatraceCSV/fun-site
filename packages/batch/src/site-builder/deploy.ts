import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Storage } from "@google-cloud/storage";

const WEB_DIST_DIR = resolve(import.meta.dirname, "../../../web/dist");
const BUCKET_NAME = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web";

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

/** Cloud Storage へデプロイ (@google-cloud/storage SDK) */
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

  console.info(`Found ${localFiles.length} files to upload`);

  const bucket = storage.bucket(BUCKET_NAME);

  // 既存ファイル一覧を取得（削除対象の特定用）
  const [existingFiles] = await bucket.getFiles();
  const existingNames = new Set(existingFiles.map((f) => f.name));

  // アップロード
  const uploadedNames = new Set<string>();
  for (const filePath of localFiles) {
    const destination = relative(WEB_DIST_DIR, filePath);
    uploadedNames.add(destination);

    await bucket.upload(filePath, {
      destination,
      metadata: { contentType: getContentType(filePath) },
    });
  }

  console.info(`Uploaded ${uploadedNames.size} files`);

  // ローカルに存在しないリモートファイルを削除（rsync -d 相当）
  // images/ プレフィックスは画像生成ステップで別途アップロードされるため除外
  const toDelete = [...existingNames].filter(
    (name) => !(uploadedNames.has(name) || name.startsWith("images/")),
  );
  if (toDelete.length > 0) {
    for (const name of toDelete) {
      await bucket.file(name).delete();
    }
    console.info(`Deleted ${toDelete.length} stale files`);
  }

  console.info("Deploy completed");
};
