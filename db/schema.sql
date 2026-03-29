PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS skyline_repos (
  full_name TEXT PRIMARY KEY,
  repo_id INTEGER,
  owner_login TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  description TEXT,
  language TEXT,
  topics_json TEXT NOT NULL DEFAULT '[]',
  html_url TEXT,
  homepage TEXT,
  default_branch TEXT,
  stargazers_count INTEGER NOT NULL DEFAULT 0,
  forks_count INTEGER NOT NULL DEFAULT 0,
  open_issues_count INTEGER NOT NULL DEFAULT 0,
  watchers_count INTEGER NOT NULL DEFAULT 0,
  repo_size_kb INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  pushed_at TEXT,
  updated_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  is_fork INTEGER NOT NULL DEFAULT 0,
  last_enriched_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS skyline_repos_repo_id_idx
  ON skyline_repos (repo_id);

CREATE INDEX IF NOT EXISTS skyline_repos_stars_idx
  ON skyline_repos (stargazers_count DESC);

CREATE INDEX IF NOT EXISTS skyline_repos_last_seen_idx
  ON skyline_repos (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS skyline_repo_daily_metrics (
  repo_full_name TEXT NOT NULL REFERENCES skyline_repos(full_name) ON DELETE CASCADE,
  metric_date TEXT NOT NULL,
  watch_events INTEGER NOT NULL DEFAULT 0,
  push_events INTEGER NOT NULL DEFAULT 0,
  pull_request_events INTEGER NOT NULL DEFAULT 0,
  issues_events INTEGER NOT NULL DEFAULT 0,
  issue_comment_events INTEGER NOT NULL DEFAULT 0,
  release_events INTEGER NOT NULL DEFAULT 0,
  fork_events INTEGER NOT NULL DEFAULT 0,
  create_events INTEGER NOT NULL DEFAULT 0,
  total_events INTEGER NOT NULL DEFAULT 0,
  contributors INTEGER NOT NULL DEFAULT 0,
  created_repo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_full_name, metric_date)
);

CREATE INDEX IF NOT EXISTS skyline_repo_daily_metrics_date_idx
  ON skyline_repo_daily_metrics (metric_date DESC);

CREATE INDEX IF NOT EXISTS skyline_repo_daily_metrics_watch_idx
  ON skyline_repo_daily_metrics (watch_events DESC);

CREATE TABLE IF NOT EXISTS skyline_repo_daily_actors (
  repo_full_name TEXT NOT NULL REFERENCES skyline_repos(full_name) ON DELETE CASCADE,
  metric_date TEXT NOT NULL,
  actor_login TEXT NOT NULL,
  PRIMARY KEY (repo_full_name, metric_date, actor_login)
);

CREATE INDEX IF NOT EXISTS skyline_repo_daily_actors_date_idx
  ON skyline_repo_daily_actors (metric_date DESC);

CREATE TABLE IF NOT EXISTS skyline_ingestion_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skyline_snapshots (
  snapshot_name TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}'
);
