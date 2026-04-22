import { enrichRepos } from "./enrich-repos.mjs";
import { isMainModule, parseArgs, sleep } from "./shared.mjs";

export async function enrichCatalog({
  batchLimit = 12000,
  concurrency = 4,
  days = 30,
  delayMs = 120,
  maxBatches = Number.POSITIVE_INFINITY,
  missingOnly = true,
  pauseMs = 5_000,
  queryBatchSize = 20,
  ratePerHour = 1800,
  scope = "missing",
  transport = "auto",
} = {}) {
  const summaries = [];

  for (let batch = 1; batch <= maxBatches; batch += 1) {
    console.log(
      `[catalog] starting batch ${batch} scope=${scope} limit=${batchLimit} transport=${transport} batchSize=${queryBatchSize} ratePerHour=${ratePerHour}`,
    );

    const summary = await enrichRepos({
      concurrency,
      days,
      delayMs,
      limit: batchLimit,
      missingOnly,
      queryBatchSize,
      ratePerHour,
      scope,
      transport,
    });

    summaries.push(summary);

    console.log(
      `[catalog] batch ${batch} done requested=${summary.requested} succeeded=${summary.succeeded} failed=${summary.failed}`,
    );

    if (summary.requested === 0) {
      break;
    }

    if (batch < maxBatches && pauseMs > 0) {
      await sleep(pauseMs);
    }
  }

  return {
    batches: summaries.length,
    failed: summaries.reduce((sum, item) => sum + item.failed, 0),
    requested: summaries.reduce((sum, item) => sum + item.requested, 0),
    succeeded: summaries.reduce((sum, item) => sum + item.succeeded, 0),
  };
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  enrichCatalog({
    batchLimit: Number(args["batch-limit"] ?? 12_000),
    concurrency: Number(args.concurrency ?? 4),
    days: Number(args.days ?? 30),
    delayMs: Number(args.delay ?? 120),
    maxBatches:
      args["max-batches"] == null ? Number.POSITIVE_INFINITY : Number(args["max-batches"]),
    missingOnly:
      args["missing-only"] == null
        ? true
        : args["missing-only"] === "true" || args["missing-only"] === "1",
    pauseMs: Number(args.pause ?? 5_000),
    queryBatchSize: Number(args["query-batch-size"] ?? 20),
    ratePerHour: Number(args["rate-per-hour"] ?? 1800),
    scope: args.scope ?? "missing",
    transport: args.transport ?? "auto",
  })
    .then((summary) => {
      console.log("Completed catalog enrichment.");
      console.log(summary);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
