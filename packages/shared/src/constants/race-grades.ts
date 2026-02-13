/** レースグレードの定義 */
export const RACE_GRADES = {
  SG: { label: "SG", displayName: "スペシャルグレード" },
  GI: { label: "GI", displayName: "グレードI" },
  GII: { label: "GII", displayName: "グレードII" },
  GIII: { label: "GIII", displayName: "グレードIII" },
  GENERAL: { label: "一般", displayName: "一般戦" },
} as const;

export type RaceGrade = keyof typeof RACE_GRADES;
