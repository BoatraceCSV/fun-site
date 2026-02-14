import { INITIAL_DELAY_MS, MAX_RETRIES, MODEL_ID, ai, delay } from "../lib/vertex-ai.js";

/** Gemini 3 Pro でテキスト生成（JSON応答指定） */
export const generateText = async (prompt: string): Promise<string> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from Gemini");
      }
      return text;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        const backoffMs = INITIAL_DELAY_MS * 2 ** attempt;
        console.warn(`Gemini retry ${attempt + 1}/${MAX_RETRIES}: ${lastError.message}`);
        await delay(backoffMs);
      }
    }
  }

  throw new Error(
    `Gemini generation failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`,
  );
};

/** Gemini 3 Pro でテキスト生成（プレーンテキスト応答） */
export const generatePlainText = async (prompt: string): Promise<string> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: {
          temperature: 0.7,
          maxOutputTokens: 8192,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from Gemini");
      }
      return text;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        const backoffMs = INITIAL_DELAY_MS * 2 ** attempt;
        console.warn(`Gemini plain text retry ${attempt + 1}/${MAX_RETRIES}: ${lastError.message}`);
        await delay(backoffMs);
      }
    }
  }

  throw new Error(
    `Gemini plain text generation failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`,
  );
};
