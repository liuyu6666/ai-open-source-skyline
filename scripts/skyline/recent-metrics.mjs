import {
  ensureSchema,
  getIngestionState,
  minutesSinceTimestamp,
  setIngestionState,
  withTransaction,
} from "./shared.mjs";

const defaultLogger = {
  log: (...args) => console.error(...args),
};

function getCurrentAnchorMetricDate(database) {
  const row = database
    .prepare(
      `
        SELECT COALESCE(MAX(metric_date), DATE('now', '-1 day')) AS anchor_metric_date
        FROM skyline_repo_daily_metrics
      `,
    )
    .get();

  return row?.anchor_metric_date ?? null;
}

function getRecentMetricsRowCount(database) {
  const row = database
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM skyline_repo_recent_metrics
      `,
    )
    .get();

  return Number(row?.count ?? 0);
}

export function getRecentMetricsState(database) {
  return getIngestionState(database, "recent_metrics_rollup");
}

export function inspectRecentMetricsFreshness(database, { maxAgeMinutes = 60 } = {}) {
  ensureSchema(database);

  const anchorMetricDate = getCurrentAnchorMetricDate(database);
  const rowCount = getRecentMetricsRowCount(database);
  const state = getRecentMetricsState(database);
  const updatedAt = state?.updatedAt ?? null;
  const ageMinutes = minutesSinceTimestamp(updatedAt);
  const stateAnchor = state?.value?.anchorMetricDate ?? null;

  if (rowCount === 0) {
    return {
      ageMinutes,
      anchorMetricDate,
      reason: "empty_table",
      rowCount,
      stale: true,
      state,
      updatedAt,
    };
  }

  if (!state) {
    return {
      ageMinutes,
      anchorMetricDate,
      reason: "missing_state",
      rowCount,
      stale: true,
      state,
      updatedAt,
    };
  }

  if (stateAnchor !== anchorMetricDate) {
    return {
      ageMinutes,
      anchorMetricDate,
      reason: "anchor_changed",
      rowCount,
      stale: true,
      state,
      updatedAt,
    };
  }

  if (!Number.isFinite(ageMinutes) || ageMinutes > maxAgeMinutes) {
    return {
      ageMinutes,
      anchorMetricDate,
      reason: "stale_age",
      rowCount,
      stale: true,
      state,
      updatedAt,
    };
  }

  return {
    ageMinutes,
    anchorMetricDate,
    reason: "fresh",
    rowCount,
    stale: false,
    state,
    updatedAt,
  };
}

export function refreshRecentMetrics(
  database,
  { days = 30, force = false, logger = defaultLogger, maxAgeMinutes = 60 } = {},
) {
  ensureSchema(database);

  const freshness = inspectRecentMetricsFreshness(database, {
    maxAgeMinutes,
  });

  if (!force && !freshness.stale) {
    logger.log(
      `[recent-metrics] reusing fresh rollup rows=${freshness.rowCount} updatedAt=${freshness.updatedAt} ageMinutes=${freshness.ageMinutes.toFixed(1)}`,
    );

    return {
      ageMinutes: freshness.ageMinutes,
      anchorMetricDate: freshness.anchorMetricDate,
      completedAt:
        freshness.state?.value?.completedAt ??
        (freshness.updatedAt ? new Date(`${freshness.updatedAt.replace(" ", "T")}Z`).toISOString() : null),
      days,
      refreshed: false,
      refreshedAt: freshness.updatedAt,
      rowCount: freshness.rowCount,
      staleReason: freshness.reason,
    };
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();

  logger.log(
    `[recent-metrics] refreshing days=${days} force=${force ? 1 : 0} staleReason=${freshness.reason} anchorMetricDate=${freshness.anchorMetricDate}`,
  );
  logger.log("[recent-metrics] rebuilding helper table");

  withTransaction(database, () => {
    database.exec("DELETE FROM skyline_repo_recent_metrics");

    database
      .prepare(
        `
          WITH anchor AS (
            SELECT COALESCE(MAX(metric_date), DATE('now', '-1 day')) AS max_metric_date
            FROM skyline_repo_daily_metrics
          ),
          tracked_repos AS (
            SELECT full_name
            FROM skyline_repos
            WHERE archived = 0
              AND disabled = 0
              AND is_fork = 0
          ),
          recent AS (
            SELECT
              skyline_repo_daily_metrics.repo_full_name,
              SUM(CASE
                WHEN skyline_repo_daily_metrics.metric_date >= DATE(anchor.max_metric_date, '-6 days')
                THEN skyline_repo_daily_metrics.watch_events
                ELSE 0
              END) AS star_delta_7d,
              SUM(skyline_repo_daily_metrics.watch_events) AS star_delta_30d,
              SUM(skyline_repo_daily_metrics.total_events) AS events_30d,
              SUM(CASE
                WHEN skyline_repo_daily_metrics.metric_date >= DATE(anchor.max_metric_date, '-6 days')
                THEN skyline_repo_daily_metrics.push_events
                  + skyline_repo_daily_metrics.pull_request_events
                  + skyline_repo_daily_metrics.issues_events
                  + skyline_repo_daily_metrics.issue_comment_events
                  + skyline_repo_daily_metrics.release_events
                  + skyline_repo_daily_metrics.create_events
                ELSE 0
              END) AS update_events_7d,
              SUM(
                skyline_repo_daily_metrics.push_events
                + skyline_repo_daily_metrics.pull_request_events
                + skyline_repo_daily_metrics.issues_events
                + skyline_repo_daily_metrics.issue_comment_events
                + skyline_repo_daily_metrics.release_events
                + skyline_repo_daily_metrics.create_events
              ) AS update_events_30d,
              SUM(skyline_repo_daily_metrics.contributors) AS contributors_30d,
              MAX(CASE WHEN skyline_repo_daily_metrics.created_repo = 1 THEN 1 ELSE 0 END) AS created_in_30d,
              MAX(skyline_repo_daily_metrics.metric_date) AS last_metric_date
            FROM skyline_repo_daily_metrics
            JOIN tracked_repos
              ON tracked_repos.full_name = skyline_repo_daily_metrics.repo_full_name
            CROSS JOIN anchor
            WHERE skyline_repo_daily_metrics.metric_date >= DATE(
              anchor.max_metric_date,
              '-' || CAST($days - 1 AS TEXT) || ' days'
            )
            GROUP BY skyline_repo_daily_metrics.repo_full_name
          ),
          trend AS (
            SELECT
              repo_full_name,
              json_group_array(watch_events) AS trend_json
            FROM (
              SELECT
                skyline_repo_daily_metrics.repo_full_name,
                skyline_repo_daily_metrics.metric_date,
                skyline_repo_daily_metrics.watch_events
              FROM skyline_repo_daily_metrics
              JOIN tracked_repos
                ON tracked_repos.full_name = skyline_repo_daily_metrics.repo_full_name
              CROSS JOIN anchor
              WHERE skyline_repo_daily_metrics.metric_date >= DATE(anchor.max_metric_date, '-6 days')
              ORDER BY skyline_repo_daily_metrics.repo_full_name ASC, skyline_repo_daily_metrics.metric_date ASC
            )
            GROUP BY repo_full_name
          )
          INSERT INTO skyline_repo_recent_metrics (
            repo_full_name,
            anchor_metric_date,
            last_metric_date,
            star_delta_7d,
            star_delta_30d,
            events_30d,
            update_events_7d,
            update_events_30d,
            contributors_30d,
            created_in_30d,
            trend_json,
            refreshed_at
          )
          SELECT
            recent.repo_full_name,
            anchor.max_metric_date,
            recent.last_metric_date,
            COALESCE(recent.star_delta_7d, 0),
            COALESCE(recent.star_delta_30d, 0),
            COALESCE(recent.events_30d, 0),
            COALESCE(recent.update_events_7d, 0),
            COALESCE(recent.update_events_30d, 0),
            COALESCE(recent.contributors_30d, 0),
            COALESCE(recent.created_in_30d, 0),
            COALESCE(trend.trend_json, '[]'),
            CURRENT_TIMESTAMP
          FROM recent
          CROSS JOIN anchor
          LEFT JOIN trend
            ON trend.repo_full_name = recent.repo_full_name
        `,
      )
      .run({
        days,
      });
  });

  const completedAt = new Date().toISOString();
  const rowCount = getRecentMetricsRowCount(database);
  const anchorMetricDate = getCurrentAnchorMetricDate(database);
  const durationMs = Date.now() - startedAt;
  const summary = {
    anchorMetricDate,
    completedAt,
    days,
    durationMs,
    refreshed: true,
    rowCount,
    startedAt: startedAtIso,
    staleReason: freshness.reason,
  };

  setIngestionState(database, "recent_metrics_rollup", summary);
  logger.log(
    `[recent-metrics] completed rows=${rowCount} anchorMetricDate=${anchorMetricDate} durationMs=${durationMs}`,
  );

  return summary;
}
