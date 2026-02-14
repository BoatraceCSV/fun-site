import { IMAGE_MODEL_ID, INITIAL_DELAY_MS, MAX_RETRIES, delay, getVertexAI } from "../lib/vertex-ai.js";

/** Gemini 3 Pro で画像生成（バイナリ取得） */
export const generateImage = async (prompt: string): Promise<Buffer> => {
  const vertexAi = getVertexAI();
  const model = vertexAi.getGenerativeModel({
    model: IMAGE_MODEL_ID,
    generationConfig: {
      responseMimeType: "image/png",
      temperature: 0.8,
    },
  });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      const part = response.candidates?.[0]?.content?.parts?.[0];

      if (part?.inlineData?.data) {
        return Buffer.from(part.inlineData.data, "base64");
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
