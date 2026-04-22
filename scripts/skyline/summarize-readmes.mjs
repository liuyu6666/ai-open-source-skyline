import {
  chunk,
  ensureSchema,
  fetchDeepSeekChatCompletion,
  getDeepSeekApiKey,
  isMainModule,
  loadCurrentSnapshot,
  loadLocalEnv,
  openSkylineDatabase,
  parseArgs,
  safeJsonParse,
  sleep,
} from "./shared.mjs";

const summaryVersion = "v4-accurate-clear-agent-term";

function normalizeChineseTechnicalTerms(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/AI编码代理/gu, "AI coding agent")
    .replace(/编码代理/gu, "coding agent")
    .replace(/AI代理/gu, "AI agent")
    .replace(/子代理/gu, "subagent")
    .replace(/内置代理/gu, "内置agent")
    .replace(/通用代理/gu, "通用agent")
    .replace(/多代理/gu, "多agent")
    .replace(/代理框架/gu, "agent框架")
    .replace(/代理平台/gu, "agent平台")
    .replace(/代理运行时/gu, "agent运行时")
    .replace(/代理工作流/gu, "agent工作流")
    .replace(/代理编排/gu, "agent编排")
    .replace(/代理工具/gu, "agent工具")
    .replace(/代理系统/gu, "agent系统")
    .replace(/代理引擎/gu, "agent引擎");
}

function listSnapshotRepoNames(snapshot, limit) {
  if (!snapshot || !Array.isArray(snapshot.repos)) {
    return [];
  }

  return [...new Set(snapshot.repos.map((repo) => repo.fullName).filter(Boolean))].slice(
    0,
    limit > 0 ? limit : Number.POSITIVE_INFINITY,
  );
}

function loadSummaryTargets(database, repoNames) {
  if (repoNames.length === 0) {
    return [];
  }

  const placeholders = repoNames.map(() => "?").join(", ");

  return database
    .prepare(
      `
        SELECT
          skyline_repo_readmes.repo_full_name,
          skyline_repo_readmes.readme_sha,
          skyline_repo_readmes.cleaned_markdown,
          skyline_repo_readmes.source_url,
          skyline_repos.repo_name,
          skyline_repos.owner_login,
          skyline_repos.description,
          skyline_repos.language,
          skyline_repos.topics_json,
          skyline_repo_summaries.readme_sha AS summary_readme_sha,
          skyline_repo_summaries.summary_version AS summary_version,
          skyline_repo_summaries.status AS summary_status
        FROM skyline_repo_readmes
        JOIN skyline_repos ON skyline_repos.full_name = skyline_repo_readmes.repo_full_name
        LEFT JOIN skyline_repo_summaries
          ON skyline_repo_summaries.repo_full_name = skyline_repo_readmes.repo_full_name
        WHERE skyline_repo_readmes.repo_full_name IN (${placeholders})
          AND skyline_repo_readmes.status = 'ok'
          AND LENGTH(COALESCE(skyline_repo_readmes.cleaned_markdown, '')) > 0
      `,
    )
    .all(...repoNames);
}

