import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import skylineLayoutConfig from "../../config/skyline-layout.json" with { type: "json" };

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultDbPath = path.join(projectRoot, "data", "skyline.sqlite");
const defaultSnapshotPath = path.join(projectRoot, "data", "skyline-snapshot.json");
const schemaPath = path.join(projectRoot, "db", "schema.sql");

export const skylineDistricts = skylineLayoutConfig.districts;
export const skylineGrid = skylineLayoutConfig.grid;
export const skylineScene = skylineLayoutConfig.scene;
export const skylineTower = skylineLayoutConfig.tower;

const envFiles = [".env.local", ".env"];

export function loadLocalEnv() {
  for (const name of envFiles) {
    const filePath = path.join(projectRoot, name);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");

      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
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

    const key = body.slice(0, separatorIndex);
    const value = body.slice(separatorIndex + 1);
    parsed[key] = value;
  }

  return parsed;
}

export function isMainModule(meta) {
  const candidates = [
    process.argv[1],
    process.env.pm_exec_path,
    process.env.PM_EXEC_PATH,
  ].filter(Boolean);

  return candidates.some((candidatePath) => {
    try {
      return meta.url === pathToFileURL(path.resolve(candidatePath)).href;
    } catch {
      return false;
    }
  });
}

export function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

export function getDatabasePath() {
  return process.env.SKYLINE_DB_PATH?.trim() || defaultDbPath;
}

export function getSnapshotPath() {
  return process.env.SKYLINE_SNAPSHOT_PATH?.trim() || defaultSnapshotPath;
}

function ensureTableColumn(database, tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    return true;
  }

  return false;
}

function hasTable(database, tableName) {
  const row = database
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = $tableName
      `,
    )
    .get({
      tableName,
    });

  return Boolean(row?.name);
}

function backfillRepoEnrichmentState(database) {
  database.exec(`
    UPDATE skyline_repos
    SET metadata_fetched = CASE
      WHEN metadata_fetched = 1 THEN 1
      WHEN last_enriched_at IS NOT NULL
        AND (
          repo_id IS NOT NULL
          OR html_url IS NOT NULL
          OR updated_at IS NOT NULL
          OR pushed_at IS NOT NULL
          OR created_at IS NOT NULL
          OR default_branch IS NOT NULL
          OR description IS NOT NULL
          OR language IS NOT NULL
        )
      THEN 1
      ELSE 0
    END
  `);

  database.exec(`
    UPDATE skyline_repos
    SET
      enrichment_attempts = CASE
        WHEN enrichment_attempts > 0 THEN enrichment_attempts
        WHEN last_enriched_at IS NOT NULL THEN 1
        ELSE 0
      END,
      last_enrichment_success_at = COALESCE(
        last_enrichment_success_at,
        CASE WHEN metadata_fetched = 1 THEN last_enriched_at ELSE NULL END
      ),
      enrichment_status = CASE
        WHEN metadata_fetched = 1 THEN 'ok'
        WHEN last_enriched_at IS NULL THEN 'pending'
        WHEN enrichment_status IN ('missing', 'invalid') THEN enrichment_status
        ELSE 'error'
      END
  `);
}

export function loadCurrentSnapshot() {
  const snapshotPath = getSnapshotPath();

  if (!fs.existsSync(snapshotPath)) {
    return null;
  }

  try {
    const contents = fs.readFileSync(snapshotPath, "utf8");
    const parsed = JSON.parse(contents);

    if (!parsed || !Array.isArray(parsed.repos) || !Array.isArray(parsed.districts)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn("Failed to load materialized skyline snapshot", error);
    return null;
  }
}

export function openSkylineDatabase() {
  const databasePath = getDatabasePath();

  ensureDirectory(path.dirname(databasePath));

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA synchronous = NORMAL;");

  return database;
}

export function ensureSchema(database) {
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  const hasRepoTable = hasTable(database, "skyline_repos");
  let needsRepoEnrichmentBackfill = false;

  if (hasRepoTable) {
    needsRepoEnrichmentBackfill =
      ensureTableColumn(database, "skyline_repos", "metadata_fetched", "INTEGER NOT NULL DEFAULT 0") ||
      needsRepoEnrichmentBackfill;
    needsRepoEnrichmentBackfill =
      ensureTableColumn(
        database,
        "skyline_repos",
        "enrichment_status",
        "TEXT NOT NULL DEFAULT 'pending'",
      ) || needsRepoEnrichmentBackfill;
    needsRepoEnrichmentBackfill =
      ensureTableColumn(
        database,
        "skyline_repos",
        "enrichment_attempts",
        "INTEGER NOT NULL DEFAULT 0",
      ) || needsRepoEnrichmentBackfill;
    needsRepoEnrichmentBackfill =
      ensureTableColumn(database, "skyline_repos", "last_enrichment_success_at", "TEXT") ||
      needsRepoEnrichmentBackfill;
    needsRepoEnrichmentBackfill =
      ensureTableColumn(database, "skyline_repos", "last_enrichment_error", "TEXT") ||
      needsRepoEnrichmentBackfill;
  }

  database.exec(schemaSql);

  if (needsRepoEnrichmentBackfill) {
    backfillRepoEnrichmentState(database);
  }
}

export function computeTowerHeight(totalStars, maxStars) {
  if (maxStars <= 0) {
    return skylineTower.minHeight;
  }

  return Math.max(
    skylineTower.minHeight,
    (Math.max(totalStars, 0) / maxStars) * skylineTower.maxHeight,
  );
}

export function withTransaction(database, fn) {
  database.exec("BEGIN IMMEDIATE;");

  try {
    const result = fn();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

export function dayStartUtc(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function buildTrailingUtcDates(days, endDateString) {
  const dates = [];
  const endDate = endDateString
    ? dayStartUtc(new Date(`${endDateString}T00:00:00.000Z`))
    : dayStartUtc(new Date(Date.now() - 24 * 60 * 60 * 1000));

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(endDate);
    date.setUTCDate(endDate.getUTCDate() - offset);
    dates.push(date);
  }

  return dates;
}

export function ghArchiveUrl(metricDate, hour) {
  return `https://data.gharchive.org/${metricDate}-${hour}.json.gz`;
}

