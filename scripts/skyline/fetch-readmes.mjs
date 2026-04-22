import {
  chunk,
  cleanReadmeMarkdown,
  ensureSchema,
  fetchGitHubResponse,
  isMainModule,
  loadCurrentSnapshot,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
  sleep,
} from "./shared.mjs";

function listSnapshotRepoNames(snapshot, limit) {
  if (!snapshot || !Array.isArray(snapshot.repos)) {
    return [];
  }

  return [...new Set(snapshot.repos.map((repo) => repo.fullName).filter(Boolean))].slice(
    0,
    limit > 0 ? limit : Number.POSITIVE_INFINITY,
  );
}

function loadExistingReadmes(database, repoNames) {
  if (repoNames.length === 0) {
    return new Map();
  }

  const placeholders = repoNames.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
        SELECT
          repo_full_name,
          readme_sha,
          readme_etag,
          status
        FROM skyline_repo_readmes
        WHERE repo_full_name IN (${placeholders})
      `,
    )
    .all(...repoNames);

  return new Map(rows.map((row) => [row.repo_full_name, row]));
}

function decodeReadmeContent(content, encoding) {
  if (!content) {
    return "";
  }

  if (encoding === "base64") {
    return Buffer.from(String(content).replace(/\n/gu, ""), "base64").toString("utf8");
  }

  return String(content);
}

function upsertReadme(database, record) {
  database
    .prepare(
      `
        INSERT INTO skyline_repo_readmes (
          repo_full_name,
          readme_sha,
          readme_etag,
          source_url,
          raw_markdown,
          cleaned_markdown,
          fetched_at,
          last_attempt_at,
          status
        )
        VALUES (
          $repoFullName,
          $readmeSha,
          $readmeEtag,
          $sourceUrl,
          $rawMarkdown,
          $cleanedMarkdown,
          $fetchedAt,
          CURRENT_TIMESTAMP,
          $status
        )
        ON CONFLICT(repo_full_name) DO UPDATE SET
          readme_sha = excluded.readme_sha,
          readme_etag = excluded.readme_etag,
          source_url = excluded.source_url,
          raw_markdown = excluded.raw_markdown,
          cleaned_markdown = excluded.cleaned_markdown,
          fetched_at = excluded.fetched_at,
          last_attempt_at = CURRENT_TIMESTAMP,
          status = excluded.status
      `,
    )
    .run(record);
}

function markReadmeAttempt(database, repoFullName, { status }) {
  database
    .prepare(
      `
        INSERT INTO skyline_repo_readmes (
          repo_full_name,
          last_attempt_at,
          status,
          source_url,
          raw_markdown,
          cleaned_markdown,
          fetched_at,
          readme_sha,
          readme_etag
        )
        VALUES (
          $repoFullName,
          CURRENT_TIMESTAMP,
          $status,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL
        )
        ON CONFLICT(repo_full_name) DO UPDATE SET
          last_attempt_at = CURRENT_TIMESTAMP,
          status = excluded.status,
          source_url = skyline_repo_readmes.source_url,
          raw_markdown = CASE WHEN $status = 'missing' THEN NULL ELSE skyline_repo_readmes.raw_markdown END,
          cleaned_markdown = CASE WHEN $status = 'missing' THEN NULL ELSE skyline_repo_readmes.cleaned_markdown END,
          fetched_at = CASE WHEN $status = 'missing' THEN NULL ELSE skyline_repo_readmes.fetched_at END,
          readme_sha = CASE WHEN $status = 'missing' THEN NULL ELSE skyline_repo_readmes.readme_sha END,
          readme_etag = CASE WHEN $status = 'missing' THEN NULL ELSE skyline_repo_readmes.readme_etag END
      `,
    )
    .run({
      repoFullName,
      status,
    });
}

function touchReadmeAttempt(database, repoFullName) {
  database
    .prepare(
      `
        UPDATE skyline_repo_readmes
        SET last_attempt_at = CURRENT_TIMESTAMP
        WHERE repo_full_name = $repoFullName
      `,
    )
    .run({
      repoFullName,
    });
}

async function fetchRepoReadme(repoFullName, existing, force) {
  const headers = {};

  if (!force && existing?.readme_etag) {
    headers["If-None-Match"] = existing.readme_etag;
  }

  const response = await fetchGitHubResponse(`/repos/${repoFullName}/readme`, {
    headers,
  });

  if (response.status === 304) {
    return {
      status: "not-modified",
    };
  }

  if (response.status === 404) {
    return {
      status: "missing",
    };
  }

  if (!response.ok) {
    throw new Error(`GitHub README request failed: ${response.status}`);
  }

  const payload = await response.json();
  const rawMarkdown = decodeReadmeContent(payload.content, payload.encoding);
  const cleanedMarkdown = cleanReadmeMarkdown(rawMarkdown);
  const readmeSha = payload.sha ?? null;

  return {
    changed: force || existing?.readme_sha !== readmeSha,
    cleanedMarkdown,
    fetchedAt: new Date().toISOString(),
    rawMarkdown,
    readmeEtag: response.headers.get("etag"),
    readmeSha,
    sourceUrl: payload.html_url ?? payload.download_url ?? `https://github.com/${repoFullName}#readme`,
    status: "ok",
  };
}

