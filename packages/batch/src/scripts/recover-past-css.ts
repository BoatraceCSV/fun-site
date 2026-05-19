/**
 * 過去日付ページの HTML が参照している無効な `_astro/*.css` リンクを、
 * 現在 GCS Web バケットに存在する有効なハッシュへ書き換えるワンショットスクリプト。
 *
 * 背景:
 *   `deploy.ts` の旧ロジックでは `_astro/` 配下を毎ビルドで削除していたため、
 *   過去日付の `race/<date>/.../index.html` と `archive/<date>/index.html` が
 *   参照する CSS が 404 になっていた。`deploy.ts` 側の修正で今後の削除は
 *   止まるが、既に消えたファイル名を参照している過去 HTML は救えないので、
 *   このスクリプトで HTML を書き換えて現行ハッシュに揃える。
 *
 * 動作:
 *   1. `_astro/` 配下に現在存在する `*.css` 一覧を取得 (replacement の候補)。
 *   2. `race/<date>/.../index.html` と `archive/<date>/index.html` を全列挙。
 *   3. 各 HTML の `<link rel="stylesheet" href="/_astro/*.css">` を検査し、
 *      無効なハッシュなら現行の単一 CSS に置換して上書き保存。
 *
 * 実行:
 *   pnpm --filter @fun-site/batch run recover-past-css
 *   DRY_RUN=1 pnpm --filter @fun-site/batch run recover-past-css
 *
 * 環境変数:
 *   GCS_WEB_BUCKET (既定: fun-site-web-boatrace-487212)
 *   DRY_RUN=1      書き込みを行わずに変更予定だけログ出力
 *
 * 注意: CDN キャッシュが残っている場合、書き換え後も古い 404 が返ることがある。
 *       必要なら CDN キャッシュ無効化を別途実施。
 */
import { type File, Storage } from "@google-cloud/storage";
import pMap from "p-map";

const BUCKET = process.env["GCS_WEB_BUCKET"] ?? "fun-site-web-boatrace-487212";
const DRY_RUN = process.env["DRY_RUN"] === "1";

const PAST_HTML_RE = /^(race|archive)\/\d{4}-\d{2}-\d{2}\/.*\.html$/;
// 例: <link rel="stylesheet" href="/_astro/_date_.Dyh1rilZ.css">
//     <link href="/_astro/foo.css" rel="stylesheet" />
const CSS_LINK_RE = /<link\b[^>]*href="(\/_astro\/[^"]+\.css)"[^>]*\/?>/g;

const CONCURRENCY = 16;

const storage = new Storage();
const bucket = storage.bucket(BUCKET);

const main = async (): Promise<void> => {
  console.info(`Bucket: gs://${BUCKET}`);

  // 1. 現在の _astro/*.css をリスト
  const [astroFiles] = await bucket.getFiles({ prefix: "_astro/" });
  const validHrefs = new Set(astroFiles.map((f) => `/${f.name}`));
  const currentCssHrefs = astroFiles.map((f) => `/${f.name}`).filter((p) => p.endsWith(".css"));
  if (currentCssHrefs.length === 0) {
    throw new Error("No _astro/*.css found on bucket. Cannot recover.");
  }
  // 通常 1 個 (グローバル CSS が 1 ファイル)。複数ある場合はサイズ最大を採用。
  let replacementCss: string;
  if (currentCssHrefs.length === 1) {
    replacementCss = currentCssHrefs[0] as string;
  } else {
    const cssWithSize = astroFiles
      .filter((f) => f.name.endsWith(".css"))
      .map((f) => ({ href: `/${f.name}`, size: Number(f.metadata.size ?? 0) }))
      .sort((a, b) => b.size - a.size);
    replacementCss = cssWithSize[0]?.href ?? (currentCssHrefs[0] as string);
    console.warn(
      `Found ${currentCssHrefs.length} _astro/*.css files; using largest as replacement: ${replacementCss}`,
    );
  }
  console.info(`Valid _astro entries: ${validHrefs.size}`);
  console.info(`Replacement CSS: ${replacementCss}`);

  // 2. 過去日付の HTML を全列挙
  const [allFiles] = await bucket.getFiles();
  const pastHtmlFiles: File[] = allFiles.filter((f) => PAST_HTML_RE.test(f.name));
  console.info(`Past dated HTML files: ${pastHtmlFiles.length}`);

  // 3. 各ファイルをチェック → 必要なら書き換え
  let patched = 0;
  let unchanged = 0;
  let scanned = 0;

  const results = await pMap(
    pastHtmlFiles,
    async (file): Promise<"patched" | "unchanged"> => {
      const [buf] = await file.download();
      const html = buf.toString("utf-8");
      let needsUpdate = false;
      const fixed = html.replace(CSS_LINK_RE, (match, href: string) => {
        if (validHrefs.has(href)) return match;
        needsUpdate = true;
        return match.replace(href, replacementCss);
      });
      scanned++;
      if (scanned % 100 === 0) {
        console.info(`Scanned ${scanned} / ${pastHtmlFiles.length}`);
      }
      if (!needsUpdate) return "unchanged";
      if (DRY_RUN) {
        console.info(`Would patch: ${file.name}`);
        return "patched";
      }
      await file.save(fixed, { contentType: "text/html; charset=utf-8" });
      return "patched";
    },
    { concurrency: CONCURRENCY },
  );

  for (const r of results) {
    if (r === "patched") patched++;
    else unchanged++;
  }

  console.info(`Done. ${DRY_RUN ? "Would patch" : "Patched"}: ${patched}, unchanged: ${unchanged}`);
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
