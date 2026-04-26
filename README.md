# GithubStars Skyline

一个把 GitHub 公共仓库宇宙压成 3D 天际线的发现型项目。

当前版本重点验证两件事：

- `1 repo = 1 tower` 的城市表达能否承载足够大的仓库池
- `30 天物化快照` 能否稳定支撑“高星 / 高增速 / 高活跃”仓库的日更天际线

## 本地启动

```bash
npm install
cp .env.example .env.local
# GITHUB_TOKEN 用于补全仓库元数据
# DEEPSEEK_API_KEY 用于给入图仓库生成 README 摘要
# 不填仍可跑 demo / 已有快照，只是不会生成摘要
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 30 天数据管线

现在的真实数据主链路分成 5 步：

1. `npm run db:schema`
- 初始化本地 SQLite 数据库 `data/skyline.sqlite`

2. `npm run db:backfill:30d`
- 流式回放 GH Archive 最近 30 天小时文件
- 聚合 `Watch / Push / PR / Issues / Release / Create / Fork` 到日级表
- 记录 repo-day 贡献者集合

持续运行时使用 `npm run db:gharchive:loop`：

- 每轮只处理缺失的完整 UTC 日期，默认跳过当天、追到昨天
- 每个日期会写入 `skyline_gharchive_days`，记录 `running / ok / error`
- 处理日期前会清掉该日期的旧指标，保证失败重试不会重复累加
- 每小时文件会输出进度日志，默认 30 分钟超时，可用 `--hour-timeout-ms` 调整

3. `npm run db:enrich`
- 用 GitHub REST `/repos/{owner}/{repo}` 补仓库元数据
- 拉 stars 总量、语言、topics、pushed_at、归档状态等

4. `npm run db:snapshot`
- 按 30 天窗口筛出达到阈值的仓库
- 计算混合分数和楼体参数
- 物化到 `data/skyline-snapshot.json`
- 页面优先读取这份快照，没有才回退到旧的轻量 live/demo 逻辑

5. `npm run db:summary:sync`
- 只处理当前 snapshot 里的入图仓库
- 用 GitHub API 拉 README
- 仅当 README SHA 变化时才重新调用 DeepSeek
- 生成双语结构化摘要，下一次 `db:snapshot` 会把这些字段带进详情抽屉

一条命令串起来：

```bash
npm run db:bootstrap:30d
```

## 为什么不是纯网页爬虫

第一版不以 GitHub 网页 HTML 爬虫为主。

- `GH Archive` 负责全站公共事件发现与日级增量
- `GitHub API` 负责 repo 元数据补全
- `DeepSeek` 只负责对当前入图仓库做 README 总结

这条链路更稳，也更适合“每天至少更新一次”的目标。

## 当前入场阈值

30 天快照默认会把满足以下任一条件的仓库纳入候选：

- `total_stars >= 200`
- `stars_added_30d >= 20`
- `update_events_30d >= 80 && total_stars >= 50`
- `created_in_30d && total_stars >= 30`

然后再按混合分数取前 `420` 个仓库进入城市。

## README 摘要

README 摘要默认只处理“当前已经进入地图”的仓库，而不是全库：

- 抓取表：`skyline_repo_readmes`
- 摘要表：`skyline_repo_summaries`
- 模型：`deepseek-chat`
- 策略：只在 `README SHA` 变化时重算

这样可以把模型成本压到很低，同时让详情抽屉里的简介、能力点和使用场景比模板文案更有信息量。

## 数据落地

生成物默认都在 `data/` 下：

- `data/skyline.sqlite`
- `data/skyline-snapshot.json`

这些都是运行产物，不进 git。