export async function fetchReadmesForSnapshot({
  concurrency = 4,
  delayMs = 180,
  force = false,
  limit = Number.POSITIVE_INFINITY,
} = {}) {
  loadLocalEnv();

  const snapshot = loadCurrentSnapshot();
  const repoNames = listSnapshotRepoNames(snapshot, limit);

  if (repoNames.length === 0) {
    return {
      changed: 0,
      failed: 0,
      fetched: 0,
      missing: 0,
      requested: 0,
      unchanged: 0,
    };
  }

  const database = openSkylineDatabase();
  ensureSchema(database);

  try {
    const existing = loadExistingReadmes(database, repoNames);
    const summary = {
      changed: 0,
      failed: 0,
      fetched: 0,
      missing: 0,
      requested: repoNames.length,
      unchanged: 0,
    };

    for (const group of chunk(repoNames, Math.max(1, concurrency))) {
      await Promise.all(
        group.map(async (repoFullName) => {
          try {
            const result = await fetchRepoReadme(
              repoFullName,
              existing.get(repoFullName),
              force,
            );

            if (result.status === "not-modified") {
              touchReadmeAttempt(database, repoFullName);
              summary.unchanged += 1;
              return;
            }

            if (result.status === "missing") {
              markReadmeAttempt(database, repoFullName, {
                status: "missing",
              });
              summary.missing += 1;
              return;
            }

            upsertReadme(database, {
              cleanedMarkdown: result.cleanedMarkdown,
              fetchedAt: result.fetchedAt,
              rawMarkdown: result.rawMarkdown,
              readmeEtag: result.readmeEtag,
              readmeSha: result.readmeSha,
              repoFullName,
              sourceUrl: result.sourceUrl,
              status: "ok",
            });
            summary.fetched += 1;

            if (result.changed) {
              summary.changed += 1;
            } else {
              summary.unchanged += 1;
            }
          } catch {
            markReadmeAttempt(database, repoFullName, {
              status: "error",
            });
            summary.failed += 1;
          }
        }),
      );

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    return summary;
  } finally {
    database.close();
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  fetchReadmesForSnapshot({
    concurrency: Number(args.concurrency ?? 4),
    delayMs: Number(args.delay ?? 180),
    force: args.force === "true" || args.force === "1",
    limit:
      args.limit == null ? Number.POSITIVE_INFINITY : Number(args.limit),
  })
    .then((summary) => {
      console.log("Fetched snapshot README records.");
      console.log(summary);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
