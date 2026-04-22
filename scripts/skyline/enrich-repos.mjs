import {
  chunk,
  ensureSchema,
  fetchGitHubGraphqlJson,
  fetchGitHubJson,
  getGitHubToken,
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
  setIngestionState,
  sleep,
} from "./shared.mjs";
import { getRecentMetricsState, refreshRecentMetrics } from "./recent-metrics.mjs";

function selectCandidateRepos(database, { limit }) {
  return database
    .prepare(
      `
        SELECT
          skyline_repos.full_name AS full_name,
          skyline_repos.last_enriched_at AS last_enriched_at,
          skyline_repos.stargazers_count AS stargazers_count,
          skyline_repo_recent_metrics.star_delta_30d AS stars_30d,
          skyline_repo_recent_metrics.events_30d AS events_30d
        FROM skyline_repo_recent_metrics
        JOIN skyline_repos ON skyline_repos.full_name = skyline_repo_recent_metrics.repo_full_name
        WHERE skyline_repos.archived = 0
          AND skyline_repos.disabled = 0
          AND skyline_repos.is_fork = 0
        ORDER BY
          COALESCE(skyline_repos.stargazers_count, 0) DESC,
          COALESCE(skyline_repo_recent_metrics.star_delta_30d, 0) DESC,
          COALESCE(skyline_repo_recent_metrics.events_30d, 0) DESC
        LIMIT $limit
      `,
    )
    .all({
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
          enrichment_status,
          metadata_fetched,
          stargazers_count,
          last_seen_at
        FROM skyline_repos
        WHERE archived = 0
          AND disabled = 0
          AND is_fork = 0
          AND (
            $missingOnly = 0
            OR (
              metadata_fetched = 0
              AND COALESCE(enrichment_status, 'pending') IN ('pending', 'error')
            )
          )
        ORDER BY
          CASE COALESCE(enrichment_status, 'pending')
            WHEN 'pending' THEN 0
            WHEN 'error' THEN 1
            ELSE 2
          END ASC,
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
          metadata_fetched = 1,
          enrichment_status = 'ok',
          enrichment_attempts = COALESCE(enrichment_attempts, 0) + 1,
          last_enriched_at = CURRENT_TIMESTAMP,
          last_enrichment_success_at = CURRENT_TIMESTAMP,
          last_enrichment_error = NULL,
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

function normalizeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message.slice(0, 600);
  }

  if (typeof error === "string") {
    return error.slice(0, 600);
  }

  return "Unknown enrich failure";
}

function classifyEnrichmentFailure(error) {
  const message = normalizeErrorMessage(error);

  if (
    /\b404\b/u.test(message) ||
    /not returned from GraphQL batch/iu.test(message) ||
    /Could not resolve to a Repository/iu.test(message)
  ) {
    return {
      error: message,
      status: "missing",
    };
  }

  if (/invalid repo full name/iu.test(message)) {
    return {
      error: message,
      status: "invalid",
    };
  }

  return {
    error: message,
    status: "error",
  };
}

function markRepoEnrichmentAttempt(database, fullName, { error, status = "error" } = {}) {
  const errorMessage = error ? normalizeErrorMessage(error) : null;

  database
    .prepare(
      `
        UPDATE skyline_repos
        SET
          enrichment_status = $status,
          enrichment_attempts = COALESCE(enrichment_attempts, 0) + 1,
          last_enriched_at = CURRENT_TIMESTAMP,
          last_enrichment_error = $errorMessage,
          last_seen_at = CURRENT_TIMESTAMP
        WHERE full_name = $fullName
      `,
    )
    .run({
      errorMessage,
      fullName,
      status,
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

function buildRepoGraphqlBatch(fullNames) {
  const variables = {};
  const aliases = [];
  const definitions = [];

  const fields = fullNames
    .map((fullName, index) => {
      const [owner, name] = fullName.split("/");

      if (!owner || !name) {
        return null;
      }

      const ownerKey = `owner${index}`;
      const nameKey = `name${index}`;
      const alias = `repo${index}`;

      aliases.push({
        alias,
        fullName,
      });
      definitions.push(`$${ownerKey}: String!, $${nameKey}: String!`);
      variables[ownerKey] = owner;
      variables[nameKey] = name;

      return `
        ${alias}: repository(owner: $${ownerKey}, name: $${nameKey}) {
          databaseId
          nameWithOwner
          description
          primaryLanguage {
            name
          }
          repositoryTopics(first: 20) {
            nodes {
              topic {
                name
              }
            }
          }
          url
          homepageUrl
          defaultBranchRef {
            name
          }
          stargazerCount
          forkCount
          watchers {
            totalCount
          }
          issues(states: OPEN) {
            totalCount
          }
          diskUsage
          createdAt
          pushedAt
          updatedAt
          isArchived
          isDisabled
          isFork
        }
      `;
    })
    .filter(Boolean)
    .join("\n");

  return {
    aliases,
    query: `
      query EnrichRepoBatch(${definitions.join(", ")}) {
        rateLimit {
          cost
          remaining
          resetAt
        }
        ${fields}
      }
    `,
    variables,
  };
}

function normalizeGraphqlRepo(repository) {
  return {
    archived: repository.isArchived ?? false,
    created_at: repository.createdAt ?? null,
    default_branch: repository.defaultBranchRef?.name ?? null,
    description: repository.description ?? null,
    disabled: repository.isDisabled ?? false,
    forks_count: repository.forkCount ?? 0,
    fork: repository.isFork ?? false,
    full_name: repository.nameWithOwner,
    homepage: repository.homepageUrl ?? null,
    html_url: repository.url,
    id: repository.databaseId ?? null,
    language: repository.primaryLanguage?.name ?? null,
    open_issues_count: repository.issues?.totalCount ?? 0,
    pushed_at: repository.pushedAt ?? null,
    size: repository.diskUsage ?? 0,
    stargazers_count: repository.stargazerCount ?? 0,
    topics:
      repository.repositoryTopics?.nodes
        ?.map((node) => node?.topic?.name)
        .filter(Boolean) ?? [],
    updated_at: repository.updatedAt ?? null,
    watchers_count: repository.watchers?.totalCount ?? 0,
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
    markRepoEnrichmentAttempt(database, fullName, classifyEnrichmentFailure(error));
    await sleep(delayMs);
    return { fullName, ok: false };
  }
}

async function enrichRepoBatch(database, fullNames, delayMs, waitForTurn, retryLimit = 2) {
  const invalidNames = fullNames.filter((fullName) => !fullName.includes("/"));
  const validNames = fullNames.filter((fullName) => fullName.includes("/"));
  const results = invalidNames.map((fullName) => ({
    fullName,
    ok: false,
  }));

  for (const fullName of invalidNames) {
    markRepoEnrichmentAttempt(database, fullName, {
      error: "Invalid repo full name.",
      status: "invalid",
    });
  }

  if (validNames.length === 0) {
    return {
      cost: 0,
      remaining: null,
      results,
    };
  }

  let lastError = null;

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      await waitForTurn();

      const { aliases, query, variables } = buildRepoGraphqlBatch(validNames);
      const payload = await fetchGitHubGraphqlJson(query, variables);
      const errorByAlias = new Map();

      for (const error of payload.errors ?? []) {
        const alias = error?.path?.[0];

        if (typeof alias === "string") {
          errorByAlias.set(alias, error);
        }
      }

      for (const entry of aliases) {
        const repository = payload.data?.[entry.alias];

        if (repository) {
          updateRepoMetadata(database, normalizeGraphqlRepo(repository));
          results.push({
            fullName: entry.fullName,
            ok: true,
          });
          continue;
        }

        const error = errorByAlias.get(entry.alias);
        const failure = classifyEnrichmentFailure(
          error
            ? new Error(error.message)
            : new Error("Repository not returned from GraphQL batch."),
        );

        console.warn(
          `Failed to enrich ${entry.fullName}`,
          error
            ? new Error(error.message)
            : new Error("Repository not returned from GraphQL batch."),
        );
        markRepoEnrichmentAttempt(database, entry.fullName, failure);
        results.push({
          fullName: entry.fullName,
          ok: false,
        });
      }

      await sleep(delayMs);

      return {
        cost: payload.data?.rateLimit?.cost ?? 1,
        remaining: payload.data?.rateLimit?.remaining ?? null,
        results,
      };
    } catch (error) {
      lastError = error;

      if (attempt < retryLimit) {
        const retryDelayMs = Math.max(4_000, delayMs * 10 * (attempt + 1));
        console.warn(
          `Retrying GraphQL batch of ${validNames.length} repos after transient failure (attempt ${attempt + 1}/${retryLimit + 1})`,
          error,
        );
        await sleep(retryDelayMs);
        continue;
      }
    }
  }

  console.warn(`Failed to enrich GraphQL batch of ${validNames.length} repos`, lastError);

  for (const fullName of validNames) {
    markRepoEnrichmentAttempt(
      database,
      fullName,
      classifyEnrichmentFailure(lastError ?? new Error("GraphQL batch failed.")),
    );
    results.push({
      fullName,
      ok: false,
    });
  }

  await sleep(delayMs);

  return {
    cost: 1,
    remaining: null,
    results,
  };
}

export async function enrichRepos({
  concurrency = 6,
  days = 30,
  delayMs = 120,
  limit = 1500,
  missingOnly = false,
  queryBatchSize = 20,
  ratePerHour = 4200,
  scope = "recent",
  transport = "auto",
} = {}) {
  loadLocalEnv();

  const hasToken = Boolean(getGitHubToken());
  const effectiveTransport =
    transport === "auto" ? (hasToken ? "graphql" : "rest") : transport;
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

    let recentMetricsSummary = null;

    if (scope === "recent") {
      recentMetricsSummary = refreshRecentMetrics(database, {
        days,
        maxAgeMinutes: 90,
      });
    }

    const candidates =
      scope === "recent"
        ? selectCandidateRepos(database, {
            limit: effectiveLimit,
          })
        : selectCatalogRepos(database, {
            limit: effectiveLimit,
            missingOnly,
          });
    const pending =
      effectiveTransport === "graphql"
        ? chunk(candidates, Math.max(1, queryBatchSize))
        : [...candidates];
    const results = [];
    const waitForTurn = createRateLimiter(effectiveRatePerHour);
    let processed = 0;
    let totalCost = 0;
    let remainingPoints = null;

    async function worker() {
      for (;;) {
        const next = pending.shift();

        if (!next) {
          return;
        }

        if (effectiveTransport === "graphql") {
          const batchSummary = await enrichRepoBatch(
            database,
            next.map((item) => item.full_name),
            effectiveDelayMs,
            waitForTurn,
          );

          totalCost += batchSummary.cost ?? 0;
          remainingPoints = batchSummary.remaining ?? remainingPoints;
          results.push(...batchSummary.results);
          processed += batchSummary.results.length;
        } else {
          const result = await enrichSingleRepo(
            database,
            next.full_name,
            effectiveDelayMs,
            waitForTurn,
          );
          results.push(result);
          processed += 1;
        }

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
      queryBatchSize: effectiveTransport === "graphql" ? Math.max(1, queryBatchSize) : 1,
      ratePerHour: effectiveRatePerHour,
      remainingPoints,
      requested: candidates.length,
      recentMetricsAnchorDate: recentMetricsSummary?.anchorMetricDate ?? getRecentMetricsState(database)?.value?.anchorMetricDate ?? null,
      recentMetricsUpdatedAt: getRecentMetricsState(database)?.updatedAt ?? null,
      scope,
      succeeded: results.filter((item) => item.ok).length,
      totalCost,
      transport: effectiveTransport,
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
    queryBatchSize: Number(args["query-batch-size"] ?? 20),
    ratePerHour: Number(args["rate-per-hour"] ?? 4200),
    scope: args.scope ?? "recent",
    transport: args.transport ?? "auto",
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