export async function streamGhArchiveLines(metricDate, hour, onLine) {
  const response = await fetch(ghArchiveUrl(metricDate, hour));

  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to fetch GH Archive ${metricDate}-${hour}: ${response.status}`,
    );
  }

  const gzip = Readable.fromWeb(response.body);
  const gunzip = gzip.pipe(await import("node:zlib").then((module) => module.createGunzip()));
  const readline = await import("node:readline");
  const lineReader = readline.createInterface({
    crlfDelay: Infinity,
    input: gunzip,
  });

  for await (const line of lineReader) {
    if (line) {
      onLine(line);
    }
  }
}

export function getGitHubToken() {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();

  return token || null;
}

export function getDeepSeekApiKey() {
  const apiKey =
    process.env.DEEPSEEK_API_KEY?.trim() || process.env.DEEPSEEK_TOKEN?.trim();

  return apiKey || null;
}

export function buildGitHubHeaders(extraHeaders = {}) {
  const token = getGitHubToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-skyline-radar",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extraHeaders,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

export async function fetchGitHubResponse(pathname, options = {}) {
  return fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: buildGitHubHeaders(options.headers),
  });
}

export async function fetchGitHubJson(pathname, options = {}) {
  const response = await fetchGitHubResponse(pathname, options);

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${pathname}`);
  }

  return response.json();
}

export async function fetchGitHubGraphqlJson(query, variables = {}) {
  const token = getGitHubToken();

  if (!token) {
    throw new Error("GitHub GraphQL requests require GITHUB_TOKEN or GH_TOKEN.");
  }

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: buildGitHubHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const rawBody = await response.text();
  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error(
      `GitHub GraphQL response was not JSON: ${response.status} ${rawBody.slice(0, 160)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `GitHub GraphQL request failed: ${response.status} ${payload?.message ?? ""}`.trim(),
    );
  }

  return payload;
}

export async function fetchDeepSeekChatCompletion({
  maxTokens = 900,
  messages,
  model = "deepseek-chat",
  temperature = 0.2,
} = {}) {
  const apiKey = getDeepSeekApiKey();

  if (!apiKey) {
    throw new Error("DeepSeek requests require DEEPSEEK_API_KEY.");
  }

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      max_tokens: maxTokens,
      messages,
      model,
      response_format: {
        type: "json_object",
      },
      temperature,
    }),
  });

  const rawBody = await response.text();
  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error(
      `DeepSeek response was not JSON: ${response.status} ${rawBody.slice(0, 240)}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `DeepSeek request failed: ${response.status} ${payload?.error?.message ?? payload?.message ?? ""}`.trim(),
    );
  }

  return payload;
}

