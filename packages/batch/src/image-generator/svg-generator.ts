import type { RacePrediction } from "@fun-site/shared";
import { generatePlainText } from "../predictor/gemini-client.js";
import { buildSvgPrompt } from "./prompt-builder.js";

/** SVG 内の危険な要素・属性を除去（<style> は許可し、危険な CSS プロパティのみ除去） */
const DANGEROUS_SVG_PATTERNS = [
  /<script[\s\S]*?<\/script>/gi,
  /<iframe[\s\S]*?<\/iframe>/gi,
  /<object[\s\S]*?<\/object>/gi,
  /<embed[\s\S]*?(?:\/>|<\/embed>)/gi,
  /<foreignObject[\s\S]*?<\/foreignObject>/gi,
  /\bon\w+\s*=\s*["'][^"']*["']/gi,
  /href\s*=\s*["']javascript:[^"']*["']/gi,
  /xlink:href\s*=\s*["'](?!#)[^"']*["']/gi,
];

/** <style> 内の危険な CSS プロパティを除去 */
const DANGEROUS_CSS_PATTERNS = [
  /@import\b[^;]*;/gi,
  /url\s*\([^)]*\)/gi,
  /expression\s*\([^)]*\)/gi,
  /-moz-binding\s*:[^;]*;/gi,
  /behavior\s*:[^;]*;/gi,
];

const sanitizeCss = (css: string): string => {
  let sanitized = css;
  for (const pattern of DANGEROUS_CSS_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized;
};

const sanitizeSvg = (svg: string): string => {
  let sanitized = svg;
  for (const pattern of DANGEROUS_SVG_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  // Sanitize CSS within <style> tags (but keep the tags themselves)
  sanitized = sanitized.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_match, css: string) => {
    return `<style>${sanitizeCss(css)}</style>`;
  });
  return sanitized;
};

/** Gemini 3 Pro で SVG フォールバック画像を生成 */
export const generateSvg = async (prediction: RacePrediction): Promise<string> => {
  const prompt = buildSvgPrompt(prediction);
  // SVG 生成ではプレーンテキスト応答を使用（JSON モードではない）
  const responseText = await generatePlainText(prompt);

  const svgMatch = responseText.match(/<svg[\s\S]*<\/svg>/);
  if (svgMatch) {
    return sanitizeSvg(svgMatch[0]);
  }

  return sanitizeSvg(responseText);
};
