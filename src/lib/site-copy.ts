import type { DomainKey, Locale } from "@/lib/skyline-data";

export type SupportedLocale = Locale;

type SiteCopy = {
  timeLocale: string;
  brand: string;
  title: string;
  subtitle: string;
  refresh: string;
  refreshing: string;
  switchLabel: string;
  switchHref: string;
  browserTimeFallback: string;
  emptyValue: string;
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
    demo: string;
    live: string;
    emptyTitle: string;
    emptyBody: string;
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
    brand: "GitHub 天际线雷达",
    title: "把 AI 开源项目做成一座可观察的 3D 城市。",
    subtitle:
      "当前楼体形态和数据仍是示例快照，用来先验证视觉表达和信息结构；下一步会切到真实 GitHub 增量抓取。",
    refresh: "刷新快照",
    refreshing: "刷新中…",
    switchLabel: "切换到英文版",
    switchHref: "/en",
    browserTimeFallback: "浏览器时间",
    emptyValue: "暂无",
    phase: {
      day: "白天",
      dusk: "傍晚",
      night: "夜晚",
    },
    stats: {
      tracked: {
        label: "跟踪仓库",
        note: "当前示例池里的相关项目规模",
      },
      newborn: {
        label: "24 小时新增",
        note: "后续会由真实 CreateEvent 填充",
      },
      stars: {
        label: "7 日 star 增量",
        note: "适合判断整体热度斜率",
      },
      updates: {
        label: "7 日更新事件",
        note: "夜间楼灯强度的核心来源",
      },
      momentum: {
        label: "增长最快",
        note: "最近 7 天 star 增量最大的仓库",
      },
      newestRepo: {
        label: "最新出现",
        note: "当前示例里最年轻的仓库",
      },
    },
    sceneLegend: {
      height: "楼高 = 混合分数",
      lights: "夜灯 = 更新频率",
      interaction: "点击楼体查看详情",
    },
    drawer: {
      repoDetail: "仓库详情",
      close: "关闭",
      demo: "示例快照",
      live: "实时快照",
      emptyTitle: "点击任意楼体",
      emptyBody: "右侧会展示对应仓库的描述、增量、活跃度和最近趋势。",
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
      agents: "代理系统",
      tooling: "开发工具",
      automation: "浏览器自动化",
      inference: "推理引擎",
      memory: "记忆与数据",
    },
  },
  en: {
    timeLocale: "en-US",
    brand: "GitHub Skyline Radar",
    title: "Turn AI open-source projects into a readable 3D city.",
    subtitle:
      "The towers and numbers are still demo snapshots for validating the visual language and information architecture; the next step is wiring in real GitHub incremental ingestion.",
    refresh: "Refresh snapshot",
    refreshing: "Refreshing…",
    switchLabel: "Switch to Chinese",
    switchHref: "/zh",
    browserTimeFallback: "Browser time",
    emptyValue: "N/A",
    phase: {
      day: "Day",
      dusk: "Dusk",
      night: "Night",
    },
    stats: {
      tracked: {
        label: "Tracked repos",
        note: "Current size of the demo discovery pool",
      },
      newborn: {
        label: "New in 24h",
        note: "Will later come from real CreateEvent ingestion",
      },
      stars: {
        label: "Stars in 7d",
        note: "Best quick signal for overall heat",
      },
      updates: {
        label: "Update events",
        note: "Primary driver of nighttime tower glow",
      },
      momentum: {
        label: "Fastest mover",
        note: "Highest 7-day star delta in the current snapshot",
      },
      newestRepo: {
        label: "Newest repo",
        note: "Youngest project in the current demo pool",
      },
    },
    sceneLegend: {
      height: "Height = mixed score",
      lights: "Night glow = update frequency",
      interaction: "Click a tower for repo details",
    },
    drawer: {
      repoDetail: "Repo detail",
      close: "Close",
      demo: "Demo snapshot",
      live: "Live snapshot",
      emptyTitle: "Click any tower",
      emptyBody: "The right side will show its description, growth, maintenance signal, and recent pulse.",
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
      agents: "Agent systems",
      tooling: "Dev tooling",
      automation: "Browser ops",
      inference: "Inference",
      memory: "Memory + data",
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
