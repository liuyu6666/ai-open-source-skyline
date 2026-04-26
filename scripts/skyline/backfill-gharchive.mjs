import {
  buildTrailingUtcDates,
  ensureSchema,
  formatUtcDate,
  ghArchiveUrl,
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
  runWithSqliteBusyRetry,
  setIngestionState,
  streamGhArchiveLines,
  withTransaction,
} from "./shared.mjs";

const updateEventTypes = new Set([
  "PushEvent",
  "PullRequestEvent",
  "IssuesEvent",
  "IssueCommentEvent",
  "PullRequestReviewEvent",
  "PullRequestReviewCommentEvent",
  "ReleaseEvent",
  "CreateEvent",
]);

function createHourlyBucket(metricDate) {
  return {
    actorKeys: new Set(),
    metricDate,
    metrics: new Map(),
    repos: new Map(),
    totals: {
      actorRows: 0,
      eventRows: 0,
      metricRows: 0,
      repoRows: 0,
    },
  };
}

function ensureMetricRow(bucket, repoFullName) {
  const existing = bucket.metrics.get(repoFullName);

  if (existing) {
    return existing;
  }

  const created = {
    createEvents: 0,
    createdRepo: 0,
    forkEvents: 0,
    issueCommentEvents: 0,
    issuesEvents: 0,
    pullRequestEvents: 0,
    pushEvents: 0,
    releaseEvents: 0,
    totalEvents: 0,
    watchEvents: 0,
  };

  bucket.metrics.set(repoFullName, created);
  return created;
}

function updateMetricCounters(metric, event) {
  metric.totalEvents += 1;

  switch (event.type) {
    case "WatchEvent":
      metric.watchEvents += 1;
      break;
    case "PushEvent":
      metric.pushEvents += 1;
      break;
    case "PullRequestEvent":
      metric.pullRequestEvents += 1;
      break;
    case "IssuesEvent":
      metric.issuesEvents += 1;
      break;
    case "IssueCommentEvent":
    case "PullRequestReviewCommentEvent":
      metric.issueCommentEvents += 1;
      break;
    case "ReleaseEvent":
      metric.releaseEvents += 1;
      break;
    case "ForkEvent":
      metric.forkEvents += 1;
      break;
    case "CreateEvent":
      metric.createEvents += 1;
      if (event.payload?.ref_type === "repository") {
        metric.createdRepo = 1;
      }
      break;
    default:
      break;
  }
}

function recordEvent(bucket, event) {
  const repoFullName = event.repo?.name;
  const repoName = repoFullName?.split("/")[1];
  const ownerLogin = repoFullName?.split("/")[0];

  if (!repoFullName || !repoName || !ownerLogin) {
    return;
  }

  const metric = ensureMetricRow(bucket, repoFullName);
  const repoRecord = bucket.repos.get(repoFullName);

  if (!repoRecord) {
    bucket.repos.set(repoFullName, {
      createdAt: event.payload?.ref_type === "repository" ? event.created_at : null,
      ownerLogin,
      repoId: event.repo?.id ?? null,
      repoName,
    });
  }

  updateMetricCounters(metric, event);

  if (updateEventTypes.has(event.type) && event.actor?.login) {
    bucket.actorKeys.add(`${repoFullName}\t${bucket.metricDate}\t${event.actor.login}`);
  }
}

