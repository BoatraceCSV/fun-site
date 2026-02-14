import { VertexAI } from "@google-cloud/vertexai";

const PROJECT_ID = process.env["GCP_PROJECT_ID"];
const LOCATION = process.env["VERTEX_AI_LOCATION"] ?? "global";

if (!PROJECT_ID) {
  throw new Error("GCP_PROJECT_ID environment variable is required");
}

export const MODEL_ID = "gemini-3-pro-preview";
export const IMAGE_MODEL_ID = "gemini-3-pro-image-preview";

let vertexAiInstance: VertexAI | undefined;

/** 共通の VertexAI インスタンスを取得（シングルトン） */
export const getVertexAI = (): VertexAI => {
  if (!vertexAiInstance) {
    vertexAiInstance = new VertexAI({
      project: PROJECT_ID,
      location: LOCATION,
      apiEndpoint: LOCATION === "global" ? "aiplatform.googleapis.com" : undefined,
    });
  }
  return vertexAiInstance;
};

const INITIAL_DELAY_MS = 2000;
const MAX_RETRIES = 2;

export { MAX_RETRIES, INITIAL_DELAY_MS };

/** 指定ミリ秒待機 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
