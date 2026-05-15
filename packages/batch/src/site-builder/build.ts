import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");

// pnpm の npm-script ラッパーを介さず Astro バイナリを直接起動する。
// pnpm 経由だと corepack 初期化 + pnpm 起動 + workspace resolve で
// 数百 ms〜数秒のオーバーヘッドが乗るため、Cloud Run Job の 5 分
// サイクルではここを削るのが効く。
const ASTRO_BIN = resolve(WEB_PACKAGE_DIR, "node_modules/.bin/astro");

/** Astro ビルド実行 */
export const runAstroBuild = async (): Promise<void> => {
  console.info("Starting Astro build...");

  try {
    const { stdout, stderr } = await execFileAsync(ASTRO_BIN, ["build"], {
      cwd: WEB_PACKAGE_DIR,
      timeout: 300_000,
    });

    if (stdout) console.info(stdout);
    if (stderr) console.warn(stderr);

    console.info("Astro build completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Astro build failed: ${message}`);
  }
};
