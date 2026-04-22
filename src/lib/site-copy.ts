import type { DomainKey, Locale } from "@/lib/skyline-data";

export type SupportedLocale = Locale;

type SiteCopy = {
  timeLocale: string;
  brand: string;
  title: string;
  mobileTitle: string;
  demoSubtitle: string;
  mobileDemoSubtitle: string;
  liveSubtitle: string;
  mobileLiveSubtitle: string;
  refresh: string;
  refreshing: string;
  mobileRefresh: string;
  mobileRefreshing: string;
  switchLabel: string;
  mobileSwitchLabel: string;
  switchHref: string;
  browserTimeFallback: string;
  emptyValue: string;
  controls: {
    closeRadar: string;
    searchPlaceholder: string;
    clear: string;
    allDomains: string;
    showing: string;
    verified: string;
    snapshot: string;
    noMatches: string;
    openRadar: string;
  };
  phase: {
    day: string;
    dusk: string;
    night: string;
  };
  stats: {
    tracked: { label: string; note: string };
    newborn: { label: string; note: string };
    stars: { label: string; note: string };
    updates: { label: string; note: string };
    momentum: { label: string; note: string };
    newestRepo: { label: string; note: string };
  };
  sceneLegend: {
    height: string;
    lights: string;
    interaction: string;
  };
  drawer: {
    repoDetail: string;
    close: string;
    openRepo: string;
    demo: string;
    live: string;
    emptyTitle: string;
    emptyBody: string;
    readmeDigest: string;
    snapshotNote: string;
    capabilities: string;
    useCases: string;
    keywords: string;
    totalStars: string;
    starDelta7d: string;
    updateEvents: string;
    contributors: string;
    dailyPulse: string;
    created: string;
    lastPush: string;
    mixedScore: string;
  };
  domainLabels: Record<DomainKey, string>;
};

