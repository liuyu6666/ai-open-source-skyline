import { fetchReadmesForSnapshot } from "./fetch-readmes.mjs";
import {
  ensureSchema,
  getDeepSeekApiKey,
  isMainModule,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
  setIngestionState,
  sleep,
} from "./shared.mjs";
import { summarizeReadmesForSnapshot } from "./summarize-readmes.mjs";

async function writeSummarySyncState(statePayload) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const database = openSkylineDatabase();

    try {
      ensureSchema(database);
      setIngestionState(database, "readme_summary_sync", statePayload);
      return true;
    } catch (error) {
      lastError = error;
    } finally {
      database.close();
    }

    await sleep(750 * attempt);
  }

  console.error("[summary-sync] failed to write state", lastError);
  return false;
}

export async function syncSnapshotReadmeSummaries({
  fetchConcurrency = 4,
  fetchDelayMs = 180,
  force = false,
  limit = Number.POSITIVE_INFINITY,
  model = "deepseek-chat",
  summarizeConcurrency = 2,
  summarizeDelayMs = 260,
} = {}) {
  loadLocalEnv();

  const startedAt = new Date().toISOString();
  let statePayload = {
    completedAt: null,
    limit,
    model,
    readmes: null,
    startedAt,
    status: "running",
    summaries: null,
  };

  await writeSummarySyncState(statePayload);

  try {
    if (!getDeepSeekApiKey()) {
      statePayload = {
        completedAt: new Date().toISOString(),
        limit,
        model,
        startedAt,
        status: "skipped",
        readmes: {
          changed: 0,
          failed: 0,
          fetched: 0,
          missing: 0,
          requested: 0,
          unchanged: 0,
        },
        summaries: {
          eligible: 0,
          failed: 0,
          requested: 0,
          skipped: "missing_api_key",
          succeeded: 0,
        },
      };

      return statePayload;
    }

    const readmes = await fetchReadmesForSnapshot({
      concurrency: fetchConcurrency,
      delayMs: fetchDelayMs,
      force,
      limit,
    });
    const summaries = await summarizeReadmesForSnapshot({
      concurrency: summarizeConcurrency,
      delayMs: summarizeDelayMs,
      force,
      limit,
      model,
    });

    statePayload = {
      completedAt: new Date().toISOString(),
      limit,
      model,
      readmes,
      startedAt,
      status: "ok",
      summaries,
    };

    return statePayload;
  } catch (error) {
    statePayload = {
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message.slice(0, 600) : String(error).slice(0, 600),
      limit,
      model,
      readmes: null,
      startedAt,
      summaries: null,
      status: "error",
    };
    throw error;
  } finally {
    await writeSummarySyncState(statePayload);
  }
}

if (isMainModule(import.meta)) {
  const args = parseArgs();

  syncSnapshotReadmeSummaries({
    fetchConcurrency: Number(args["fetch-concurrency"] ?? 4),
    fetchDelayMs: Number(args["fetch-delay"] ?? 180),
    force: args.force === "true" || args.force === "1",
    limit:
      args.limit == null ? Number.POSITIVE_INFINITY : Number(args.limit),
    model: args.model ?? "deepseek-chat",
    summarizeConcurrency: Number(args["summarize-concurrency"] ?? 2),
    summarizeDelayMs: Number(args["summarize-delay"] ?? 260),
  })
    .then((summary) => {
      console.log("Synced snapshot README summaries.");
      console.log(summary);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
