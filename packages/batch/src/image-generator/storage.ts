import { parseRaceCode } from "@fun-site/shared";
import { Storage } from "@google-cloud/storage";

const BUCKET_NAME = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web";
const SITE_URL = process.env["SITE_URL"] ?? "https://fun-site.example.com";

let storageInstance: Storage | undefined;

const getStorage = (): Storage => {
  if (!storageInstance) {
    storageInstance = new Storage();
  }
  return storageInstance;
};

const buildImagePath = (raceCode: string, fileName: string): string => {
  const parsed = parseRaceCode(raceCode);
  const month = String(parsed.month).padStart(2, "0");
  const day = String(parsed.day).padStart(2, "0");
  return `images/${parsed.year}/${month}/${day}/${raceCode}/${fileName}`;
};

const ALLOWED_CONTENT_TYPES = new Set(["image/webp", "image/png", "image/svg+xml"]);

/** 画像を Cloud Storage にアップロードし、公開 URL を返す */
export const uploadImage = async (
  raceCode: string,
  fileName: string,
  data: Buffer | string,
  contentType: string,
): Promise<string> => {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
  const storage = getStorage();
  const bucket = storage.bucket(BUCKET_NAME);
  const filePath = buildImagePath(raceCode, fileName);
  const file = bucket.file(filePath);

  await file.save(typeof data === "string" ? Buffer.from(data, "utf-8") : data, {
    contentType,
    metadata: { cacheControl: "public, max-age=86400" },
  });

  return `${SITE_URL}/${filePath}`;
};

/** 画像 URL を構築（アップロードせずにURLだけ返す） */
export const buildImageUrl = (raceCode: string, fileName: string): string => {
  const filePath = buildImagePath(raceCode, fileName);
  return `${SITE_URL}/${filePath}`;
};
