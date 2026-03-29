import {
  ensureSchema,
  fetchGitHubJson,
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

async function enrichSingleRepo(database, fullName, delayMs) {
  try {
    const repo = await fetchGitHubJson(`/repos/${fullName}`);
    updateRepoMetadata(database, repo);
    await sleep(delayMs);
    return { fullName, ok: true };
  } catch (error) {
    console.warn(`Failed to enrich ${fullName}`, error);
    await sleep(delayMs);
    return { fullName, ok: false };
  }
}

export async function enrichRepos({
  concurrency = 6,
  days = 30,
  delayMs = 120,
  limit = 1500,
} = {}) {
  loadLocalEnv();

  const database = openSkylineDatabase();
  ensureSchema(database);

  try {
    const candidates = selectCandidateRepos(database, { days, limit });
    const pending = [...candidates];
    const results = [];

    async function worker() {
      for (;;) {
        const next = pending.shift();

        if (!next) {
          return;
        }

        results.push(await enrichSingleRepo(database, next.full_name, delayMs));
      }
    }

    await Promise.all(
      Array.from({ length: Math.max(1, concurrency) }, () => worker()),
    );

    const summary = {
      completedAt: new Date().toISOString(),
      days,
      failed: results.filter((item) => !item.ok).length,
      limit,
      requested: candidates.length,
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
