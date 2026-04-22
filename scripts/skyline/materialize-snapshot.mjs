import {
  buildLocalizedDescriptions,
  clamp,
  clampPointToDistrict,
  classifyDomain,
  computeTowerHeight,
  createLotOffsets,
  daysSince,
  ensureSchema,
  hoursSince,
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
  safeJsonParse,
  scoreRepo,
  setIngestionState,
  skylineDistricts,
  upsertSnapshot,
  writeSnapshotFile,
} from "./shared.mjs";
import { getRecentMetricsState, refreshRecentMetrics } from "./recent-metrics.mjs";

const getTowerFootprint = (repo) => {
  const width = clamp(8.9 + Math.log10(repo.totalStars + 10) * 2.2, 9.8, 20.4);
  const depth = clamp(8.4 + Math.sqrt(repo.updateEvents30d + 1) * 0.42, 9.4, 18.8);

  return {
    depth: Number(depth.toFixed(1)),
    lotDepth: Number((depth + 8.4).toFixed(1)),
    lotWidth: Number((width + 8.2).toFixed(1)),
    width: Number(width.toFixed(1)),
  };
};

const tau = Math.PI * 2;
const sectorPhase = -Math.PI * 0.5;

const measureSectorBounds = (angleStart, angleEnd, innerRadius, outerRadius) => {
  const samples = [angleStart, angleEnd];

  for (const axisAngle of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5, tau]) {
    let next = axisAngle;

    while (next < angleStart) {
      next += tau;
    }

    while (next > angleEnd) {
      next -= tau;
    }

    if (next >= angleStart && next <= angleEnd) {
      samples.push(next);
    }
  }

  const points = [];

  for (const angle of samples) {
    points.push(
      { x: Math.cos(angle) * innerRadius, z: Math.sin(angle) * innerRadius },
      { x: Math.cos(angle) * outerRadius, z: Math.sin(angle) * outerRadius },
    );
  }

  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);

  return {
    depth: Number((Math.max(...zs) - Math.min(...zs)).toFixed(1)),
    width: Number((Math.max(...xs) - Math.min(...xs)).toFixed(1)),
  };
};

const buildDistrictPie = (repos, cityRadius) => {
  const totalCount = Math.max(1, repos.length);
  const countsByDomain = repos.reduce((counts, repo) => {
    counts.set(repo.domain, (counts.get(repo.domain) ?? 0) + 1);
    return counts;
  }, new Map());
  const labelRadius = Number((cityRadius * 0.58).toFixed(1));
  const outerRadius = Number(cityRadius.toFixed(1));
  const innerRadius = 2;
  let angleCursor = sectorPhase;

  return skylineDistricts.map((district, index) => {
    const count = countsByDomain.get(district.id) ?? 0;
    const ratio = count / totalCount;
    const angleSpan =
      index === skylineDistricts.length - 1
        ? sectorPhase + tau - angleCursor
        : tau * ratio;
    const angleStart = angleCursor;
    const angleEnd = angleCursor + angleSpan;
    const midAngle = angleStart + angleSpan * 0.5;
    angleCursor = angleEnd;
    const bounds = measureSectorBounds(angleStart, angleEnd, innerRadius, outerRadius);

    return {
      ...district,
      angleEnd: Number(angleEnd.toFixed(6)),
      angleStart: Number(angleStart.toFixed(6)),
      center: {
        x: Number((Math.cos(midAngle) * labelRadius).toFixed(1)),
        z: Number((Math.sin(midAngle) * labelRadius).toFixed(1)),
      },
      innerRadius,
      labelRadius,
      outerRadius,
      size: bounds,
    };
  });
};

function buildRepoRows(database, { enrichedOnly, minStarDelta7d, minStars }) {
  return database
    .prepare(
      `
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
          skyline_repos.last_enriched_at,
          skyline_repos.metadata_fetched,
          skyline_repos.enrichment_status,
          skyline_repos.last_seen_at,
          skyline_repos.archived,
          skyline_repos.disabled,
          skyline_repos.is_fork,
          skyline_repo_recent_metrics.star_delta_7d,
          skyline_repo_recent_metrics.star_delta_30d,
          skyline_repo_recent_metrics.update_events_7d,
          skyline_repo_recent_metrics.update_events_30d,
          skyline_repo_recent_metrics.contributors_30d,
          skyline_repo_recent_metrics.created_in_30d,
          skyline_repo_recent_metrics.trend_json,
          skyline_repo_summaries.summary_json
        FROM skyline_repo_recent_metrics
        JOIN skyline_repos ON skyline_repos.full_name = skyline_repo_recent_metrics.repo_full_name
        LEFT JOIN skyline_repo_summaries
          ON skyline_repo_summaries.repo_full_name = skyline_repos.full_name
          AND skyline_repo_summaries.status = 'ok'
        WHERE skyline_repos.archived = 0
          AND skyline_repos.disabled = 0
          AND skyline_repos.is_fork = 0
          AND ($enrichedOnly = 0 OR (skyline_repos.metadata_fetched = 1 AND skyline_repos.enrichment_status = 'ok'))
          AND (
            COALESCE(skyline_repos.stargazers_count, 0) > $minStars
            OR COALESCE(skyline_repo_recent_metrics.star_delta_7d, 0) > $minStarDelta7d
          )
      `,
    )
    .all({
      enrichedOnly: enrichedOnly ? 1 : 0,
      minStarDelta7d,
      minStars,
    });
}

