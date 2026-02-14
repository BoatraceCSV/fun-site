import { GoogleGenAI } from "@google/genai";

export const MODEL_ID = "gemini-3-pro-preview";
export const IMAGE_MODEL_ID = "gemini-2.5-flash-image";

/** 共通の GoogleGenAI インスタンス（環境変数で Vertex AI / AI Studio を自動選択） */
export const ai = new GoogleGenAI({});

const INITIAL_DELAY_MS = 2000;
const MAX_RETRIES = 3;

export { INITIAL_DELAY_MS, MAX_RETRIES };

/** 指定ミリ秒待機 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
