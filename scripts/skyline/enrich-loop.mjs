import { enrichCatalog } from "./enrich-catalog.mjs";
import { isMainModule, loadLocalEnv, parseArgs, sleep } from "./shared.mjs";

export async function runEnrichLoop({
  concurrency = 4,
  days = 30,
  delayMs = 120,
  intervalMs = 10 * 60 * 1000,
  missingBatchLimit = 1200,
  pauseMs = 0,
  queryBatchSize = 20,
  ratePerHour = 1800,
  recentBatchLimit = 400,
  recentEveryCycles = 6,
  transport = "graphql",
} = {}) {
  loadLocalEnv();

  let cycle = 1;

  while (true) {
    const startedAt = new Date().toISOString();
    const shouldRunRecent = cycle % Math.max(1, recentEveryCycles) === 0;
    const scope = shouldRunRecent ? "recent" : "missing";
    const batchLimit = shouldRunRecent ? recentBatchLimit : missingBatchLimit;
    const missingOnly = !shouldRunRecent;

    try {
      console.error(
        `[enrich-loop] starting cycle=${cycle} scope=${scope} batchLimit=${batchLimit} concurrency=${concurrency} transport=${transport} startedAt=${startedAt}`,
      );

      const summary = await enrichCatalog({
        batchLimit,
        concurrency,
        days,
        delayMs,
        maxBatches: 1,
        missingOnly,
        pauseMs,
        queryBatchSize,
        ratePerHour,
        scope,
        transport,
      });

      console.error(
        `[enrich-loop] cycle=${cycle} scope=${scope} requested=${summary.requested} succeeded=${summary.succeeded} failed=${summary.failed} startedAt=${startedAt}`,
      );
    } catch (error) {
      console.error(`[enrich-loop] cycle=${cycle} scope=${scope} failed at ${startedAt}`, error);
    }

    cycle += 1;
    console.error(`[enrich-loop] sleeping intervalMs=${intervalMs} after cycle=${cycle - 1}`);
    await sleep(intervalMs);
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  runEnrichLoop({
    concurrency: Number(args.concurrency ?? 4),
    days: Number(args.days ?? 30),
    delayMs: Number(args.delay ?? 120),
    intervalMs: Number(args["interval-ms"] ?? 10 * 60 * 1000),
    missingBatchLimit: Number(args["missing-batch-limit"] ?? 1200),
    pauseMs: Number(args.pause ?? 0),
    queryBatchSize: Number(args["query-batch-size"] ?? 20),
    ratePerHour: Number(args["rate-per-hour"] ?? 1800),
    recentBatchLimit: Number(args["recent-batch-limit"] ?? 400),
    recentEveryCycles: Number(args["recent-every-cycles"] ?? 6),
    transport: args.transport ?? "graphql",
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
