import {
  ensureSchema,
  fetchGitHubJson,
  getGitHubToken,
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  setIngestionState,
  sleep,
} from "./shared.mjs";

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

function selectCandidateRepos(database, { days, limit }) {
  return database
    .prepare(
      `
        WITH anchor AS (
          SELECT COALESCE(MAX(metric_date), DATE('now', '-1 day')) AS max_metric_date
          FROM skyline_repo_daily_metrics
        ),
        recent AS (
          SELECT
            repo_full_name,
            SUM(watch_events) AS stars_30d,
            SUM(total_events) AS events_30d,
            MAX(metric_date) AS last_metric_date
          FROM skyline_repo_daily_metrics
          CROSS JOIN anchor
          WHERE metric_date >= DATE(
            anchor.max_metric_date,
            '-' || CAST($days - 1 AS TEXT) || ' days'
          )
          GROUP BY repo_full_name
        )
        SELECT
          skyline_repos.full_name AS full_name,
          skyline_repos.last_enriched_at AS last_enriched_at,
          skyline_repos.stargazers_count AS stargazers_count,
          recent.stars_30d AS stars_30d,
          recent.events_30d AS events_30d
        FROM recent
        JOIN skyline_repos ON skyline_repos.full_name = recent.repo_full_name
        WHERE skyline_repos.archived = 0
          AND skyline_repos.disabled = 0
        ORDER BY
          COALESCE(skyline_repos.stargazers_count, 0) DESC,
          COALESCE(recent.stars_30d, 0) DESC,
          COALESCE(recent.events_30d, 0) DESC
        LIMIT $limit
      `,
    )
    .all({
      days,
      limit,
    });
}

function selectCatalogRepos(database, { limit, missingOnly }) {
  return database
    .prepare(
      `
        SELECT
          full_name,
          last_enriched_at,
          stargazers_count,
          last_seen_at
        FROM skyline_repos
        WHERE archived = 0
          AND disabled = 0
          AND is_fork = 0
          AND ($missingOnly = 0 OR last_enriched_at IS NULL OR COALESCE(stargazers_count, 0) = 0)
        ORDER BY
          CASE WHEN last_enriched_at IS NULL THEN 0 ELSE 1 END ASC,
          last_enriched_at ASC,
          last_seen_at DESC,
          full_name ASC
        LIMIT $limit
      `,
    )
    .all({
      limit,
      missingOnly: missingOnly ? 1 : 0,
    });
}

function updateRepoMetadata(database, repo) {
  database
    .prepare(
      `
        UPDATE skyline_repos
        SET
          repo_id = $repoId,
          description = $description,
          language = $language,
          topics_json = $topicsJson,
          html_url = $htmlUrl,
          homepage = $homepage,
          default_branch = $defaultBranch,
          stargazers_count = $stargazersCount,
          forks_count = $forksCount,
          open_issues_count = $openIssuesCount,
          watchers_count = $watchersCount,
          repo_size_kb = $repoSizeKb,
          created_at = COALESCE(created_at, $createdAt),
          pushed_at = $pushedAt,
          updated_at = $updatedAt,
          archived = $archived,
          disabled = $disabled,
          is_fork = $isFork,
          last_enriched_at = CURRENT_TIMESTAMP,
          last_seen_at = CURRENT_TIMESTAMP
        WHERE full_name = $fullName
      `,
    )
    .run({
      archived: repo.archived ? 1 : 0,
      createdAt: repo.created_at,
      defaultBranch: repo.default_branch,
      description: repo.description,
      disabled: repo.disabled ? 1 : 0,
      forksCount: repo.forks_count ?? 0,
      fullName: repo.full_name,
      homepage: repo.homepage,
      htmlUrl: repo.html_url,
      isFork: repo.fork ? 1 : 0,
      language: repo.language,
      openIssuesCount: repo.open_issues_count ?? 0,
      pushedAt: repo.pushed_at,
      repoId: repo.id,
      repoSizeKb: repo.size ?? 0,
      stargazersCount: repo.stargazers_count ?? 0,
      topicsJson: JSON.stringify(repo.topics ?? []),
      updatedAt: repo.updated_at,
      watchersCount: repo.watchers_count ?? 0,
    });
}