function isEnrichedRow(row) {
  return Number(row.metadata_fetched ?? 0) === 1 && row.enrichment_status === "ok";
}

function passesThresholds(repo, settings) {
  return (
    repo.stargazers_count > settings.minStars ||
    repo.star_delta_7d > settings.minStarDelta7d
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

function normalizeText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function normalizeLocalizedText(value, fallback) {
  const next = typeof value === "object" && value !== null ? value : {};

  return {
    en: normalizeText(next.en ?? fallback.en, 600),
    zh: normalizeText(next.zh ?? fallback.zh, 320),
  };
}

function normalizeLocalizedList(value) {
  const next = typeof value === "object" && value !== null ? value : {};
  const normalizeList = (items, maxLength) =>
    Array.isArray(items)
      ? items
          .map((item) => normalizeText(item, maxLength))
          .filter(Boolean)
          .slice(0, 5)
      : [];

  return {
    en: normalizeList(next.en, 140),
    zh: normalizeList(next.zh, 80),
  };
}

function normalizeSummary(value, fallbackDescription) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    capabilities: normalizeLocalizedList(value.capabilities),
    confidence: Number.isFinite(Number(value.confidence))
      ? Number(value.confidence)
      : 0.72,
    keywords: Array.isArray(value.keywords)
      ? value.keywords
          .map((item) => normalizeText(item, 42))
          .filter(Boolean)
          .slice(0, 6)
      : [],
    summary: normalizeLocalizedText(value.summary, fallbackDescription),
    tagline: normalizeLocalizedText(value.tagline, fallbackDescription),
    useCases: normalizeLocalizedList(value.use_cases ?? value.useCases),
  };
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
  const fallbackDescription = buildLocalizedDescriptions(repo, metrics, domainLabels);
  const summary = normalizeSummary(
    safeJsonParse(row.summary_json ?? "null", null),
    fallbackDescription,
  );

  return {
    contributors30d: metrics.contributors30d,
    createdDaysAgo: metrics.createdDaysAgo,
    description: fallbackDescription,
    domain,
    fullName: row.full_name,
    id: row.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    keywords: summary?.keywords,
    lastPushHoursAgo: metrics.lastPushHoursAgo,
    name: row.repo_name,
    owner: row.owner_login,
    capabilities: summary?.capabilities,
    score,
    starDelta1d: normalizeTrend(row.trend_json).at(-1) ?? 0,
    starDelta30d: metrics.starDelta30d,
    starDelta7d: metrics.starDelta7d,
    summary: summary?.summary,
    summaryConfidence: summary?.confidence,
    tagline: summary?.tagline,
    totalStars: metrics.totalStars,
    trend: normalizeTrend(row.trend_json),
    updateEvents30d: metrics.updateEvents30d,
    updateEvents7d: metrics.updateEvents7d,
    useCases: summary?.useCases,
  };
}

function computeLightStrength(repo, maxStarDelta7d) {
  if (maxStarDelta7d <= 0) {
    return 0.12;
  }

  return Number(
    clamp(Math.log1p(repo.starDelta7d) / Math.log1p(maxStarDelta7d), 0.12, 1).toFixed(2),
  );
}

function computeHotPriority(repo) {
  const pushFreshnessBoost =
    repo.lastPushHoursAgo <= 6 ? 12 : repo.lastPushHoursAgo <= 24 ? 8 : repo.lastPushHoursAgo <= 72 ? 4 : 0;
  const newbornBoost =
    repo.createdDaysAgo <= 3 ? 14 : repo.createdDaysAgo <= 7 ? 10 : repo.createdDaysAgo <= 30 ? 4 : 0;

  return (
    Math.log1p(repo.starDelta7d) * 32 +
    Math.log1p(repo.starDelta30d) * 12 +
    Math.sqrt(repo.updateEvents7d) * 1.8 +
    Math.log10(repo.totalStars + 1) * 5 +
    pushFreshnessBoost +
    newbornBoost
  );
}

