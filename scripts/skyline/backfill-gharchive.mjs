import {
  buildTrailingUtcDates,
  ensureSchema,
  formatUtcDate,
  ghArchiveUrl,
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
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

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};

  for (const item of argv) {
    if (!item.startsWith("--")) {
      continue;
    }

    const body = item.slice(2);
    const separatorIndex = body.indexOf("=");

    if (separatorIndex === -1) {
      parsed[body] = "true";
      continue;
    }

    parsed[body.slice(0, separatorIndex)] = body.slice(separatorIndex + 1);
  }

  return parsed;
}

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
  database
    .prepare(
      `
        DELETE FROM skyline_repo_daily_actors
        WHERE metric_date = ?
      `,
    )
    .run(metricDate);
}

function pruneDailyNoise(
  database,
  metricDate,
  {
    minDailyEvents = 6,
    minDailyContributors = 3,
  } = {},
) {
  const removedMetrics = database
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

  const removedRepos = database
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

  database.exec("PRAGMA wal_checkpoint(TRUNCATE);");

  return {
    removedMetrics,
    removedRepos,
  };
}

async function processHour(database, metricDate, hour) {
  const bucket = createHourlyBucket(metricDate);

  await streamGhArchiveLines(metricDate, hour, (line) => {
    bucket.totals.eventRows += 1;

    try {
      const event = JSON.parse(line);
      recordEvent(bucket, event);
    } catch (error) {
      console.warn(`Skipping malformed GH Archive line for ${metricDate}-${hour}`, error);
    }
  });

  flushBucket(database, bucket);

  return bucket.totals;
}

export async function backfillGhArchive({
  days = 30,
  endDate,
  hourLimit = null,
  minDailyContributors = 3,
  minDailyEvents = 6,
} = {}) {
  loadLocalEnv();

  const database = openSkylineDatabase();
  ensureSchema(database);

  const metricDates = buildTrailingUtcDates(days, endDate).map(formatUtcDate);
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
      const daySummary = {
        actorRows: 0,
        eventRows: 0,
        metricRows: 0,
        repoRows: 0,
      };

      for (let hour = 0; hour < 24; hour += 1) {
        if (hourLimit !== null && hour >= hourLimit) {
          break;
        }

        console.log(`Backfilling ${ghArchiveUrl(metricDate, hour)}`);
        const totals = await processHour(database, metricDate, hour);

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
      console.log(`Completed ${metricDate}`, { ...daySummary, ...pruned });
    }
    setIngestionState(database, "gharchive_backfill", {
      completedAt: new Date().toISOString(),
      days,
      endDate: metricDates.at(-1),
      metricDates,
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

if (isMainModule(import.meta)) {
  const args = parseArgs();
  const days = Number(args.days ?? 30);
  const hourLimit =
    args["hour-limit"] === undefined ? null : Number(args["hour-limit"]);

  backfillGhArchive({
    days,
    endDate: args["end-date"],
    hourLimit,
    minDailyContributors: Number(args["min-daily-contributors"] ?? 3),
    minDailyEvents: Number(args["min-daily-events"] ?? 6),
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
