import { isMainModule, loadLocalEnv, parseArgs, sleep } from "./shared.mjs";
import { syncSnapshotReadmeSummaries } from "./sync-readme-summaries.mjs";

export async function runSummaryLoop({
  fetchConcurrency = 4,
  fetchDelayMs = 180,
  force = false,
  intervalMs = 4 * 60 * 60 * 1000,
  limit = 500,
  model = "deepseek-chat",
  summarizeConcurrency = 2,
  summarizeDelayMs = 260,
} = {}) {
  loadLocalEnv();

  let cycle = 1;

  while (true) {
    const startedAt = new Date().toISOString();

    try {
      console.error(
        `[summary-loop] starting cycle=${cycle} limit=${limit} model=${model} fetchConcurrency=${fetchConcurrency} summarizeConcurrency=${summarizeConcurrency} startedAt=${startedAt}`,
      );
      console.error("[summary-loop] syncing snapshot README summaries");

      const summary = await syncSnapshotReadmeSummaries({
        fetchConcurrency,
        fetchDelayMs,
        force,
        limit,
        model,
        summarizeConcurrency,
        summarizeDelayMs,
      });

      console.error(
        `[summary-loop] cycle=${cycle} readmesFetched=${summary.readmes?.fetched ?? 0} readmesChanged=${summary.readmes?.changed ?? 0} summariesSucceeded=${summary.summaries?.succeeded ?? 0} summariesFailed=${summary.summaries?.failed ?? 0}`,
      );
    } catch (error) {
      console.error(`[summary-loop] cycle=${cycle} failed at ${startedAt}`, error);
    }

    console.error(`[summary-loop] sleeping intervalMs=${intervalMs} after cycle=${cycle}`);
    cycle += 1;
    await sleep(intervalMs);
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  runSummaryLoop({
    fetchConcurrency: Number(args["fetch-concurrency"] ?? 4),
    fetchDelayMs: Number(args["fetch-delay"] ?? 180),
    force: args.force === "true" || args.force === "1",
    intervalMs: Number(args["interval-ms"] ?? 4 * 60 * 60 * 1000),
    limit:
      args.limit == null ? Number.POSITIVE_INFINITY : Number(args.limit),
    model: args.model ?? "deepseek-chat",
    summarizeConcurrency: Number(args["summarize-concurrency"] ?? 2),
    summarizeDelayMs: Number(args["summarize-delay"] ?? 260),
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
