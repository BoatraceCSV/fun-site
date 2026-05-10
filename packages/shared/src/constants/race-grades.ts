/** レースグレードの定義 */
export const RACE_GRADES = {
  SG: { label: "SG", displayName: "スペシャルグレード" },
  GI: { label: "GI", displayName: "グレードI" },
  GII: { label: "GII", displayName: "グレードII" },
  GIII: { label: "GIII", displayName: "グレードIII" },
  GENERAL: { label: "一般", displayName: "一般戦" },
} as const;

export type RaceGrade = keyof typeof RACE_GRADES;

/**
 * 上流 CSV (`programs/title` の `グレード` 列) の値から RaceCard 等で表示する
 * 「バッジ」設定を返す。バッジを出さないグレード (一般戦 / 未指定 / 不明値) では
 * `null` を返す。
 *
 * 上流値の代表例:
 *   SG / PG1 / G1 / G2 / G3 (= バッジ表示)
 *   IP (= 一般戦) / "" (= 未指定) (= バッジ非表示)
 *
 * 戻り値の `tailwindClass` は Tailwind v4 のユーティリティクラス。
 * RaceCard の `bg-amber-500 text-white` などに直接 class として適用する想定。
 */
export type RaceGradeBadge = {
  /** バッジに表示する文字列 */
  readonly label: string;
  /** バッジに当てる Tailwind class (背景色 + 文字色) */
  readonly tailwindClass: string;
};

const BADGE_BY_UPSTREAM_CODE: Readonly<Record<string, RaceGradeBadge>> = {
  SG: { label: "SG", tailwindClass: "bg-amber-500 text-white" },
  PG1: { label: "PG1", tailwindClass: "bg-orange-500 text-white" },
  G1: { label: "G1", tailwindClass: "bg-red-600 text-white" },
  GI: { label: "G1", tailwindClass: "bg-red-600 text-white" },
  G2: { label: "G2", tailwindClass: "bg-purple-600 text-white" },
  GII: { label: "G2", tailwindClass: "bg-purple-600 text-white" },
  G3: { label: "G3", tailwindClass: "bg-blue-600 text-white" },
  GIII: { label: "G3", tailwindClass: "bg-blue-600 text-white" },
};

// 一般戦相当 (バッジ非表示)
const HIDDEN_CODES = new Set<string>(["", "IP", "一般"]);

/** 上流 grade 値からバッジ設定を取得。バッジを出さない場合は null。 */
export const getRaceGradeBadge = (upstreamCode: string): RaceGradeBadge | null => {
  const code = upstreamCode.trim();
  if (HIDDEN_CODES.has(code)) return null;
  const known = BADGE_BY_UPSTREAM_CODE[code];
  if (known) return known;
  // 未知のコードはフォールバックとしてグレーで表示 (上流仕様変更の検知用)
  return { label: code, tailwindClass: "bg-gray-500 text-white" };
};
