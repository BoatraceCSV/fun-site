import { GoogleAuth } from "google-auth-library";
import { IMAGE_MODEL_ID, INITIAL_DELAY_MS, MAX_RETRIES, delay } from "../lib/vertex-ai.js";

const PROJECT_ID = process.env["GCP_PROJECT_ID"];
const IMAGE_LOCATION = process.env["VERTEX_AI_IMAGE_LOCATION"] ?? "us-central1";

const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}

/** Gemini 2.5 Flash Image で画像生成（REST API 直接呼び出し） */
export const generateImage = async (prompt: string): Promise<Buffer> => {
  const endpoint = `${IMAGE_LOCATION}-aiplatform.googleapis.com`;
  const url = `https://${endpoint}/v1/projects/${PROJECT_ID}/locations/${IMAGE_LOCATION}/publishers/google/models/${IMAGE_MODEL_ID}:generateContent`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      temperature: 0.8,
    },
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const client = await auth.getClient();
      const token = await client.getAccessToken();

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`${res.status} ${res.statusText}. ${errorText}`);
      }

      const json = (await res.json()) as GeminiResponse;
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData?.data);

      if (imagePart?.inlineData?.data) {
        return Buffer.from(imagePart.inlineData.data, "base64");
      }

      throw new Error("No image data in Gemini response");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        const backoffMs = INITIAL_DELAY_MS * 2 ** attempt;
        console.warn(`Image generation retry ${attempt + 1}/${MAX_RETRIES}: ${lastError.message}`);
        await delay(backoffMs);
      }
    }
  }

  throw new Error(
    `Image generation failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`,
  );
};
