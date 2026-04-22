import { materializeSnapshot } from "./materialize-snapshot.mjs";
import { isMainModule, loadLocalEnv, parseArgs, sleep } from "./shared.mjs";

export async function runSnapshotLoop({
  intervalMs = 60 * 60 * 1000,
  limit = 500,
  minStars = 5000,
  minStarDelta7d = 100,
} = {}) {
  loadLocalEnv();

  while (true) {
    const startedAt = new Date().toISOString();

    try {
      console.error(
        `[snapshot-loop] starting cycle limit=${limit} minStars=${minStars} minStarDelta7d=${minStarDelta7d} startedAt=${startedAt}`,
      );

      const snapshotArgs = {
        limit,
        minStarDelta7d,
        minStars,
      };
      console.error("[snapshot-loop] materializing snapshot");
      const { meta } = materializeSnapshot(snapshotArgs);

      console.error(
        `[snapshot-loop] completed at ${startedAt} limit=${limit} minStars=${minStars} minStarDelta7d=${minStarDelta7d} path=${meta.snapshotPath}`,
      );
    } catch (error) {
      console.error(`[snapshot-loop] failed at ${startedAt}`, error);
    }

    console.error(`[snapshot-loop] sleeping intervalMs=${intervalMs}`);
    await sleep(intervalMs);
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  runSnapshotLoop({
    intervalMs: Number(args["interval-ms"] ?? 60 * 60 * 1000),
    limit: Number(args.limit ?? 500),
    minStarDelta7d: Number(args["min-star-delta-7d"] ?? 100),
    minStars: Number(args["min-stars"] ?? 5000),
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