function computeEvergreenPriority(repo) {
  return (
    Math.log10(repo.totalStars + 1) * 22 +
    Math.log1p(repo.starDelta30d) * 10 +
    Math.sqrt(repo.updateEvents30d) * 1.4 +
    Math.sqrt(repo.updateEvents7d) * 1.2
  );
}

function computeSnapshotPriority(repo, settings) {
  let priority = Math.max(computeHotPriority(repo), computeEvergreenPriority(repo));

  if (repo.totalStars <= settings.minStars && repo.starDelta7d <= settings.minStarDelta7d) {
    priority -= 28;
  }

  if (repo.totalStars <= settings.hotMinStars && repo.starDelta7d <= settings.hotMinStarDelta7d) {
    priority -= 14;
  }

  return priority;
}

const allowedLotOverlapRatio = 0.1;
const centerPriorityWeight = 24;

function getPositionShiftRatios(left, right) {
  const leftPriority = left.totalStars + left.starDelta7d * centerPriorityWeight;
  const rightPriority = right.totalStars + right.starDelta7d * centerPriorityWeight;

  if (leftPriority >= rightPriority) {
    return { leftMoveRatio: 0.34, rightMoveRatio: 0.66 };
  }

  return { leftMoveRatio: 0.66, rightMoveRatio: 0.34 };
}

function getLotOverlap(left, right) {
  const leftMinX = left.x - left.lotWidth * 0.5;
  const leftMaxX = left.x + left.lotWidth * 0.5;
  const rightMinX = right.x - right.lotWidth * 0.5;
  const rightMaxX = right.x + right.lotWidth * 0.5;
  const leftMinZ = left.z - left.lotDepth * 0.5;
  const leftMaxZ = left.z + left.lotDepth * 0.5;
  const rightMinZ = right.z - right.lotDepth * 0.5;
  const rightMaxZ = right.z + right.lotDepth * 0.5;
  const overlapX = Math.min(leftMaxX, rightMaxX) - Math.max(leftMinX, rightMinX);
  const overlapZ = Math.min(leftMaxZ, rightMaxZ) - Math.max(leftMinZ, rightMinZ);

  if (overlapX <= 0 || overlapZ <= 0) {
    return null;
  }

  const overlapArea = overlapX * overlapZ;
  const minArea = Math.min(left.lotWidth * left.lotDepth, right.lotWidth * right.lotDepth);
  const allowedArea = minArea * allowedLotOverlapRatio;

  if (overlapArea <= allowedArea) {
    return null;
  }

  return {
    overlapX,
    overlapZ,
    pushX: Math.min(overlapX, (overlapArea - allowedArea) / Math.max(overlapZ, 0.001) + 0.22),
    pushZ: Math.min(overlapZ, (overlapArea - allowedArea) / Math.max(overlapX, 0.001) + 0.22),
  };
}

function pushUnique(target, items, limit, seenIds) {
  for (const item of items) {
    if (target.length >= limit) {
      break;
    }

    if (seenIds.has(item.id)) {
      continue;
    }

    seenIds.add(item.id);
    target.push(item);
  }
}

