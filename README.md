# GitHub Skyline MVP

一个面向 `AI / agent / devtools` 生态的 GitHub 发现型 MVP。

当前版本重点验证 4 件事：

- 仓库能否用极简 3D 立方体城市表达
- 白天 / 夜晚的场景氛围能否提升可读性
- 夜间楼体发光是否能直观表达更新频率
- 右侧榜单是否能补上“每天新增”和“最近爆发”的决策信息

## 本地启动

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 当前 MVP 的后端实现

现在的“后端”是 Next.js App Router 里的轻量 API：

- 页面服务端先调用 `getSkylineSnapshot()`
- `/api/skyline` 返回同一份结构化快照
- 数据源目前是 `src/lib/skyline-data.ts` 里的 demo 数据

这样做的目的是先把前后端协议、场景编码和 UI 决策固定下来，后面可以直接替换真实抓取任务，而不用重写前端。

## 建议的真实数据方案

生产版建议拆成 4 层：

1. 发现层
- 用 GitHub Search + topics + 自定义种子仓库发现相关 repo
- 用 GH Archive 的 `CreateEvent` 追踪新增仓库
- 用 `PushEvent` / `PullRequestEvent` / `IssuesEvent` 做活跃度增量

2. 补全层
- GitHub REST 拉 repo 元信息、topics、默认分支、stars 总量
- GitHub REST starring endpoint 或 GH Archive `WatchEvent` 聚合每日 star 增量
- README / description 抽文本特征，后续做社区布局

3. 计算层
- 每天生成 `repo_daily_rollups`
- 计算混合分数
  - `score = log(totalStars) + starDelta7d + updateEvents7d + contributors30d`
- 计算楼高、楼灯强度、是否属于 newborn / momentum

4. 快照层
- 每天或每小时生成一个 `skyline_snapshot`
- 前端只读取最新快照
- 社区布局离线计算，避免页面实时跑聚类

## 推荐的数据表

```text
repositories
repo_daily_rollups
repo_topics
repo_similarity_edges
skyline_snapshots
```

## 为什么先做快照而不是实时

- GitHub events 官方并不适合强实时
- GH Archive 有天然延迟，但非常适合日级和小时级分析
- 3D 页面更适合读取预计算结果，避免客户端负担过重

## 接下来适合补的能力

- 从 demo 数据切换到 SQLite / Postgres
- 增加“今日新增仓库”自动抓取
- 增加 README 语义聚类，取代当前手工社区坐标
- 保留现在的楼房版本，同时新增 3D 地形图模式

