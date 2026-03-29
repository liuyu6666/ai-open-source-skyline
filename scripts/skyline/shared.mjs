import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultDbPath = path.join(projectRoot, "data", "skyline.sqlite");
const defaultSnapshotPath = path.join(projectRoot, "data", "skyline-snapshot.json");
const schemaPath = path.join(projectRoot, "db", "schema.sql");

export const skylineDistricts = [
  {
    id: "agents",
    color: "#7dd3fc",
    center: { x: -42, z: -24 },
    size: { width: 112, depth: 86 },
  },
  {
    id: "tooling",
    color: "#f9a8d4",
    center: { x: 44, z: -16 },
    size: { width: 108, depth: 84 },
  },
  {
    id: "automation",
    color: "#c4b5fd",
    center: { x: 4, z: 14 },
    size: { width: 132, depth: 102 },
  },
  {
    id: "inference",
    color: "#fcd34d",
    center: { x: -34, z: 62 },
    size: { width: 104, depth: 82 },
  },
  {
    id: "memory",
    color: "#86efac",
    center: { x: 40, z: 66 },
    size: { width: 104, depth: 82 },
  },
];

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
  if (!process.argv[1]) {
    return false;
  }

  return meta.url === pathToFileURL(process.argv[1]).href;
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

export function openSkylineDatabase() {
  const databasePath = getDatabasePath();

  ensureDirectory(path.dirname(databasePath));

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA synchronous = NORMAL;");

  return database;
}

export function ensureSchema(database) {
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  database.exec(schemaSql);
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

  if (!token) {
    throw new Error("Missing GITHUB_TOKEN or GH_TOKEN for GitHub enrichment.");
  }

  return token;
}

export async function fetchGitHubJson(pathname) {
  const token = getGitHubToken();
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "github-skyline-radar",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${pathname}`);
  }

  return response.json();
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

  ensureDirectory(path.dirname(snapshotPath));
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

  return snapshotPath;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function hashValue(seed) {
  const value = Math.sin(seed) * 43758.5453123;
  return value - Math.floor(value);
}

export function createLotOffsets(district, count) {
  const offsets = [];
  const downtownCore = { x: 6, z: 14 };
  const driftX = (downtownCore.x - district.center.x) * 0.12;
  const driftZ = (downtownCore.z - district.center.z) * 0.12;
  const baseAngle = Math.atan2(
    district.center.z - downtownCore.z,
    district.center.x - downtownCore.x,
  );

  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      offsets.push({ x: 0, z: 0 });
      continue;
    }

    const ring = Math.ceil(Math.sqrt(index));
    const ringStart = (ring - 1) * (ring - 1) + 1;
    const slot = index - ringStart;
    const slotCount = Math.max(5, ring * 6);
    const seed = count * 31 + index * 17 + district.center.x * 0.4;
    const angle =
      baseAngle +
      (slot / slotCount) * Math.PI * 1.88 +
      (hashValue(seed) - 0.5) * 0.38;
    const radiusX = Math.min(
      district.size.width * 0.46,
      9 + ring * 7.2 + hashValue(seed + 5.1) * 3.6,
    );
    const radiusZ = Math.min(
      district.size.depth * 0.46,
      8 + ring * 6.8 + hashValue(seed + 9.7) * 3,
    );
    const spreadX =
      Math.cos(angle) * radiusX +
      driftX * ring +
      (hashValue(seed + 2.2) - 0.5) * 2.8;
    const spreadZ =
      Math.sin(angle) * radiusZ +
      driftZ * ring +
      (hashValue(seed + 6.4) - 0.5) * 2.5;

    offsets.push({
      x: Number(spreadX.toFixed(1)),
      z: Number(spreadZ.toFixed(1)),
    });
  }

  offsets.sort((left, right) => {
    const leftWeight = Math.hypot(left.x - driftX * 2, left.z - driftZ * 2);
    const rightWeight = Math.hypot(right.x - driftX * 2, right.z - driftZ * 2);
    return leftWeight - rightWeight;
  });

  return offsets.slice(0, count);
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