function selectSnapshotRepos(rows, settings) {
  const enrichedFullNames = new Set(
    rows.filter((row) => isEnrichedRow(row)).map((row) => row.full_name),
  );
  const candidates = rows.filter((row) => passesThresholds(row, settings)).map(toRepoRecord);
  const enrichedCandidates = candidates.filter((repo) => enrichedFullNames.has(repo.fullName));
  const hotCandidates = enrichedCandidates
    .filter(
      (repo) =>
        repo.starDelta7d > settings.hotMinStarDelta7d &&
        (
          repo.updateEvents7d >= settings.hotMinUpdateEvents7d ||
          repo.createdDaysAgo <= settings.hotMaxCreatedDays ||
          repo.lastPushHoursAgo <= settings.hotPushHours
        ),
    )
    .sort((left, right) => computeHotPriority(right) - computeHotPriority(left));
  const hotIds = new Set(hotCandidates.map((repo) => repo.id));
  const evergreenCandidates = enrichedCandidates
    .filter((repo) => repo.totalStars > settings.evergreenMinStars)
    .sort((left, right) => computeEvergreenPriority(right) - computeEvergreenPriority(left));
  const evergreenIds = new Set(evergreenCandidates.map((repo) => repo.id));
  const remainderCandidates = enrichedCandidates
    .filter(
      (repo) =>
        repo.totalStars > settings.minStars &&
        !hotIds.has(repo.id) &&
        !evergreenIds.has(repo.id),
    )
    .sort((left, right) => right.score - left.score);
  const breakoutCandidates = enrichedCandidates
    .filter(
      (repo) =>
        repo.totalStars <= settings.minStars &&
        repo.starDelta7d > settings.minStarDelta7d &&
        !hotIds.has(repo.id) &&
        !evergreenIds.has(repo.id),
    )
    .sort((left, right) => computeHotPriority(right) - computeHotPriority(left));
  const fallbackCandidates = candidates
    .filter((repo) => !enrichedFullNames.has(repo.fullName))
    .sort((left, right) => right.score - left.score);
  const selected = [];
  const seenIds = new Set();
  const hotTarget = Math.min(settings.limit, Math.max(settings.minHotRepos, Math.round(settings.limit * settings.hotRatio)));

  pushUnique(selected, hotCandidates, hotTarget, seenIds);
  pushUnique(selected, evergreenCandidates, settings.limit, seenIds);
  pushUnique(selected, remainderCandidates, settings.limit, seenIds);
  pushUnique(selected, breakoutCandidates, settings.limit, seenIds);
  pushUnique(selected, fallbackCandidates, settings.limit, seenIds);

  return {
    candidates,
    enrichedCandidates,
    selected: selected
      .slice(0, settings.limit)
      .sort(
        (left, right) =>
          computeSnapshotPriority(right, settings) - computeSnapshotPriority(left, settings),
      ),
  };
}

function createLayout(repos) {
  const footprintIndex = new Map(repos.map((repo) => [repo.id, getTowerFootprint(repo)]));
  const totalLotArea = repos.reduce((sum, repo) => {
    const footprint = footprintIndex.get(repo.id);
    return sum + (footprint ? footprint.lotWidth * footprint.lotDepth : 0);
  }, 0);
  const cityRadius = Number((Math.max(236, Math.sqrt((totalLotArea * 1.58) / Math.PI) + 30)).toFixed(1));
  const districts = buildDistrictPie(repos, cityRadius);
  const districtIndex = new Map(districts.map((district) => [district.id, district]));
  const grouped = new Map();
  const positions = new Map();

  for (const repo of repos) {
    const bucket = grouped.get(repo.domain) ?? [];
    bucket.push(repo);
    grouped.set(repo.domain, bucket);
  }

  for (const [domain, items] of grouped) {
    const district = districtIndex.get(domain);

    if (!district) {
      continue;
    }

    const sortedItems = [...items].sort(
      (left, right) =>
        right.totalStars - left.totalStars ||
        right.starDelta7d - left.starDelta7d ||
        right.score - left.score,
    );
    const offsets = createLotOffsets(district, sortedItems.length);

    sortedItems.forEach((repo, index) => {
      const offset = offsets[index];

      if (!offset) {
        return;
      }

      positions.set(repo.id, {
        x: Number(offset.x.toFixed(1)),
        z: Number(offset.z.toFixed(1)),
      });
    });
  }

  const maxStarDelta7d = Math.max(1, ...repos.map((repo) => repo.starDelta7d));
  const maxStars = Math.max(1, ...repos.map((repo) => repo.totalStars));

  const positioned = repos.map((repo) => {
    const position = positions.get(repo.id);
    const district = skylineDistricts.find((item) => item.id === repo.domain);
    const footprint = footprintIndex.get(repo.id);

    if (!district || !position || !footprint) {
      throw new Error(`Missing skyline layout for ${repo.fullName}`);
    }
    const height = computeTowerHeight(repo.totalStars, maxStars);

    return {
      ...repo,
      color: district.color,
      depth: footprint.depth,
      height: Number(height.toFixed(1)),
      lightStrength: computeLightStrength(repo, maxStarDelta7d),
      lotDepth: footprint.lotDepth,
      lotWidth: footprint.lotWidth,
      score: Number(repo.score.toFixed(1)),
      width: footprint.width,
      x: position.x,
      z: position.z,
    };
  });

  for (let iteration = 0; iteration < 48; iteration += 1) {
    let moved = false;

    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
      const left = positioned[leftIndex];

      for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
        const right = positioned[rightIndex];
        const dx = right.x - left.x;
        const dz = right.z - left.z;
        const overlap = getLotOverlap(left, right);

        if (!overlap) {
          continue;
        }

        const useXAxis = overlap.pushX <= overlap.pushZ;
        const leftDistrict = districtIndex.get(left.domain);
        const rightDistrict = districtIndex.get(right.domain);

        if (!leftDistrict || !rightDistrict) {
          continue;
        }
        const directionX =
          Math.abs(dx) < 0.001
            ? Math.sign(Math.cos((leftIndex * 0.73 + rightIndex * 0.41) % (Math.PI * 2))) || 1
            : Math.sign(dx);
        const directionZ =
          Math.abs(dz) < 0.001
            ? Math.sign(Math.sin((leftIndex * 0.73 + rightIndex * 0.41) % (Math.PI * 2))) || 1
            : Math.sign(dz);
        const { leftMoveRatio, rightMoveRatio } = getPositionShiftRatios(left, right);

        if (useXAxis) {
          const shift = overlap.pushX;
          const nextLeft = clampPointToDistrict(
            { x: left.x - directionX * shift * leftMoveRatio, z: left.z },
            leftDistrict,
            left.lotWidth,
            left.lotDepth,
          );
          const nextRight = clampPointToDistrict(
            { x: right.x + directionX * shift * rightMoveRatio, z: right.z },
            rightDistrict,
            right.lotWidth,
            right.lotDepth,
          );

          left.x = nextLeft.x;
          left.z = nextLeft.z;
          right.x = nextRight.x;
          right.z = nextRight.z;
        } else {
          const shift = overlap.pushZ;
          const nextLeft = clampPointToDistrict(
            { x: left.x, z: left.z - directionZ * shift * leftMoveRatio },
            leftDistrict,
            left.lotWidth,
            left.lotDepth,
          );
          const nextRight = clampPointToDistrict(
            { x: right.x, z: right.z + directionZ * shift * rightMoveRatio },
            rightDistrict,
            right.lotWidth,
            right.lotDepth,
          );

          left.x = nextLeft.x;
          left.z = nextLeft.z;
          right.x = nextRight.x;
          right.z = nextRight.z;
        }
        moved = true;
      }
    }

    if (!moved) {
      break;
    }
  }

  return {
    districts,
    repos: positioned,
  };
}

