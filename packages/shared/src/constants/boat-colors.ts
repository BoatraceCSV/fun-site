/** 艇番と色の対応 */
export const BOAT_COLORS = {
  1: { name: "白", hex: "#FFFFFF", textHex: "#000000" },
  2: { name: "黒", hex: "#000000", textHex: "#FFFFFF" },
  3: { name: "赤", hex: "#E5002D", textHex: "#FFFFFF" },
  4: { name: "青", hex: "#0047AB", textHex: "#FFFFFF" },
  5: { name: "黄", hex: "#FFD700", textHex: "#000000" },
  6: { name: "緑", hex: "#008000", textHex: "#FFFFFF" },
} as const;

export type BoatNumber = keyof typeof BOAT_COLORS;

/** 有効な艇番かどうかを判定 */
export const isValidBoatNumber = (n: number): n is BoatNumber => n >= 1 && n <= 6;

/** 艇番から色情報を取得 */
export const getBoatColor = (boatNumber: BoatNumber) => BOAT_COLORS[boatNumber];