function flushBucket(database, bucket) {
  const repoUpsert = database.prepare(
    `
      INSERT INTO skyline_repos (
        full_name,
        repo_id,
        owner_login,
        repo_name,
        created_at,
        first_seen_at,
        last_seen_at
      )
      VALUES (
        $fullName,
        $repoId,
        $ownerLogin,
        $repoName,
        $createdAt,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(full_name) DO UPDATE SET
        repo_id = COALESCE(excluded.repo_id, skyline_repos.repo_id),
        owner_login = excluded.owner_login,
        repo_name = excluded.repo_name,
        created_at = COALESCE(skyline_repos.created_at, excluded.created_at),
        last_seen_at = CURRENT_TIMESTAMP
    `,
  );

  const metricUpsert = database.prepare(
    `
      INSERT INTO skyline_repo_daily_metrics (
        repo_full_name,
        metric_date,
        watch_events,
        push_events,
        pull_request_events,
        issues_events,
        issue_comment_events,
        release_events,
        fork_events,
        create_events,
        total_events,
        contributors,
        created_repo
      )
      VALUES (
        $repoFullName,
        $metricDate,
        $watchEvents,
        $pushEvents,
        $pullRequestEvents,
        $issuesEvents,
        $issueCommentEvents,
        $releaseEvents,
        $forkEvents,
        $createEvents,
        $totalEvents,
        0,
        $createdRepo
      )
      ON CONFLICT(repo_full_name, metric_date) DO UPDATE SET
        watch_events = skyline_repo_daily_metrics.watch_events + excluded.watch_events,
        push_events = skyline_repo_daily_metrics.push_events + excluded.push_events,
        pull_request_events = skyline_repo_daily_metrics.pull_request_events + excluded.pull_request_events,
        issues_events = skyline_repo_daily_metrics.issues_events + excluded.issues_events,
        issue_comment_events = skyline_repo_daily_metrics.issue_comment_events + excluded.issue_comment_events,
        release_events = skyline_repo_daily_metrics.release_events + excluded.release_events,
        fork_events = skyline_repo_daily_metrics.fork_events + excluded.fork_events,
        create_events = skyline_repo_daily_metrics.create_events + excluded.create_events,
        total_events = skyline_repo_daily_metrics.total_events + excluded.total_events,
        created_repo = MAX(skyline_repo_daily_metrics.created_repo, excluded.created_repo)
    `,
  );

  const actorInsert = database.prepare(
    `
      INSERT OR IGNORE INTO skyline_repo_daily_actors (
        repo_full_name,
        metric_date,
        actor_login
      )
      VALUES ($repoFullName, $metricDate, $actorLogin)
    `,
  );

  withTransaction(database, () => {
    for (const [fullName, repo] of bucket.repos) {
      repoUpsert.run({
        createdAt: repo.createdAt,
        fullName,
        ownerLogin: repo.ownerLogin,
        repoId: repo.repoId,
        repoName: repo.repoName,
      });
    }

    for (const [repoFullName, metric] of bucket.metrics) {
      metricUpsert.run({
        createEvents: metric.createEvents,
        createdRepo: metric.createdRepo,
        forkEvents: metric.forkEvents,
        issueCommentEvents: metric.issueCommentEvents,
        issuesEvents: metric.issuesEvents,
        metricDate: bucket.metricDate,
        pullRequestEvents: metric.pullRequestEvents,
        pushEvents: metric.pushEvents,
        releaseEvents: metric.releaseEvents,
        repoFullName,
        totalEvents: metric.totalEvents,
        watchEvents: metric.watchEvents,
      });
    }

    for (const key of bucket.actorKeys) {
      const [repoFullName, metricDate, actorLogin] = key.split("\t");
      actorInsert.run({
        actorLogin,
        metricDate,
        repoFullName,
      });
    }
  });

  bucket.totals.repoRows += bucket.repos.size;
  bucket.totals.metricRows += bucket.metrics.size;
  bucket.totals.actorRows += bucket.actorKeys.size;
}

function refreshContributorCounts(database, metricDates) {
  const placeholder = metricDates.map(() => "?").join(", ");

  withTransaction(database, () => {
    database
      .prepare(
        `
          UPDATE skyline_repo_daily_metrics
          SET contributors = 0
          WHERE metric_date IN (${placeholder})
        `,
      )
      .run(...metricDates);

    database
      .prepare(
        `
          UPDATE skyline_repo_daily_metrics
          SET contributors = (
            SELECT COUNT(*)
            FROM skyline_repo_daily_actors
            WHERE skyline_repo_daily_actors.repo_full_name = skyline_repo_daily_metrics.repo_full_name
              AND skyline_repo_daily_actors.metric_date = skyline_repo_daily_metrics.metric_date
          )
          WHERE metric_date IN (${placeholder})
        `,
      )
      .run(...metricDates);
  });
}

function clearActorRows(database, metricDate) {
  runWithSqliteBusyRetry(
    () =>
      database
        .prepare(
          `
            DELETE FROM skyline_repo_daily_actors
            WHERE metric_date = ?
          `,
        )
        .run(metricDate),
    {
      label: `clear actors ${metricDate}`,
    },
  );
}

function clearMetricDate(database, metricDate) {
  withTransaction(database, () => {
    database
      .prepare(
        `
          DELETE FROM skyline_repo_daily_actors
          WHERE metric_date = ?
        `,
      )
      .run(metricDate);

    database
      .prepare(
        `
          DELETE FROM skyline_repo_daily_metrics
          WHERE metric_date = ?
        `,
      )
      .run(metricDate);
  });
}

