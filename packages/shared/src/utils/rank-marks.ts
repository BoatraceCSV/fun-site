/**
 * 着順列（recent_national / recent_local の `艇N_前K節_着順列`）の生文字列を
 * 表示用トークン列に分解するユーティリティ。
 *
 * 生文字列の例: `３２５　３　３１４２`（全角数字 + 全角スペースが日区切り）
 * トークン定義（boatracecsv 側 docs/data/programs.md 準拠）:
 *  - 全角/半角数字 1-6: 着順
 *  - `F`: フライング / `L`: 出遅れ（ソースは全角 Ｆ Ｌ だが CSV 出力時に半角化）
 *  - `欠` 欠場 / `転` 転覆 / `妨` 妨害失格 / `落` 落水 / `エ` エンスト / `不` 不完走 / `沈` 沈没 / `失` 失格
 *  - `[N]`: 優勝戦の着順 N（例 `[１]` = 優勝）
 *  - 全角スペース `　`: 日区切り
 */

export type RankMark =
  | { readonly kind: "rank"; readonly rank: number; readonly yusho: boolean }
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "separator" };

/** 全角/半角の数字 1 文字を数値に変換。数字でなければ null */
const toDigit = (ch: string | undefined): number | null => {
  if (!ch) return null;
  const c = ch.codePointAt(0);
  if (c === undefined) return null;
  // 全角 ０-９
  if (c >= 0xff10 && c <= 0xff19) return c - 0xff10;
  // 半角 0-9
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  return null;
};

/**
 * 着順列の生文字列をトークン列へ分解する。
 * 連続する日区切り（全角スペース）は 1 個の separator にまとめ、
 * 先頭・末尾の separator は除去する。
 */
export const tokenizeRankString = (raw: string): RankMark[] => {
  const chars = [...(raw ?? "")];
  const marks: RankMark[] = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === undefined) continue;

    // 日区切り（全角/半角スペース）
    if (ch === "　" || ch === " " || ch === "\t") {
      if (marks.length > 0 && marks[marks.length - 1]?.kind !== "separator") {
        marks.push({ kind: "separator" });
      }
      continue;
    }

    // 優勝戦 [N] / ［N］
    if (ch === "[" || ch === "［") {
      let inner = "";
      i++;
      while (i < chars.length && chars[i] !== "]" && chars[i] !== "］") {
        inner += chars[i];
        i++;
      }
      const d = toDigit([...inner.trim()][0]);
      if (d != null) {
        marks.push({ kind: "rank", rank: d, yusho: true });
      } else if (inner.length > 0) {
        marks.push({ kind: "token", token: inner });
      }
      continue;
    }

    const d = toDigit(ch);
    if (d != null) {
      marks.push({ kind: "rank", rank: d, yusho: false });
      continue;
    }

    // F / L / 欠 / 転 / 妨 / 落 / エ / 不 / 沈 / 失 など。全角 Ｆ Ｌ は半角へ寄せる。
    const normalized = ch === "Ｆ" ? "F" : ch === "Ｌ" ? "L" : ch;
    marks.push({ kind: "token", token: normalized });
  }

  // 末尾 separator を除去
  while (marks.length > 0 && marks[marks.length - 1]?.kind === "separator") {
    marks.pop();
  }
  return marks;
};
