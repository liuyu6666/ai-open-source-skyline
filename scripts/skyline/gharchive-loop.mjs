import { backfillGhArchiveDates } from "./backfill-gharchive.mjs";
import {
  dayStartUtc,
  ensureSchema,
  formatUtcDate,
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
  setIngestionState,
  sleep,
} from "./shared.mjs";

const dayMs = 24 * 60 * 60 * 1000;

function parseUtcDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addUtcDays(dateString, days) {
  const parsed = parseUtcDate(dateString);

  if (!parsed) {
    return null;
  }

  return formatUtcDate(new Date(parsed.getTime() + days * dayMs));
}

function compareDateStrings(left, right) {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function buildDateRange(startDate, endDate, limit) {
  const dates = [];
  let cursor = startDate;

  while (
    cursor &&
    compareDateStrings(cursor, endDate) <= 0 &&
    dates.length < Math.max(1, limit)
  ) {
    dates.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }

  return dates;
}

function getSafeEndDate(lagDays) {
  return formatUtcDate(dayStartUtc(new Date(Date.now() - lagDays * dayMs)));
}

function getMaxMetricDate(database) {
  const row = database
    .prepare(
      `
        SELECT MAX(metric_date) AS max_metric_date
        FROM skyline_repo_daily_metrics
      `,
    )
    .get();

  return row?.max_metric_date ?? null;
}

function selectRetryDates(database, safeEndDate, limit) {
  return database
    .prepare(
      `
        SELECT metric_date
        FROM skyline_gharchive_days
        WHERE status IN ('error', 'running')
          AND metric_date <= $safeEndDate
        ORDER BY metric_date ASC
        LIMIT $limit
      `,
    )
    .all({
      limit,
      safeEndDate,
    })
    .map((row) => row.metric_date);
}

function selectIncrementalDates(database, { daysPerCycle, lagDays }) {
  ensureSchema(database);

  const safeEndDate = getSafeEndDate(lagDays);
  const retryDates = selectRetryDates(database, safeEndDate, daysPerCycle);

  if (retryDates.length >= daysPerCycle) {
    return {
      dates: retryDates,
      maxMetricDate: getMaxMetricDate(database),
      safeEndDate,
      source: "retry",
    };
  }

  const maxMetricDate = getMaxMetricDate(database);
  const startDate = maxMetricDate
    ? addUtcDays(maxMetricDate, 1)
    : addUtcDays(safeEndDate, -daysPerCycle + 1);
  const newDates =
    startDate && compareDateStrings(startDate, safeEndDate) <= 0
      ? buildDateRange(startDate, safeEndDate, daysPerCycle - retryDates.length)
      : [];
  const dates = [...new Set([...retryDates, ...newDates])].slice(0, daysPerCycle);

  return {
    dates,
    maxMetricDate,
    safeEndDate,
    source: retryDates.length > 0 ? "retry_and_new" : "new",
  };
}

export async function runGhArchiveLoop({
  activeIntervalMs = 60 * 1000,
  daysPerCycle = 1,
  hourTimeoutMs = 30 * 60 * 1000,
  intervalMs = 60 * 60 * 1000,
  lagDays = 1,
  minDailyContributors = 3,
  minDailyEvents = 6,
  once = false,
} = {}) {
  loadLocalEnv();

  let cycle = 1;

  while (true) {
    const startedAt = new Date().toISOString();
    let hadError = false;
    let processedDates = [];

    try {
      const database = openSkylineDatabase();
      let selection;

      try {
        selection = selectIncrementalDates(database, {
          daysPerCycle,
          lagDays,
        });
      } finally {
        database.close();
      }

      console.error(
        `[gharchive-loop] starting cycle=${cycle} source=${selection.source} maxMetricDate=${selection.maxMetricDate ?? "none"} safeEndDate=${selection.safeEndDate} dates=${selection.dates.join(",") || "none"} startedAt=${startedAt}`,
      );

      if (selection.dates.length > 0) {
        await backfillGhArchiveDates({
          hourTimeoutMs,
          metricDates: selection.dates,
          minDailyContributors,
          minDailyEvents,
          replaceExisting: true,
        });
        processedDates = selection.dates;
      }

      try {
        const stateDatabase = openSkylineDatabase();

        try {
          ensureSchema(stateDatabase);
          setIngestionState(stateDatabase, "gharchive_incremental", {
            completedAt: new Date().toISOString(),
            cycle,
            daysPerCycle,
            hourTimeoutMs,
            lagDays,
            processedDates,
            safeEndDate: selection.safeEndDate,
            startedAt,
            status: "ok",
          });
        } finally {
          stateDatabase.close();
        }
      } catch (stateError) {
        console.error(
          `[gharchive-loop] cycle=${cycle} processed but failed to write state`,
          stateError,
        );
      }

      console.error(
        `[gharchive-loop] cycle=${cycle} completed processed=${processedDates.join(",") || "none"}`,
      );
    } catch (error) {
      hadError = true;

      try {
        const stateDatabase = openSkylineDatabase();

        try {
          ensureSchema(stateDatabase);
          setIngestionState(stateDatabase, "gharchive_incremental", {
            completedAt: new Date().toISOString(),
            cycle,
            error: error instanceof Error ? error.message.slice(0, 600) : String(error).slice(0, 600),
            processedDates,
            startedAt,
            status: "error",
          });
        } finally {
          stateDatabase.close();
        }
      } catch (stateError) {
        console.error(
          `[gharchive-loop] cycle=${cycle} failed and could not write error state`,
          stateError,
        );
      }

      console.error(`[gharchive-loop] cycle=${cycle} failed at ${startedAt}`, error);
    }

    if (once) {
      return;
    }

    const sleepMs = processedDates.length > 0 || hadError ? activeIntervalMs : intervalMs;
    console.error(`[gharchive-loop] sleeping intervalMs=${sleepMs} after cycle=${cycle}`);
    cycle += 1;
    await sleep(sleepMs);
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  runGhArchiveLoop({
    activeIntervalMs: Number(args["active-interval-ms"] ?? 60 * 1000),
    daysPerCycle: Number(args["days-per-cycle"] ?? 1),
    hourTimeoutMs: Number(args["hour-timeout-ms"] ?? 30 * 60 * 1000),
    intervalMs: Number(args["interval-ms"] ?? 60 * 60 * 1000),
    lagDays: Number(args["lag-days"] ?? 1),
    minDailyContributors: Number(args["min-daily-contributors"] ?? 3),
    minDailyEvents: Number(args["min-daily-events"] ?? 6),
    once: args.once === "true" || args.once === "1",
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
