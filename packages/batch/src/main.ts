import { runPipeline } from "./pipeline.js";

const main = async (): Promise<void> => {
  try {
    await runPipeline();
  } catch (error) {
    console.error("Pipeline failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
};

await main();
