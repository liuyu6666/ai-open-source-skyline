/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");

const appRoot = process.env.SKYLINE_APP_ROOT || "/home/clawer/apps/ai-open-source-skyline";
const nodeBinary =
  process.env.SKYLINE_NODE_BIN || "/home/clawer/.nvm/versions/node/v22.22.2/bin/node";
const nodePath = path.dirname(nodeBinary);

module.exports = {
  apps: [
    {
      name: "skyline-web",
      cwd: appRoot,
      script: "node_modules/next/dist/bin/next",
      interpreter: nodeBinary,
      args: "start --hostname 0.0.0.0 --port 3000",
      env: {
        NODE_ENV: "production",
        PATH: `${nodePath}:${process.env.PATH || ""}`,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "skyline-web-8080",
      cwd: appRoot,
      script: "node_modules/next/dist/bin/next",
      interpreter: nodeBinary,
      args: "start --hostname 0.0.0.0 --port 8080",
      env: {
        NODE_ENV: "production",
        PATH: `${nodePath}:${process.env.PATH || ""}`,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "skyline-enrich",
      cwd: appRoot,
      script: "scripts/skyline/enrich-loop.mjs",
      interpreter: nodeBinary,
      args:
        "--interval-ms=600000 --missing-batch-limit=300 --recent-batch-limit=400 --recent-every-cycles=6 --concurrency=4 --query-batch-size=20 --rate-per-hour=1800 --delay=120 --pause=0 --transport=graphql",
      env: {
        NODE_ENV: "production",
        PATH: `${nodePath}:${process.env.PATH || ""}`,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "skyline-recent-metrics",
      cwd: appRoot,
      script: "scripts/skyline/recent-metrics-loop.mjs",
      interpreter: nodeBinary,
      args: "--interval-ms=1800000 --days=30 --max-age-minutes=45",
      env: {
        NODE_ENV: "production",
        PATH: `${nodePath}:${process.env.PATH || ""}`,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "skyline-gharchive",
      cwd: appRoot,
      script: "scripts/skyline/gharchive-loop.mjs",
      interpreter: nodeBinary,
      args:
        "--interval-ms=3600000 --active-interval-ms=60000 --days-per-cycle=1 --lag-days=1 --hour-timeout-ms=1800000 --min-daily-events=6 --min-daily-contributors=3",
      env: {
        NODE_ENV: "production",
        PATH: `${nodePath}:${process.env.PATH || ""}`,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "skyline-snapshot",
      cwd: appRoot,
      script: "scripts/skyline/snapshot-loop.mjs",
      interpreter: nodeBinary,
      args: "--interval-ms=3600000 --limit=500 --min-stars=5000 --min-star-delta-7d=100",
      env: {
        NODE_ENV: "production",
        PATH: `${nodePath}:${process.env.PATH || ""}`,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "skyline-summary-sync",
      cwd: appRoot,
      script: "scripts/skyline/summary-loop.mjs",
      interpreter: nodeBinary,
      args:
        "--interval-ms=14400000 --limit=500 --fetch-concurrency=4 --fetch-delay=180 --summarize-concurrency=2 --summarize-delay=260 --model=deepseek-chat",
      env: {
        NODE_ENV: "production",
        PATH: `${nodePath}:${process.env.PATH || ""}`,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
