/** Date を JST の日付文字列 "YYYY-MM-DD" に変換 */
export const toJSTDateString = (date: Date): string => {
  return date
    .toLocaleDateString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replaceAll("/", "-");
};

/**
 * Date を JST として "YYYY-MM-DD" 形式にフォーマット
 * @deprecated toJSTDateString を使用してください
 */
export const toJST = (date: Date): Date => {
  // Intl API を使って正しく JST の各コンポーネントを取得
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";

  return new Date(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  );
};

/** Date を "YYYY-MM-DD" 形式にフォーマット */
export const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/** Date を "YYYY/MM/DD" 形式にフォーマット（URL用） */
export const formatDateSlash = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
};

/** 前日の Date を取得 */
export const getPreviousDate = (date: Date): Date => {
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  return prev;
};

/** "YYYY-MM-DD" 文字列から Date を生成 */
export const parseDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    Number.isNaN(y) ||
    Number.isNaN(m) ||
    Number.isNaN(d)
  ) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  return new Date(y, m - 1, d);
};
