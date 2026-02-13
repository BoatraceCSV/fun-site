import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WEB_PACKAGE_DIR = resolve(import.meta.dirname, "../../../web");

/** Astro ビルド実行 */
export const runAstroBuild = async (): Promise<void> => {
  console.info("Starting Astro build...");

  try {
    const { stdout, stderr } = await execFileAsync("pnpm", ["run", "build"], {
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