function normalizeString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\s+/gu, " ")
    .replace(/\b(first-class|best-in-class|powerful|seamless|amazing)\b/giu, "")
    .replace(/\b(you|your)\b/giu, "")
    .replace(/[，。]?\s*(您|你的|您的)\s*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeStringArray(value, maxItems = 5, maxLength = 120) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeLocalizedText(value, fallback = "") {
  const next = typeof value === "object" && value !== null ? value : {};

  return {
    en: normalizeString(next.en ?? fallback, 600),
    zh: normalizeChineseTechnicalTerms(normalizeString(next.zh ?? fallback, 320)),
  };
}

function normalizeLocalizedList(value) {
  const next = typeof value === "object" && value !== null ? value : {};

  return {
    en: normalizeStringArray(next.en, 5, 140),
    zh: normalizeStringArray(next.zh, 5, 80).map((item) => normalizeChineseTechnicalTerms(item)),
  };
}

function normalizeSummaryPayload(raw, fallbackDescription = "") {
  const tagline = normalizeLocalizedText(raw?.tagline, fallbackDescription);
  const summary = normalizeLocalizedText(raw?.summary, fallbackDescription);

  return {
    capabilities: normalizeLocalizedList(raw?.capabilities),
    confidence: Number.isFinite(Number(raw?.confidence))
      ? Math.min(Math.max(Number(raw.confidence), 0), 1)
      : 0.72,
    keywords: normalizeStringArray(raw?.keywords, 6, 42),
    summary,
    tagline,
    useCases: normalizeLocalizedList(raw?.use_cases ?? raw?.useCases),
  };
}

function buildSummaryPrompt(target) {
  const topics = safeJsonParse(target.topics_json ?? "[]", []);
  const topicList = Array.isArray(topics) && topics.length > 0 ? topics.join(", ") : "none";
  const description = normalizeString(target.description ?? "", 280);

  return [
    "You are summarizing a GitHub repository for a skyline explorer.",
    "Use only the README content and the metadata below. Do not invent features or use cases that are not supported by the README.",
    "Return strict JSON with this shape:",
    JSON.stringify(
      {
        tagline: { zh: "", en: "" },
        summary: { zh: "", en: "" },
        capabilities: { zh: ["", ""], en: ["", ""] },
        use_cases: { zh: ["", ""], en: ["", ""] },
        keywords: ["", ""],
        confidence: 0.9,
      },
      null,
      2,
    ),
    "Rules:",
    "- Goal: accurate and easy to understand.",
    "- Tone: concise, clear, factual.",
    "- Do not force the project into an AI/agent category if the README does not support that.",
    "- In Chinese output, when the technical term agent refers to an AI/software agent, keep the word 'agent' in English instead of translating it to '代理'.",
    "- If the repository is a package set, package index, framework, library, tool, infra project, or research project, describe it as such.",
    "- tagline: one short sentence that says what the project is in plain language.",
    "- summary: 2-3 factual sentences that explain what it does and how it is used.",
    "- capabilities: 3-5 concrete capability phrases.",
    "- use_cases: 2-4 realistic use case phrases.",
    "- keywords: 3-6 short keywords",
    "- If the README does not state something clearly, omit it instead of guessing.",
    "- Avoid promotional wording and avoid overstating scope.",
    "",
    `Repository: ${target.repo_full_name}`,
    `Owner: ${target.owner_login}`,
    `Name: ${target.repo_name}`,
    `Primary language: ${target.language || "unknown"}`,
    `Topics: ${topicList}`,
    `Existing description: ${description || "none"}`,
    "",
    "README:",
    target.cleaned_markdown,
  ].join("\n");
}

function upsertSummary(database, record) {
  database
    .prepare(
      `
        INSERT INTO skyline_repo_summaries (
          repo_full_name,
          readme_sha,
          model_name,
          summary_version,
          summary_json,
          usage_json,
          summarized_at,
          last_attempt_at,
          status,
          error_message
        )
        VALUES (
          $repoFullName,
          $readmeSha,
          $modelName,
          $summaryVersion,
          $summaryJson,
          $usageJson,
          $summarizedAt,
          CURRENT_TIMESTAMP,
          $status,
          $errorMessage
        )
        ON CONFLICT(repo_full_name) DO UPDATE SET
          readme_sha = excluded.readme_sha,
          model_name = excluded.model_name,
          summary_version = excluded.summary_version,
          summary_json = excluded.summary_json,
          usage_json = excluded.usage_json,
          summarized_at = excluded.summarized_at,
          last_attempt_at = CURRENT_TIMESTAMP,
          status = excluded.status,
          error_message = excluded.error_message
      `,
    )
    .run(record);
}

async function summarizeTarget(target, model) {
  const response = await fetchDeepSeekChatCompletion({
    maxTokens: 1200,
    messages: [
      {
        content:
          "You are a precise technical summarizer. Output only valid JSON. Use only README-supported facts. Prioritize accuracy and clarity over categorization. In Chinese technical text, keep the term 'agent' in English when it refers to an AI/software agent.",
        role: "system",
      },
      {
        content: buildSummaryPrompt(target),
        role: "user",
      },
    ],
    model,
    temperature: 0.15,
  });
  const content = response?.choices?.[0]?.message?.content;
  const parsed = safeJsonParse(content, null);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("DeepSeek did not return a valid JSON object.");
  }

  return {
    normalized: normalizeSummaryPayload(parsed, target.description ?? ""),
    usage: response.usage ?? {},
  };
}

export async function summarizeReadmesForSnapshot({
  concurrency = 2,
  delayMs = 260,
  force = false,
  limit = Number.POSITIVE_INFINITY,
  model = "deepseek-chat",
} = {}) {
  loadLocalEnv();

  if (!getDeepSeekApiKey()) {
    return {
      eligible: 0,
      failed: 0,
      requested: 0,
      skipped: "missing_api_key",
      succeeded: 0,
    };
  }

  const snapshot = loadCurrentSnapshot();
  const repoNames = listSnapshotRepoNames(snapshot, limit);

  if (repoNames.length === 0) {
    return {
      eligible: 0,
      failed: 0,
      requested: 0,
      skipped: "no_snapshot_repos",
      succeeded: 0,
    };
  }

  const database = openSkylineDatabase();
  ensureSchema(database);

  try {
    const rawTargets = loadSummaryTargets(database, repoNames);
    const targets = rawTargets.filter((target) => {
      if (force) {
        return true;
      }

      return (
        target.summary_status !== "ok" ||
        target.summary_version !== summaryVersion ||
        target.summary_readme_sha !== target.readme_sha
      );
    });
    const summary = {
      eligible: targets.length,
      failed: 0,
      requested: repoNames.length,
      skipped: null,
      succeeded: 0,
    };

    for (const group of chunk(targets, Math.max(1, concurrency))) {
      await Promise.all(
        group.map(async (target) => {
          try {
            const result = await summarizeTarget(target, model);

            upsertSummary(database, {
              errorMessage: null,
              modelName: model,
              readmeSha: target.readme_sha,
              repoFullName: target.repo_full_name,
              status: "ok",
              summarizedAt: new Date().toISOString(),
              summaryJson: JSON.stringify(result.normalized),
              summaryVersion,
              usageJson: JSON.stringify(result.usage),
            });
            summary.succeeded += 1;
          } catch (error) {
            upsertSummary(database, {
              errorMessage:
                error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
              modelName: model,
              readmeSha: target.readme_sha,
              repoFullName: target.repo_full_name,
              status: "error",
              summarizedAt: null,
              summaryJson: null,
              summaryVersion,
              usageJson: "{}",
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

  summarizeReadmesForSnapshot({
    concurrency: Number(args.concurrency ?? 2),
    delayMs: Number(args.delay ?? 260),
    force: args.force === "true" || args.force === "1",
    limit:
      args.limit == null ? Number.POSITIVE_INFINITY : Number(args.limit),
    model: args.model ?? "deepseek-chat",
  })
    .then((summary) => {
      console.log("Summarized snapshot READMEs.");
      console.log(summary);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
