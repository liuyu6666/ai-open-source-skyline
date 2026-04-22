import {
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
  sleep,
} from "./shared.mjs";
import { refreshRecentMetrics } from "./recent-metrics.mjs";

export async function runRecentMetricsLoop({
  days = 30,
  force = false,
  intervalMs = 30 * 60 * 1000,
  maxAgeMinutes = 45,
} = {}) {
  loadLocalEnv();

  let cycle = 1;

  while (true) {
    const startedAt = new Date().toISOString();

    try {
      console.error(
        `[recent-metrics-loop] starting cycle=${cycle} days=${days} force=${force ? 1 : 0} maxAgeMinutes=${maxAgeMinutes} startedAt=${startedAt}`,
      );

      const database = openSkylineDatabase();

      try {
        const summary = refreshRecentMetrics(database, {
          days,
          force,
          maxAgeMinutes,
        });

        console.error(
          `[recent-metrics-loop] cycle=${cycle} refreshed=${summary.refreshed ? 1 : 0} rows=${summary.rowCount} anchorMetricDate=${summary.anchorMetricDate} durationMs=${summary.durationMs ?? 0}`,
        );
      } finally {
        database.close();
      }
    } catch (error) {
      console.error(`[recent-metrics-loop] cycle=${cycle} failed at ${startedAt}`, error);
    }

    console.error(`[recent-metrics-loop] sleeping intervalMs=${intervalMs} after cycle=${cycle}`);
    cycle += 1;
    await sleep(intervalMs);
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  runRecentMetricsLoop({
    days: Number(args.days ?? 30),
    force: args.force === "true" || args.force === "1",
    intervalMs: Number(args["interval-ms"] ?? 30 * 60 * 1000),
    maxAgeMinutes: Number(args["max-age-minutes"] ?? 45),
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
