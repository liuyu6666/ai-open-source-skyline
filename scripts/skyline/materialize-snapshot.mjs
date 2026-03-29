import {
  buildLocalizedDescriptions,
  clamp,
  classifyDomain,
  computeTowerHeight,
  createLotOffsets,
  daysSince,
  ensureSchema,
  hoursSince,
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  safeJsonParse,
  scoreRepo,
  setIngestionState,
  skylineDistricts,
  skylineGrid,
  upsertSnapshot,
  writeSnapshotFile,
} from "./shared.mjs";

const buildDistrictsForSnapshot = (repos) => {
  const counts = repos.reduce((result, repo) => {
    result[repo.domain] = (result[repo.domain] ?? 0) + 1;
    return result;
  }, {});

  return skylineDistricts.map((district) => {
    const count = counts[district.id] ?? 0;
    const columns = Math.max(
      4,
      Math.round(Math.sqrt((Math.max(count, 1) * district.size.width) / district.size.depth) * 0.94),
    );
    const rows = Math.max(3, Math.ceil(Math.max(count, 1) / columns));
    const avenueCount = Math.floor((columns - 1) / skylineGrid.avenueEvery);
    const streetCount = Math.floor((rows - 1) / skylineGrid.streetEvery);
    const requiredWidth =
      (columns - 1) * skylineGrid.pitchX +
      avenueCount * skylineGrid.avenueGap +
      skylineGrid.marginX * 2;
    const requiredDepth =
      (rows - 1) * skylineGrid.pitchZ +
      streetCount * skylineGrid.streetGap +
      skylineGrid.marginZ * 2;
    const width = Math.max(district.size.width, requiredWidth);
    const depth = Math.max(district.size.depth, requiredDepth);
    const expansionRatio = Math.max(width / district.size.width, depth / district.size.depth);
    const centerScale = expansionRatio > 1 ? 1 + (expansionRatio - 1) * 0.18 : 1;

    return {
      ...district,
      center: {
        x: Number((district.center.x * centerScale).toFixed(1)),
        z: district.center.z,
      },
      size: {
        width: Number(width.toFixed(1)),
        depth: Number(depth.toFixed(1)),
      },
    };
  });
};

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