function setGhArchiveDayState(database, metricDate, state) {
  return runWithSqliteBusyRetry(
    () =>
      database
        .prepare(
          `
            INSERT INTO skyline_gharchive_days (
              metric_date,
              status,
              started_at,
              completed_at,
              event_rows,
              repo_rows,
              metric_rows,
              actor_rows,
              pruned_metrics,
              pruned_repos,
              error_message,
              updated_at
            )
            VALUES (
              $metricDate,
              $status,
              $startedAt,
              $completedAt,
              $eventRows,
              $repoRows,
              $metricRows,
              $actorRows,
              $prunedMetrics,
              $prunedRepos,
              $errorMessage,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT(metric_date) DO UPDATE SET
              status = excluded.status,
              started_at = COALESCE(excluded.started_at, skyline_gharchive_days.started_at),
              completed_at = excluded.completed_at,
              event_rows = excluded.event_rows,
              repo_rows = excluded.repo_rows,
              metric_rows = excluded.metric_rows,
              actor_rows = excluded.actor_rows,
              pruned_metrics = excluded.pruned_metrics,
              pruned_repos = excluded.pruned_repos,
              error_message = excluded.error_message,
              updated_at = CURRENT_TIMESTAMP
          `,
        )
        .run({
          actorRows: state.actorRows ?? 0,
          completedAt: state.completedAt ?? null,
          errorMessage: state.errorMessage ?? null,
          eventRows: state.eventRows ?? 0,
          metricDate,
          metricRows: state.metricRows ?? 0,
          prunedMetrics: state.prunedMetrics ?? 0,
          prunedRepos: state.prunedRepos ?? 0,
          repoRows: state.repoRows ?? 0,
          startedAt: state.startedAt ?? null,
          status: state.status,
        }),
    {
      label: `gharchive day ${metricDate}`,
    },
  );
}

function pruneDailyNoise(
  database,
  metricDate,
  {
    minDailyEvents = 6,
    minDailyContributors = 3,
  } = {},
) {
  let removedMetrics = 0;
  let removedRepos = 0;

  withTransaction(database, () => {
    removedMetrics = database
      .prepare(
        `
          DELETE FROM skyline_repo_daily_metrics
          WHERE metric_date = ?
            AND watch_events = 0
            AND total_events < ?
            AND contributors < ?
            AND created_repo = 0
        `,
      )
      .run(metricDate, minDailyEvents, minDailyContributors).changes;

    removedRepos = database
      .prepare(
        `
          DELETE FROM skyline_repos
          WHERE full_name NOT IN (
            SELECT DISTINCT repo_full_name
            FROM skyline_repo_daily_metrics
          )
        `,
      )
      .run().changes;
  });

  try {
    runWithSqliteBusyRetry(
      () => database.exec("PRAGMA wal_checkpoint(PASSIVE);"),
      {
        label: `checkpoint after ${metricDate}`,
        retries: 2,
      },
    );
  } catch (error) {
    console.warn(`Skipping WAL checkpoint after ${metricDate}`, error);
  }

  return {
    removedMetrics,
    removedRepos,
  };
}

async function processHour(database, metricDate, hour, { hourTimeoutMs } = {}) {
  const bucket = createHourlyBucket(metricDate);
  const startedAt = Date.now();
  let lastProgressAt = startedAt;

  await streamGhArchiveLines(
    metricDate,
    hour,
    (line) => {
      bucket.totals.eventRows += 1;

      const now = Date.now();

      if (
        bucket.totals.eventRows % 250_000 === 0 ||
        now - lastProgressAt >= 30_000
      ) {
        console.log(
          `Progress ${metricDate}-${hour}: events=${bucket.totals.eventRows} elapsedMs=${now - startedAt}`,
        );
        lastProgressAt = now;
      }

      try {
        const event = JSON.parse(line);
        recordEvent(bucket, event);
      } catch (error) {
        console.warn(`Skipping malformed GH Archive line for ${metricDate}-${hour}`, error);
      }
    },
    {
      timeoutMs: hourTimeoutMs,
    },
  );

  flushBucket(database, bucket);
  console.log(
    `Finished ${metricDate}-${hour}: events=${bucket.totals.eventRows} repos=${bucket.totals.repoRows} metrics=${bucket.totals.metricRows} actors=${bucket.totals.actorRows} elapsedMs=${Date.now() - startedAt}`,
  );

  return bucket.totals;
}

