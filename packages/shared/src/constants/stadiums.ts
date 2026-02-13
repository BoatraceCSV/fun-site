import type { Stadium } from "../types/stadium.js";

/** 全24場のマスタデータ */
export const STADIUMS: readonly Stadium[] = [
  { id: "01", name: "桐生", prefecture: "群馬県" },
  { id: "02", name: "戸田", prefecture: "埼玉県" },
  { id: "03", name: "江戸川", prefecture: "東京都" },
  { id: "04", name: "平和島", prefecture: "東京都" },
  { id: "05", name: "多摩川", prefecture: "東京都" },
  { id: "06", name: "浜名湖", prefecture: "静岡県" },
  { id: "07", name: "蒲郡", prefecture: "愛知県" },
  { id: "08", name: "常滑", prefecture: "愛知県" },
  { id: "09", name: "津", prefecture: "三重県" },
  { id: "10", name: "三国", prefecture: "福井県" },
  { id: "11", name: "びわこ", prefecture: "滋賀県" },
  { id: "12", name: "住之江", prefecture: "大阪府" },
  { id: "13", name: "尼崎", prefecture: "兵庫県" },
  { id: "14", name: "鳴門", prefecture: "徳島県" },
  { id: "15", name: "丸亀", prefecture: "香川県" },
  { id: "16", name: "児島", prefecture: "岡山県" },
  { id: "17", name: "宮島", prefecture: "広島県" },
  { id: "18", name: "徳山", prefecture: "山口県" },
  { id: "19", name: "下関", prefecture: "山口県" },
  { id: "20", name: "若松", prefecture: "福岡県" },
  { id: "21", name: "芦屋", prefecture: "福岡県" },
  { id: "22", name: "福岡", prefecture: "福岡県" },
  { id: "23", name: "唐津", prefecture: "佐賀県" },
  { id: "24", name: "大村", prefecture: "長崎県" },
] as const;

/** 会場IDから会場情報を取得 */
export const getStadiumById = (id: string): Stadium | undefined =>
  STADIUMS.find((s) => s.id === id);

/** 会場名から会場情報を取得 */
export const getStadiumByName = (name: string): Stadium | undefined =>
  STADIUMS.find((s) => s.name === name);