export function materializeSnapshot({
  days = 30,
  enrichedOnly = true,
  limit = 420,
  hotMaxCreatedDays = 30,
  hotMinStars = 5000,
  hotMinStarDelta7d = 100,
  hotMinUpdateEvents7d = 6,
  hotPushHours = 72,
  hotRatio = 0.68,
  evergreenMinStars = 5000,
  minHotRepos = 180,
  minNewRepoStars = 30,
  minStarDelta7d = 100,
  minStars = 5000,
  minUpdateEvents30d = 80,
  minUpdateRepoStars = 50,
} = {}) {
  loadLocalEnv();

  const database = openSkylineDatabase();
  ensureSchema(database);

  try {
    const recentMetricsSummary = refreshRecentMetrics(database, {
      days,
      maxAgeMinutes: 90,
    });
    const rows = buildRepoRows(database, {
      enrichedOnly,
      minStarDelta7d,
      minStars,
    });
    const selection = selectSnapshotRepos(rows, {
      evergreenMinStars,
      hotMaxCreatedDays,
      hotMinStars,
      hotMinStarDelta7d,
      hotMinUpdateEvents7d,
      hotPushHours,
      hotRatio,
      limit,
      minHotRepos,
      minNewRepoStars,
      minStarDelta7d,
      minStars,
      minUpdateRepoStars,
      minUpdateEvents30d,
    });
    const selected = selection.selected;
    const { districts, repos } = createLayout(selected);
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
      evergreenMinStars,
      enrichedOnly,
      enrichedCandidates: selection.enrichedCandidates.length,
      hotMaxCreatedDays,
      hotMinStars,
      hotMinStarDelta7d,
      hotMinUpdateEvents7d,
      hotPushHours,
      hotRatio,
      limit,
      minHotRepos,
      minNewRepoStars,
      recentMetricsAnchorDate:
        recentMetricsSummary?.anchorMetricDate ??
        getRecentMetricsState(database)?.value?.anchorMetricDate ??
        null,
      recentMetricsUpdatedAt: getRecentMetricsState(database)?.updatedAt ?? null,
      minStarDelta7d,
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
      enrichedOnly:
        args["enriched-only"] == null
          ? true
          : args["enriched-only"] === "true" || args["enriched-only"] === "1",
      limit: Number(args.limit ?? 420),
      minNewRepoStars: Number(args["min-new-repo-stars"] ?? 30),
      minStarDelta7d: Number(args["min-star-delta-7d"] ?? 100),
      minStars: Number(args["min-stars"] ?? 5000),
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
