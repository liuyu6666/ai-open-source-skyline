import {
  ensureSchema,
  getIngestionState,
  isMainModule,
  loadLocalEnv,
  minutesSinceTimestamp,
  openSkylineDatabase,
  parseArgs,
} from "./shared.mjs";

function buildCheck(database, stateKey, maxAgeMinutes, required = true) {
  const state = getIngestionState(database, stateKey);
  const updatedAt = state?.updatedAt ?? null;
  const ageMinutes = minutesSinceTimestamp(updatedAt);
  const healthy = Number.isFinite(ageMinutes) && ageMinutes <= maxAgeMinutes;

  return {
    ageMinutes: Number.isFinite(ageMinutes) ? Number(ageMinutes.toFixed(1)) : null,
    healthy,
    maxAgeMinutes,
    required,
    stateKey,
    updatedAt,
    value: state?.value ?? null,
  };
}

export function runHealthCheck({
  recentMetricsMaxAgeMinutes = 90,
  repoMaxAgeMinutes = 30,
  snapshotMaxAgeMinutes = 90,
  summaryMaxAgeMinutes = 24 * 60,
} = {}) {
  loadLocalEnv();

  const database = openSkylineDatabase();

  try {
    ensureSchema(database);

    const checks = [
      buildCheck(database, "repo_enrichment", repoMaxAgeMinutes, true),
      buildCheck(database, "snapshot_materialization", snapshotMaxAgeMinutes, true),
      buildCheck(database, "recent_metrics_rollup", recentMetricsMaxAgeMinutes, false),
      buildCheck(database, "readme_summary_sync", summaryMaxAgeMinutes, false),
    ];
    const unhealthyChecks = checks.filter((check) => check.required && !check.healthy);
    const result = {
      checkedAt: new Date().toISOString(),
      healthy: unhealthyChecks.length === 0,
      checks,
    };

    console.log(JSON.stringify(result, null, 2));

    if (!result.healthy) {
      process.exitCode = 1;
    }

    return result;
  } finally {
    database.close();
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  runHealthCheck({
    recentMetricsMaxAgeMinutes: Number(args["recent-metrics-max-age-minutes"] ?? 90),
    repoMaxAgeMinutes: Number(args["repo-max-age-minutes"] ?? 30),
    snapshotMaxAgeMinutes: Number(args["snapshot-max-age-minutes"] ?? 90),
    summaryMaxAgeMinutes: Number(args["summary-max-age-minutes"] ?? 24 * 60),
  });
}
