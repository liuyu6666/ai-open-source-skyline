# GitHub Skyline MVP

一个把 GitHub 公共仓库宇宙压成 3D 天际线的发现型 MVP。

当前版本重点验证两件事：

- `1 repo = 1 tower` 的城市表达能否承载足够大的仓库池
- `30 天物化快照` 能否稳定支撑“高星 / 高增速 / 高活跃”仓库的日更天际线

## 本地启动

```bash
npm install
cp .env.example .env.local
# GITHUB_TOKEN 用于补全仓库元数据；不填仍可跑 demo / 已有快照
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 30 天数据管线

现在的真实数据主链路分成 4 步：

1. `npm run db:schema`
- 初始化本地 SQLite 数据库 `data/skyline.sqlite`

2. `npm run db:backfill:30d`
- 流式回放 GH Archive 最近 30 天小时文件
- 聚合 `Watch / Push / PR / Issues / Release / Create / Fork` 到日级表
- 记录 repo-day 贡献者集合

3. `npm run db:enrich`
- 用 GitHub REST `/repos/{owner}/{repo}` 补仓库元数据
- 拉 stars 总量、语言、topics、pushed_at、归档状态等

4. `npm run db:snapshot`
- 按 30 天窗口筛出达到阈值的仓库
- 计算混合分数和楼体参数
- 物化到 `data/skyline-snapshot.json`
- 页面优先读取这份快照，没有才回退到旧的轻量 live/demo 逻辑

一条命令串起来：

```bash
npm run db:bootstrap:30d
```

## 为什么不是纯网页爬虫

第一版不以 GitHub 网页 HTML 爬虫为主。

- `GH Archive` 负责全站公共事件发现与日级增量
- `GitHub API` 负责 repo 元数据补全
- 只有未来要补 README 外部站点语义时，才需要少量 crawler

这条链路更稳，也更适合“每天至少更新一次”的目标。

## 当前入场阈值

30 天快照默认会把满足以下任一条件的仓库纳入候选：

- `total_stars >= 200`
- `stars_added_30d >= 20`
- `update_events_30d >= 80 && total_stars >= 50`
- `created_in_30d && total_stars >= 30`

然后再按混合分数取前 `420` 个仓库进入城市。

## 数据落地

生成物默认都在 `data/` 下：

- `data/skyline.sqlite`
- `data/skyline-snapshot.json`

这些都是运行产物，不进 git。