function buildRepoRows(database, days) {
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
            SUM(CASE WHEN metric_date >= DATE(anchor.max_metric_date, '-6 days') THEN watch_events ELSE 0 END) AS star_delta_7d,
            SUM(CASE WHEN metric_date >= DATE(anchor.max_metric_date, '-29 days') THEN watch_events ELSE 0 END) AS star_delta_30d,
            SUM(CASE WHEN metric_date >= DATE(anchor.max_metric_date, '-6 days')
              THEN push_events + pull_request_events + issues_events + issue_comment_events + release_events + create_events
              ELSE 0 END) AS update_events_7d,
            SUM(CASE WHEN metric_date >= DATE(anchor.max_metric_date, '-29 days')
              THEN push_events + pull_request_events + issues_events + issue_comment_events + release_events + create_events
              ELSE 0 END) AS update_events_30d,
            SUM(CASE WHEN metric_date >= DATE(anchor.max_metric_date, '-29 days') THEN contributors ELSE 0 END) AS contributors_30d,
            MAX(CASE WHEN metric_date >= DATE(anchor.max_metric_date, '-29 days') AND created_repo = 1 THEN 1 ELSE 0 END) AS created_in_30d,
            MAX(metric_date) AS last_metric_date
          FROM skyline_repo_daily_metrics
          CROSS JOIN anchor
          WHERE metric_date >= DATE(
            anchor.max_metric_date,
            '-' || CAST($days - 1 AS TEXT) || ' days'
          )
          GROUP BY repo_full_name
        ),
        trend AS (
          SELECT
            repo_full_name,
            json_group_array(watch_events) AS trend_json
          FROM (
            SELECT
              repo_full_name,
              metric_date,
              watch_events
            FROM skyline_repo_daily_metrics
            CROSS JOIN anchor
            WHERE metric_date >= DATE(anchor.max_metric_date, '-6 days')
            ORDER BY repo_full_name ASC, metric_date ASC
          )
          GROUP BY repo_full_name
        )
        SELECT
          skyline_repos.full_name,
          skyline_repos.owner_login,
          skyline_repos.repo_name,
          skyline_repos.description,
          skyline_repos.language,
          skyline_repos.topics_json,
          skyline_repos.stargazers_count,
          skyline_repos.pushed_at,
          skyline_repos.created_at,
          skyline_repos.archived,
          skyline_repos.disabled,
          skyline_repos.is_fork,
          recent.star_delta_7d,
          recent.star_delta_30d,
          recent.update_events_7d,
          recent.update_events_30d,
          recent.contributors_30d,
          recent.created_in_30d,
          trend.trend_json
        FROM recent
        JOIN skyline_repos ON skyline_repos.full_name = recent.repo_full_name
        LEFT JOIN trend ON trend.repo_full_name = recent.repo_full_name
        WHERE skyline_repos.archived = 0
          AND skyline_repos.disabled = 0
          AND skyline_repos.is_fork = 0
      `,
    )
    .all({ days });
}

function passesThresholds(repo, settings) {
  return (
    repo.stargazers_count >= settings.minStars ||
    repo.star_delta_30d >= settings.minStarDelta30d ||
    (repo.update_events_30d >= settings.minUpdateEvents30d &&
      repo.stargazers_count >= settings.minUpdateRepoStars) ||
    (repo.created_in_30d === 1 && repo.stargazers_count >= settings.minNewRepoStars)
  );
}

function normalizeTrend(value) {
  const parsed = safeJsonParse(value ?? "[]", []);
  const trend = Array.isArray(parsed) ? parsed.map((item) => Number(item) || 0) : [];

  while (trend.length < 7) {
    trend.unshift(0);
  }

  return trend.slice(-7);
}

function toRepoRecord(row) {
  const topics = safeJsonParse(row.topics_json ?? "[]", []);
  const repo = {
    created_at: row.created_at,
    description: row.description ?? "",
    language: row.language ?? "",
    repo_name: row.repo_name,
    stargazers_count: Number(row.stargazers_count ?? 0),
    topics: Array.isArray(topics) ? topics : [],
  };
  const domain = classifyDomain(repo);
  const domainLabels = {
    agents: { zh: "应用", en: "apps" },
    tooling: { zh: "开发工具", en: "developer tooling" },
    automation: { zh: "自动化", en: "automation" },
    inference: { zh: "基础设施", en: "infrastructure" },
    memory: { zh: "数据", en: "data" },
  }[domain];
  const metrics = {
    contributors30d: Number(row.contributors_30d ?? 0),
    createdDaysAgo: daysSince(row.created_at),
    lastPushHoursAgo: hoursSince(row.pushed_at),
    starDelta30d: Number(row.star_delta_30d ?? 0),
    starDelta7d: Number(row.star_delta_7d ?? 0),
    totalStars: Number(row.stargazers_count ?? 0),
    updateEvents30d: Number(row.update_events_30d ?? 0),
    updateEvents7d: Number(row.update_events_7d ?? 0),
  };
  const score = scoreRepo(metrics);

  return {
    contributors30d: metrics.contributors30d,
    createdDaysAgo: metrics.createdDaysAgo,
    description: buildLocalizedDescriptions(repo, metrics, domainLabels),
    domain,
    fullName: row.full_name,
    id: row.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    lastPushHoursAgo: metrics.lastPushHoursAgo,
    name: row.repo_name,
    owner: row.owner_login,
    score,
    starDelta1d: normalizeTrend(row.trend_json).at(-1) ?? 0,
    starDelta30d: metrics.starDelta30d,
    starDelta7d: metrics.starDelta7d,
    totalStars: metrics.totalStars,
    trend: normalizeTrend(row.trend_json),
    updateEvents30d: metrics.updateEvents30d,
    updateEvents7d: metrics.updateEvents7d,
  };
}

function createLayout(repos, districts) {
  const districtIndex = new Map(districts.map((district) => [district.id, district]));
  const grouped = new Map();

  for (const repo of repos) {
    const bucket = grouped.get(repo.domain) ?? [];
    bucket.push(repo);
    grouped.set(repo.domain, bucket);
  }

  const positions = new Map();

  for (const [domain, items] of grouped) {
    const district = districtIndex.get(domain);

    if (!district) {
      continue;
    }

    const offsets = createLotOffsets(district, items.length);

    items.forEach((repo, index) => {
      const offset = offsets[index];
      positions.set(repo.id, {
        x: Number((district.center.x + offset.x).toFixed(1)),
        z: Number((district.center.z + offset.z).toFixed(1)),
      });
    });
  }

  const maxUpdates = Math.max(1, ...repos.map((repo) => repo.updateEvents7d));
  const maxStars = Math.max(1, ...repos.map((repo) => repo.totalStars));

  const positioned = repos.map((repo) => {
    const district = districtIndex.get(repo.domain);
    const position = positions.get(repo.id);

    if (!district || !position) {
      throw new Error(`Missing skyline layout for ${repo.fullName}`);
    }

    const width = clamp(8.9 + Math.log10(repo.totalStars + 10) * 2.2, 9.8, 20.4);
    const depth = clamp(8.4 + Math.sqrt(repo.updateEvents30d + 1) * 0.42, 9.4, 18.8);
    const height = computeTowerHeight(repo.totalStars, maxStars);

    return {
      ...repo,
      color: district.color,
      depth: Number(depth.toFixed(1)),
      height: Number(height.toFixed(1)),
      lightStrength: Number((repo.updateEvents7d / maxUpdates).toFixed(2)),
      lotDepth: Number((depth + 8.4).toFixed(1)),
      lotWidth: Number((width + 8.2).toFixed(1)),
      score: Number(repo.score.toFixed(1)),
      width: Number(width.toFixed(1)),
      x: position.x,
      z: position.z,
    };
  });

  for (let iteration = 0; iteration < 18; iteration += 1) {
    let moved = false;

    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
      const left = positioned[leftIndex];
      const leftDistrict = districtIndex.get(left.domain);

      if (!leftDistrict) {
        continue;
      }

      for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
        const right = positioned[rightIndex];
        const rightDistrict = districtIndex.get(right.domain);

        if (!rightDistrict) {
          continue;
        }

        const dx = right.x - left.x;
        const dz = right.z - left.z;
        const distance = Math.hypot(dx, dz) || 0.001;
        const minimumDistance = Math.max(
          (Math.max(left.lotWidth, left.lotDepth) + Math.max(right.lotWidth, right.lotDepth)) *
            0.5,
          15.5,
        );

        if (distance >= minimumDistance) {
          continue;
        }

        const push = (minimumDistance - distance) * 0.5;
        let normalX = dx / distance;
        let normalZ = dz / distance;

        if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) {
          const angle = (leftIndex * 0.73 + rightIndex * 0.41) % (Math.PI * 2);
          normalX = Math.cos(angle);
          normalZ = Math.sin(angle);
        }
        const leftPaddingX = leftDistrict.size.width * 0.42;
        const leftPaddingZ = leftDistrict.size.depth * 0.42;
        const rightPaddingX = rightDistrict.size.width * 0.42;
        const rightPaddingZ = rightDistrict.size.depth * 0.42;

        left.x = Number(
          clamp(
            left.x - normalX * push,
            leftDistrict.center.x - leftPaddingX,
            leftDistrict.center.x + leftPaddingX,
          ).toFixed(1),
        );
        left.z = Number(
          clamp(
            left.z - normalZ * push,
            leftDistrict.center.z - leftPaddingZ,
            leftDistrict.center.z + leftPaddingZ,
          ).toFixed(1),
        );
        right.x = Number(
          clamp(
            right.x + normalX * push,
            rightDistrict.center.x - rightPaddingX,
            rightDistrict.center.x + rightPaddingX,
          ).toFixed(1),
        );
        right.z = Number(
          clamp(
            right.z + normalZ * push,
            rightDistrict.center.z - rightPaddingZ,
            rightDistrict.center.z + rightPaddingZ,
          ).toFixed(1),
        );
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  return positioned;
}

export function materializeSnapshot({
  days = 30,
  limit = 420,
  minNewRepoStars = 30,
  minStarDelta30d = 20,
  minStars = 200,
  minUpdateEvents30d = 80,
  minUpdateRepoStars = 50,
} = {}) {
  loadLocalEnv();

  const database = openSkylineDatabase();
  ensureSchema(database);

  try {
    const rows = buildRepoRows(database, days);
    const selected = rows
      .filter((row) =>
        passesThresholds(row, {
          minNewRepoStars,
          minStarDelta30d,
          minStars,
          minUpdateRepoStars,
          minUpdateEvents30d,
        }),
      )
      .map(toRepoRecord)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
    const districts = buildDistrictsForSnapshot(selected);
    const repos = createLayout(selected, districts);
    const snapshot = {
      demoMode: false,
      districts,
      generatedAt: new Date().toISOString(),
      repos,
      stats: {
        newRepos24h: repos.filter((repo) => repo.createdDaysAgo <= 1).length,
        starsAdded7d: repos.reduce((sum, repo) => sum + repo.starDelta7d, 0),
        trackedRepos: repos.length,
        updates7d: repos.reduce((sum, repo) => sum + repo.updateEvents7d, 0),
      },
    };
    const meta = {
      catalogCandidates: rows.length,
      days,
      limit,
      minNewRepoStars,
      minStarDelta30d,
      minStars,
      minUpdateRepoStars,
      minUpdateEvents30d,
      snapshotPath: writeSnapshotFile(snapshot),
    };

    upsertSnapshot(database, "default", snapshot, meta);
    setIngestionState(database, "snapshot_materialization", {
      completedAt: snapshot.generatedAt,
      ...meta,
    });

    return { meta, snapshot };
  } finally {
    database.close();
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  try {
    const result = materializeSnapshot({
      days: Number(args.days ?? 30),
      limit: Number(args.limit ?? 420),
      minNewRepoStars: Number(args["min-new-repo-stars"] ?? 30),
      minStarDelta30d: Number(args["min-star-delta-30d"] ?? 20),
      minStars: Number(args["min-stars"] ?? 200),
      minUpdateEvents30d: Number(args["min-update-events-30d"] ?? 80),
      minUpdateRepoStars: Number(args["min-update-repo-stars"] ?? 50),
    });

    console.log("Materialized skyline snapshot.");
    console.log(result.meta);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
