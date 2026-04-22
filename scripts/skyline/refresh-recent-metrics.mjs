import {
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
} from "./shared.mjs";
import { refreshRecentMetrics } from "./recent-metrics.mjs";

export function refreshRecentMetricsCommand({
  days = 30,
  force = false,
  maxAgeMinutes = 60,
} = {}) {
  loadLocalEnv();

  const database = openSkylineDatabase();

  try {
    const summary = refreshRecentMetrics(database, {
      days,
      force,
      maxAgeMinutes,
    });

    console.log("Refreshed recent skyline metrics.");
    console.log(summary);

    return summary;
  } finally {
    database.close();
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  try {
    refreshRecentMetricsCommand({
      days: Number(args.days ?? 30),
      force: args.force === "true" || args.force === "1",
      maxAgeMinutes: Number(args["max-age-minutes"] ?? 60),
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