export function setIngestionState(database, stateKey, stateValue) {
  database
    .prepare(
      `
        INSERT INTO skyline_ingestion_state (
          state_key,
          state_value,
          updated_at
        )
        VALUES ($stateKey, $stateValue, CURRENT_TIMESTAMP)
        ON CONFLICT(state_key) DO UPDATE SET
          state_value = excluded.state_value,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .run({
      stateKey,
      stateValue: JSON.stringify(stateValue),
    });
}

export function getIngestionState(database, stateKey) {
  const row = database
    .prepare(
      `
        SELECT
          state_value,
          updated_at
        FROM skyline_ingestion_state
        WHERE state_key = $stateKey
      `,
    )
    .get({
      stateKey,
    });

  if (!row) {
    return null;
  }

  return {
    updatedAt: row.updated_at,
    value: safeJsonParse(row.state_value, null),
  };
}

export function parseSqliteTimestamp(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalized = value.includes("T")
    ? value
    : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function minutesSinceTimestamp(value, now = Date.now()) {
  const parsed = value instanceof Date ? value : parseSqliteTimestamp(value);

  if (!parsed) {
    return Number.POSITIVE_INFINITY;
  }

  return (now - parsed.getTime()) / 60_000;
}

export function upsertSnapshot(database, snapshotName, snapshot, meta) {
  database
    .prepare(
      `
        INSERT INTO skyline_snapshots (
          snapshot_name,
          generated_at,
          snapshot_json,
          meta_json
        )
        VALUES ($snapshotName, $generatedAt, $snapshotJson, $metaJson)
        ON CONFLICT(snapshot_name) DO UPDATE SET
          generated_at = excluded.generated_at,
          snapshot_json = excluded.snapshot_json,
          meta_json = excluded.meta_json
      `,
    )
    .run({
      snapshotName,
      generatedAt: snapshot.generatedAt,
      snapshotJson: JSON.stringify(snapshot),
      metaJson: JSON.stringify(meta),
    });
}

export function writeSnapshotFile(snapshot) {
  const snapshotPath = getSnapshotPath();
  const temporaryPath = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;
  const contents = JSON.stringify(snapshot, null, 2);

  ensureDirectory(path.dirname(snapshotPath));
  fs.writeFileSync(temporaryPath, contents, "utf8");
  fs.renameSync(temporaryPath, snapshotPath);

  return snapshotPath;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const readmeSectionBlocklist = [
  "acknowledgement",
  "acknowledgments",
  "acknowledgement",
  "changelog",
  "code of conduct",
  "community",
  "contributing",
  "contributors",
  "credits",
  "faq",
  "license",
  "roadmap",
  "security",
  "sponsor",
  "support",
  "table of contents",
  "toc",
];

function normalizeHeadingText(value) {
  return value
    .toLowerCase()
    .replace(/[`*_~>#:[\]().,!/\\|-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function cleanReadmeMarkdown(markdown, { maxChars = 40_000 } = {}) {
  if (!markdown) {
    return "";
  }

  const normalized = markdown
    .replace(/\r\n/gu, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/gu, "")
    .replace(/<!--[\s\S]*?-->/gu, "");
  const lines = normalized.split("\n");
  const kept = [];
  let skipHeadingLevel = null;
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^(```|~~~)/u.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/u);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = normalizeHeadingText(headingMatch[2]);

      if (skipHeadingLevel !== null && level <= skipHeadingLevel) {
        skipHeadingLevel = null;
      }

      if (
        readmeSectionBlocklist.some((keyword) => headingText.includes(keyword))
      ) {
        skipHeadingLevel = level;
        continue;
      }
    }

    if (skipHeadingLevel !== null) {
      continue;
    }

    if (
      !trimmed ||
      /^!\[[^\]]*\]\([^)]*\)$/u.test(trimmed) ||
      /^\[[^\]]*\]\([^)]*\)\s*$/u.test(trimmed) ||
      /\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/u.test(trimmed) ||
      trimmed.includes("shields.io") ||
      /^<img\b/iu.test(trimmed) ||
      /^<picture\b/iu.test(trimmed) ||
      /^<source\b/iu.test(trimmed)
    ) {
      kept.push("");
      continue;
    }

    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, maxChars);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function hashValue(seed) {
  const value = Math.sin(seed) * 43758.5453123;
  return value - Math.floor(value);
}

function unwrapAngleToRange(angle, start, end) {
  const tau = Math.PI * 2;
  let next = angle;

  while (next < start) {
    next += tau;
  }

  while (next > end) {
    next -= tau;
  }

  if (next < start) {
    return start;
  }

  if (next > end) {
    return end;
  }

  return next;
}

function createSectorLotOffsets(district, count) {
  const baseAngleStart = Number(district.angleStart ?? 0);
  const baseAngleEnd = Number(district.angleEnd ?? baseAngleStart + Math.PI * 2);
  const baseAngleSpan = Math.max(0.24, baseAngleEnd - baseAngleStart);
  const angleOverflow = Math.min(baseAngleSpan * 0.025, 0.03);
  const angleStart = baseAngleStart - angleOverflow;
  const angleEnd = baseAngleEnd + angleOverflow;
  const angleSpan = Math.max(0.24, angleEnd - angleStart);
  const usableInner = Math.max(0.8, Number(district.innerRadius ?? 0) + 0.45);
  const usableOuter = Math.max(usableInner + 18, Number(district.outerRadius ?? usableInner + 80) - 2.2);
  const sectorArea = 0.5 * angleSpan * (usableOuter ** 2 - usableInner ** 2);
  const idealSpacing = clamp(Math.sqrt(sectorArea / Math.max(count, 1)) * 1.06, 15.5, 39);
  const radialStep = Math.max(12.8, idealSpacing * 0.97);
  const radialBands = Math.max(5, Math.ceil((usableOuter - usableInner) / radialStep) + 1);
  const slots = [];

  for (let band = 0; band < radialBands; band += 1) {
    const bandRatio = (band + 0.5) / radialBands;
    const radius = usableInner + (usableOuter - usableInner) * bandRatio;
    const arcLength = radius * angleSpan;
    const slotsInBand = Math.max(4, Math.ceil(arcLength / idealSpacing));

    for (let slot = 0; slot < slotsInBand; slot += 1) {
      const angleRatio = (slot + 0.5) / slotsInBand;
      const seed = count * 17 + band * 9.1 + slot * 3.7 + (district.angleStart ?? 0) * 5.3;
      const angleJitter = (hashValue(seed + 0.8) - 0.5) * Math.min(angleSpan / slotsInBand, 0.045) * 0.22;
      const radiusJitter = (hashValue(seed + 2.6) - 0.5) * Math.min(radialStep * 0.14, 1.2);
      const angle = angleStart + angleRatio * angleSpan + angleJitter;
      const finalRadius = clamp(radius + radiusJitter, usableInner, usableOuter);
      const x = Math.cos(angle) * finalRadius;
      const z = Math.sin(angle) * finalRadius;
      const angleBias = Math.abs(angleRatio - 0.5) * 0.18;
      const radiusBias = Math.pow(bandRatio, 1.35) * 1.08;

      slots.push({
        desirability: angleBias + radiusBias,
        x: Number(x.toFixed(1)),
        z: Number(z.toFixed(1)),
      });
    }
  }

  return slots
    .sort((left, right) => left.desirability - right.desirability)
    .slice(0, count)
    .map(({ x, z }) => ({ x, z }));
}

export function createLotOffsets(district, count) {
  if (typeof district.angleStart === "number" && typeof district.angleEnd === "number") {
    return createSectorLotOffsets(district, count);
  }

  const columns = Math.max(
    4,
    Math.round(Math.sqrt((count * district.size.width) / district.size.depth) * 0.94),
  );
  const rows = Math.max(3, Math.ceil(count / columns));
  const avenueEvery = skylineGrid.avenueEvery;
  const streetEvery = skylineGrid.streetEvery;
  const avenueGap = skylineGrid.avenueGap;
  const streetGap = skylineGrid.streetGap;
  const avenueCount = Math.floor((columns - 1) / avenueEvery);
  const streetCount = Math.floor((rows - 1) / streetEvery);
  const widthBudget = district.size.width - skylineGrid.marginX * 2 - avenueCount * avenueGap;
  const depthBudget = district.size.depth - skylineGrid.marginZ * 2 - streetCount * streetGap;
  const stepX = columns > 1 ? widthBudget / (columns - 1) : 0;
  const stepZ = rows > 1 ? depthBudget / (rows - 1) : 0;
  const xPositions = [];
  const zPositions = [];
  let cursorX = 0;
  let cursorZ = 0;

  for (let column = 0; column < columns; column += 1) {
    xPositions.push(cursorX);
    cursorX += stepX;

    if ((column + 1) % avenueEvery === 0 && column < columns - 1) {
      cursorX += avenueGap;
    }
  }

  for (let row = 0; row < rows; row += 1) {
    zPositions.push(cursorZ);
    cursorZ += stepZ;

    if ((row + 1) % streetEvery === 0 && row < rows - 1) {
      cursorZ += streetGap;
    }
  }

  const xMidpoint = (xPositions[0] + xPositions.at(-1)) / 2;
  const zMidpoint = (zPositions[0] + zPositions.at(-1)) / 2;
  const coreColumn = (columns - 1) / 2;
  const coreRow = Math.max(1, (rows - 1) * 0.42);
  const slots = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const slotIndex = row * columns + column;
      const seed = count * 19 + slotIndex * 7.3 + district.center.x * 0.17;
      const jitterX = (hashValue(seed + 0.9) - 0.5) * Math.min(stepX * 0.07, 1.1);
      const jitterZ = (hashValue(seed + 2.3) - 0.5) * Math.min(stepZ * 0.07, 1.1);
      const centeredX = xPositions[column] - xMidpoint + jitterX;
      const centeredZ = zPositions[row] - zMidpoint + jitterZ;
      const avenueBias =
        Math.abs((column % avenueEvery) - (avenueEvery - 1) / 2) < 0.65 ? -0.2 : 0;
      const desirability =
        Math.hypot((column - coreColumn) * 1.08, (row - coreRow) * 0.92) + avenueBias;

      slots.push({
        desirability,
        x: Number(centeredX.toFixed(1)),
        z: Number(centeredZ.toFixed(1)),
      });
    }
  }

  return slots
    .sort((left, right) => left.desirability - right.desirability)
    .slice(0, count)
    .map(({ x, z }) => ({ x, z }));
}

export function clampPointToDistrict(point, district, lotWidth = 0, lotDepth = 0) {
  if (typeof district.angleStart === "number" && typeof district.angleEnd === "number") {
    const baseAngleStart = Number(district.angleStart);
    const baseAngleEnd = Number(district.angleEnd);
    const angleOverflow = Math.min((baseAngleEnd - baseAngleStart) * 0.025, 0.03);
    const angleStart = baseAngleStart - angleOverflow;
    const angleEnd = baseAngleEnd + angleOverflow;
    const footprintRadius = Math.max(lotWidth, lotDepth, 0) * 0.58;
    const radius = Math.hypot(point.x, point.z);
    const safeRadius = Math.max(radius, Number(district.innerRadius ?? 0) + footprintRadius + 1.1);
    const anglePadding = Math.min(
      (angleEnd - angleStart) * 0.035,
      Math.asin(clamp(footprintRadius / Math.max(safeRadius, 1), 0, 0.92)) * 0.26,
    );
    const minRadius = Number(district.innerRadius ?? 0) + footprintRadius + 1.1;
    const maxRadius = Math.max(
      minRadius + 8,
      Number(district.outerRadius ?? safeRadius + 80) - footprintRadius - 1.4,
    );
    const clampedAngle = clamp(
      unwrapAngleToRange(Math.atan2(point.z, point.x), angleStart, angleEnd),
      angleStart + anglePadding,
      angleEnd - anglePadding,
    );
    const clampedRadius = clamp(radius, minRadius, maxRadius);

    return {
      x: Number((Math.cos(clampedAngle) * clampedRadius).toFixed(1)),
      z: Number((Math.sin(clampedAngle) * clampedRadius).toFixed(1)),
    };
  }

  const paddingX = district.size.width * 0.46;
  const paddingZ = district.size.depth * 0.46;

  return {
    x: Number(clamp(point.x, district.center.x - paddingX, district.center.x + paddingX).toFixed(1)),
    z: Number(clamp(point.z, district.center.z - paddingZ, district.center.z + paddingZ).toFixed(1)),
  };
}

export function daysSince(isoString) {
  if (!isoString) {
    return 9999;
  }

  return Math.max(
    0,
    Math.floor((Date.now() - new Date(isoString).getTime()) / (24 * 60 * 60 * 1000)),
  );
}

export function hoursSince(isoString) {
  if (!isoString) {
    return 9999;
  }

  return Math.max(
    0,
    Math.floor((Date.now() - new Date(isoString).getTime()) / (60 * 60 * 1000)),
  );
}

export function scoreRepo(metrics) {
  const starBase = Math.log10(metrics.totalStars + 1) * 12;
  const monthlyVelocity = Math.log10(metrics.starDelta30d + 1) * 14;
  const weeklyVelocity = Math.log10(metrics.starDelta7d + 1) * 10;
  const updateSignal = Math.sqrt(metrics.updateEvents7d) * 2.4;
  const contributorSignal = Math.sqrt(metrics.contributors30d) * 3.2;
  const newbornBoost =
    metrics.createdDaysAgo <= 1
      ? 18
      : metrics.createdDaysAgo <= 7
        ? 12
        : metrics.createdDaysAgo <= 30
          ? 6
          : 0;

  return (
    starBase + monthlyVelocity + weeklyVelocity + updateSignal + contributorSignal + newbornBoost
  );
}

export function classifyDomain(repo) {
  const searchable = [
    repo.repo_name,
    repo.description,
    repo.language,
    ...(repo.topics ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const includesAny = (keywords) => keywords.some((keyword) => searchable.includes(keyword));

  if (
    includesAny([
      "workflow",
      "automation",
      "crawler",
      "scraper",
      "browser",
      "playwright",
      "puppeteer",
      "selenium",
      "robot",
      "task",
    ])
  ) {
    return "automation";
  }

  if (
    includesAny([
      "cli",
      "sdk",
      "plugin",
      "extension",
      "editor",
      "compiler",
      "linter",
      "test",
      "framework",
      "library",
      "developer",
      "devtool",
    ])
  ) {
    return "tooling";
  }

  if (
    includesAny([
      "database",
      "storage",
      "cache",
      "search",
      "analytics",
      "warehouse",
      "vector",
      "redis",
      "postgres",
      "mysql",
      "mongodb",
      "data",
    ])
  ) {
    return "memory";
  }

  if (
    includesAny([
      "server",
      "runtime",
      "proxy",
      "gateway",
      "kubernetes",
      "docker",
      "cloud",
      "infra",
      "observability",
      "service",
      "deploy",
    ])
  ) {
    return "inference";
  }

  return "agents";
}

export function buildLocalizedDescriptions(repo, metrics, domainLabels) {
  return {
    zh: `${repo.repo_name} 当前约 ${repo.stargazers_count.toLocaleString(
      "zh-CN",
    )} star，最近 30 天记录到 ${metrics.starDelta30d.toLocaleString(
      "zh-CN",
    )} 次 star 事件与 ${metrics.updateEvents30d.toLocaleString(
      "zh-CN",
    )} 次公开更新，属于 ${domainLabels.zh} 区。`,
    en: `${repo.repo_name} currently has about ${repo.stargazers_count.toLocaleString(
      "en-US",
    )} stars, plus ${metrics.starDelta30d.toLocaleString(
      "en-US",
    )} watch events and ${metrics.updateEvents30d.toLocaleString(
      "en-US",
    )} public update events over the last 30 days, placing it in the ${domainLabels.en} district.`,
  };
}

export function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