function markRepoEnrichmentAttempt(database, fullName) {
  database
    .prepare(
      `
        UPDATE skyline_repos
        SET
          last_enriched_at = CURRENT_TIMESTAMP,
          last_seen_at = CURRENT_TIMESTAMP
        WHERE full_name = $fullName
      `,
    )
    .run({
      fullName,
    });
}

function createRateLimiter(ratePerHour) {
  if (!ratePerHour || ratePerHour <= 0) {
    return async () => {};
  }

  const minIntervalMs = Math.ceil(3_600_000 / ratePerHour);
  let nextAllowedAt = 0;

  return async () => {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextAllowedAt);
    const waitMs = scheduledAt - now;
    nextAllowedAt = scheduledAt + minIntervalMs;

    if (waitMs > 0) {
      await sleep(waitMs);
    }
  };
}

async function enrichSingleRepo(database, fullName, delayMs, waitForTurn) {
  try {
    await waitForTurn();
    const repo = await fetchGitHubJson(`/repos/${fullName}`);
    updateRepoMetadata(database, repo);
    await sleep(delayMs);
    return { fullName, ok: true };
  } catch (error) {
    console.warn(`Failed to enrich ${fullName}`, error);
    markRepoEnrichmentAttempt(database, fullName);
    await sleep(delayMs);
    return { fullName, ok: false };
  }
}

export async function enrichRepos({
  concurrency = 6,
  days = 30,
  delayMs = 120,
  limit = 1500,
  missingOnly = false,
  ratePerHour = 4200,
  scope = "recent",
} = {}) {
  loadLocalEnv();

  const hasToken = Boolean(getGitHubToken());
  const effectiveLimit = hasToken ? limit : Math.min(limit, 45);
  const effectiveConcurrency = hasToken ? concurrency : 1;
  const effectiveDelayMs = hasToken ? delayMs : Math.max(delayMs, 1800);
  const effectiveRatePerHour = hasToken ? ratePerHour : Math.min(ratePerHour, 45);

  const database = openSkylineDatabase();
  ensureSchema(database);

  try {
    if (!hasToken) {
      console.warn(
        `Missing GITHUB_TOKEN/GH_TOKEN. Falling back to unauthenticated enrichment for ${effectiveLimit} repos.`,
      );
    }

    const candidates =
      scope === "recent"
        ? selectCandidateRepos(database, {
            days,
            limit: effectiveLimit,
          })
        : selectCatalogRepos(database, {
            limit: effectiveLimit,
            missingOnly,
          });
    const pending = [...candidates];
    const results = [];
    const waitForTurn = createRateLimiter(effectiveRatePerHour);
    let processed = 0;

    async function worker() {
      for (;;) {
        const next = pending.shift();

        if (!next) {
          return;
        }

        const result = await enrichSingleRepo(
          database,
          next.full_name,
          effectiveDelayMs,
          waitForTurn,
        );
        results.push(result);
        processed += 1;

        if (processed % 100 === 0 || processed === candidates.length) {
          console.log(
            `[enrich] ${processed}/${candidates.length} processed, ok=${results.filter((item) => item.ok).length}, failed=${results.filter((item) => !item.ok).length}`,
          );
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.max(1, effectiveConcurrency) }, () => worker()),
    );

    const summary = {
      completedAt: new Date().toISOString(),
      concurrency: effectiveConcurrency,
      days,
      delayMs: effectiveDelayMs,
      failed: results.filter((item) => !item.ok).length,
      limit: effectiveLimit,
      mode: hasToken ? "authenticated" : "unauthenticated",
      missingOnly,
      ratePerHour: effectiveRatePerHour,
      requested: candidates.length,
      scope,
      succeeded: results.filter((item) => item.ok).length,
    };

    setIngestionState(database, "repo_enrichment", summary);
    return summary;
  } finally {
    database.close();
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  enrichRepos({
    concurrency: Number(args.concurrency ?? 6),
    days: Number(args.days ?? 30),
    delayMs: Number(args.delay ?? 120),
    limit: Number(args.limit ?? 1500),
    missingOnly: args["missing-only"] === "true" || args["missing-only"] === "1",
    ratePerHour: Number(args["rate-per-hour"] ?? 4200),
    scope: args.scope ?? "recent",
  })
    .then((summary) => {
      console.log("Completed GitHub enrichment.");
      console.log(summary);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