export async function backfillGhArchiveDates({
  metricDates,
  minDailyContributors = 3,
  minDailyEvents = 6,
  hourLimit = null,
  hourTimeoutMs = Number(process.env.GHARCHIVE_HOUR_TIMEOUT_MS ?? 30 * 60 * 1000),
  replaceExisting = false,
} = {}) {
  loadLocalEnv();

  const database = openSkylineDatabase();
  ensureSchema(database);

  const startedAt = new Date().toISOString();
  const summary = {
    actorRows: 0,
    eventRows: 0,
    metricRows: 0,
    repoRows: 0,
    startedAt,
  };

  try {
    for (const metricDate of metricDates) {
      const dayStartedAt = new Date().toISOString();
      const daySummary = {
        actorRows: 0,
        eventRows: 0,
        metricRows: 0,
        repoRows: 0,
      };

      try {
        setGhArchiveDayState(database, metricDate, {
          startedAt: dayStartedAt,
          status: "running",
        });

        if (replaceExisting) {
          clearMetricDate(database, metricDate);
        }

        for (let hour = 0; hour < 24; hour += 1) {
          if (hourLimit !== null && hour >= hourLimit) {
            break;
          }

          console.log(`Backfilling ${ghArchiveUrl(metricDate, hour)}`);
          const totals = await processHour(database, metricDate, hour, {
            hourTimeoutMs,
          });

          summary.actorRows += totals.actorRows;
          summary.eventRows += totals.eventRows;
          summary.metricRows += totals.metricRows;
          summary.repoRows += totals.repoRows;
          daySummary.actorRows += totals.actorRows;
          daySummary.eventRows += totals.eventRows;
          daySummary.metricRows += totals.metricRows;
          daySummary.repoRows += totals.repoRows;
        }

        refreshContributorCounts(database, [metricDate]);
        clearActorRows(database, metricDate);
        const pruned = pruneDailyNoise(database, metricDate, {
          minDailyContributors,
          minDailyEvents,
        });
        setGhArchiveDayState(database, metricDate, {
          ...daySummary,
          completedAt: new Date().toISOString(),
          prunedMetrics: pruned.removedMetrics,
          prunedRepos: pruned.removedRepos,
          startedAt: dayStartedAt,
          status: "ok",
        });
        console.log(`Completed ${metricDate}`, { ...daySummary, ...pruned });
      } catch (error) {
        setGhArchiveDayState(database, metricDate, {
          ...daySummary,
          errorMessage:
            error instanceof Error ? error.message.slice(0, 600) : String(error).slice(0, 600),
          startedAt: dayStartedAt,
          status: "error",
        });
        throw error;
      }
    }
    setIngestionState(database, "gharchive_backfill", {
      completedAt: new Date().toISOString(),
      endDate: metricDates.at(-1),
      metricDates,
      replaceExisting,
      startedAt,
      summary,
      thresholds: {
        minDailyContributors,
        minDailyEvents,
      },
    });

    return summary;
  } finally {
    database.close();
  }
}

export async function backfillGhArchive({
  days = 30,
  endDate,
  hourLimit = null,
  hourTimeoutMs = Number(process.env.GHARCHIVE_HOUR_TIMEOUT_MS ?? 30 * 60 * 1000),
  minDailyContributors = 3,
  minDailyEvents = 6,
  replaceExisting = false,
} = {}) {
  const metricDates = buildTrailingUtcDates(days, endDate).map(formatUtcDate);

  return backfillGhArchiveDates({
    hourLimit,
    hourTimeoutMs,
    metricDates,
    minDailyContributors,
    minDailyEvents,
    replaceExisting,
  });
}

if (isMainModule(import.meta)) {
  const args = parseArgs();
  const days = Number(args.days ?? 30);
  const hourLimit =
    args["hour-limit"] === undefined ? null : Number(args["hour-limit"]);

  backfillGhArchive({
    days,
    endDate: args["end-date"],
    hourLimit,
    hourTimeoutMs: Number(args["hour-timeout-ms"] ?? 30 * 60 * 1000),
    minDailyContributors: Number(args["min-daily-contributors"] ?? 3),
    minDailyEvents: Number(args["min-daily-events"] ?? 6),
    replaceExisting: args["replace-existing"] === "true" || args["replace-existing"] === "1",
  })
    .then((summary) => {
      console.log("Completed GH Archive backfill.");
      console.log(summary);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