const siteCopy: Record<SupportedLocale, SiteCopy> = {
  zh: {
    timeLocale: "zh-CN",
    brand: "GithubStars Skyline",
    title: "GithubStars Skyline",
    mobileTitle: "GithubStars Skyline",
    demoSubtitle:
      "当前仍在回退示例快照，用来保证界面和交互可用；一旦 30 天物化快照生成成功，页面会自动切到真实仓库城市。",
    mobileDemoSubtitle: "当前优先展示示例快照，30 天真实快照生成后会自动切换。",
    liveSubtitle:
      "当前优先读取 30 天 GH Archive + GitHub API 物化快照；没有快照时才回退到轻量 API 采样。",
    mobileLiveSubtitle: "30 天 GH Archive + GitHub API 真实快照。",
    refresh: "刷新快照",
    refreshing: "刷新中…",
    mobileRefresh: "刷新",
    mobileRefreshing: "刷新中",
    switchLabel: "切换到英文版",
    mobileSwitchLabel: "EN",
    switchHref: "/en",
    browserTimeFallback: "浏览器时间",
    emptyValue: "暂无",
    controls: {
      closeRadar: "收起雷达",
      searchPlaceholder: "搜索仓库名 / owner / full name",
      clear: "清除筛选",
      allDomains: "全部分区",
      showing: "当前显示",
      verified: "GitHub 已校验",
      snapshot: "快照时间",
      noMatches: "没有匹配结果",
      openRadar: "打开雷达",
    },
    phase: {
      day: "白天",
      dusk: "傍晚",
      night: "夜晚",
    },
    stats: {
      tracked: {
        label: "跟踪仓库",
        note: "当前快照中进入城市的仓库数量",
      },
      newborn: {
        label: "24 小时新增",
        note: "最近一天新出现或刚达到入场阈值的仓库",
      },
      stars: {
        label: "7 日 star 增量",
        note: "用来判断近 7 天热度变化",
      },
      updates: {
        label: "7 日更新事件",
        note: "用于衡量项目维护活跃度",
      },
      momentum: {
        label: "增长最快",
        note: "最近 7 天 star 增量最大的仓库",
      },
      newestRepo: {
        label: "最新出现",
        note: "当前快照里最年轻的仓库",
      },
    },
    sceneLegend: {
      height: "楼高 = 总 star 线性比例",
      lights: "楼体亮度 = 7 日 star 涨幅",
      interaction: "点击楼体查看详情",
    },
    drawer: {
      repoDetail: "仓库详情",
      close: "关闭",
      openRepo: "前往 GitHub",
      demo: "示例快照",
      live: "30 天快照",
      emptyTitle: "点击任意楼体",
      emptyBody: "右侧会展示对应仓库的描述、增量、活跃度和最近趋势。",
      readmeDigest: "README 摘要",
      snapshotNote: "快照统计说明",
      capabilities: "核心能力",
      useCases: "适用场景",
      keywords: "关键词",
      totalStars: "总 star",
      starDelta7d: "7 日 star 增量",
      updateEvents: "7 日更新事件",
      contributors: "30 日贡献者",
      dailyPulse: "每日 star 脉冲",
      created: "创建时间",
      lastPush: "最近 push",
      mixedScore: "混合分数",
    },
    domainLabels: {
      agents: "应用与产品",
      tooling: "开发工具",
      automation: "自动化流程",
      inference: "基础设施",
      memory: "数据与存储",
    },
  },
  en: {
    timeLocale: "en-US",
    brand: "GithubStars Skyline",
    title: "GithubStars Skyline",
    mobileTitle: "GithubStars Skyline",
    demoSubtitle:
      "The app is still falling back to demo snapshots when no catalog exists; once the 30-day materialized snapshot is ready, the city switches to real repositories automatically.",
    mobileDemoSubtitle:
      "The app is showing a fallback demo snapshot until the 30-day live city is ready.",
    liveSubtitle:
      "The app now prefers a 30-day materialized snapshot built from GH Archive plus GitHub API enrichment; the lightweight live sampler is only a fallback.",
    mobileLiveSubtitle: "30-day live snapshot from GH Archive and GitHub API enrichment.",
    refresh: "Refresh snapshot",
    refreshing: "Refreshing…",
    mobileRefresh: "Refresh",
    mobileRefreshing: "Syncing",
    switchLabel: "Switch to Chinese",
    mobileSwitchLabel: "中文",
    switchHref: "/zh",
    browserTimeFallback: "Browser time",
    emptyValue: "N/A",
    controls: {
      closeRadar: "Close radar",
      searchPlaceholder: "Search repo / owner / full name",
      clear: "Clear filters",
      allDomains: "All districts",
      showing: "Showing",
      verified: "GitHub verified",
      snapshot: "Snapshot",
      noMatches: "No matching repos",
      openRadar: "Open radar",
    },
    phase: {
      day: "Day",
      dusk: "Dusk",
      night: "Night",
    },
    stats: {
      tracked: {
        label: "Tracked repos",
        note: "Repositories currently represented in the skyline",
      },
      newborn: {
        label: "New in 24h",
        note: "Repos that just appeared or crossed the entry threshold",
      },
      stars: {
        label: "Stars in 7d",
        note: "Best quick signal for overall heat",
      },
      updates: {
        label: "Update events",
        note: "Maintenance activity signal over the last 7 days",
      },
      momentum: {
        label: "Fastest mover",
        note: "Highest 7-day star delta in the current snapshot",
      },
      newestRepo: {
        label: "Newest repo",
        note: "Youngest repository in the current snapshot",
      },
    },
    sceneLegend: {
      height: "Height = total stars, linearly scaled",
      lights: "Tower glow = 7-day star delta",
      interaction: "Click a tower for repo details",
    },
    drawer: {
      repoDetail: "Repo detail",
      close: "Close",
      openRepo: "Open on GitHub",
      demo: "Demo snapshot",
      live: "30-day snapshot",
      emptyTitle: "Click any tower",
      emptyBody: "The right side will show its description, growth, maintenance signal, and recent pulse.",
      readmeDigest: "README digest",
      snapshotNote: "Snapshot note",
      capabilities: "Capabilities",
      useCases: "Use cases",
      keywords: "Keywords",
      totalStars: "Total stars",
      starDelta7d: "Star delta 7d",
      updateEvents: "Update events 7d",
      contributors: "Contributors 30d",
      dailyPulse: "Daily star pulse",
      created: "Created",
      lastPush: "Last push",
      mixedScore: "Mixed score",
    },
    domainLabels: {
      agents: "Apps + products",
      tooling: "Dev tooling",
      automation: "Automation",
      inference: "Infrastructure",
      memory: "Data + storage",
    },
  },
};

export const isSupportedLocale = (value: string): value is SupportedLocale =>
  value === "zh" || value === "en";

export const getSiteCopy = (locale: SupportedLocale) => siteCopy[locale];

const pad = (value: number) => value.toString().padStart(2, "0");

export const formatGeneratedAt = (isoString: string, locale: SupportedLocale) => {
  const date = new Date(isoString);
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());

  if (locale === "zh") {
    return `${year}年${month}月${day}日 ${hour}:${minute} UTC`;
  }

  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
};

export const formatNumber = (value: number, locale: SupportedLocale) =>
  new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US").format(value);

export const formatRelativeDays = (days: number, locale: SupportedLocale) => {
  if (locale === "zh") {
    if (days <= 0) return "今天";
    if (days === 1) return "1 天前";
    return `${days} 天前`;
  }

  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
};

export const formatHoursAgo = (hours: number, locale: SupportedLocale) => {
  if (locale === "zh") {
    if (hours <= 1) return "1 小时前";
    return `${hours} 小时前`;
  }

  if (hours <= 1) return "1 hour ago";
  return `${hours} hours ago`;
};
