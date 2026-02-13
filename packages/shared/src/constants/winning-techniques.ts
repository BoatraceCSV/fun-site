import type { WinningTechnique } from "../types/prediction.js";

/** 決まり手の定義 */
export const WINNING_TECHNIQUES: Record<WinningTechnique, string> = {
  nige: "逃げ",
  sashi: "差し",
  makuri: "まくり",
  "makuri-sashi": "まくり差し",
  nuki: "抜き",
  megumare: "恵まれ",
} as const;

/** 日本語名からWinningTechniqueに変換 */
export const toWinningTechnique = (japaneseName: string): WinningTechnique | undefined => {
  const entry = Object.entries(WINNING_TECHNIQUES).find(([, name]) => name === japaneseName);
  return entry ? (entry[0] as WinningTechnique) : undefined;
};
