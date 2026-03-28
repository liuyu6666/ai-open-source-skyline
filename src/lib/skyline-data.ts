export type Locale = "zh" | "en";

export type DomainKey =
  | "agents"
  | "tooling"
  | "automation"
  | "inference"
  | "memory";

export type DistrictRecord = {
  id: DomainKey;
  color: string;
  center: { x: number; z: number };
  size: { width: number; depth: number };
};

export type RepoRecord = {
  id: string;
  fullName: string;
  name: string;
  owner: string;
  description: Record<Locale, string>;
  domain: DomainKey;
  color: string;
  totalStars: number;
  starDelta1d: number;
  starDelta7d: number;
  updateEvents7d: number;
  contributors30d: number;
  createdDaysAgo: number;
  lastPushHoursAgo: number;
  score: number;
  height: number;
  width: number;
  depth: number;
  lotWidth: number;
  lotDepth: number;
  lightStrength: number;
  x: number;
  z: number;
  trend: number[];
};

export type SkylineSnapshot = {
  generatedAt: string;
  demoMode: boolean;
  stats: {
    trackedRepos: number;
    newRepos24h: number;
    starsAdded7d: number;
    updates7d: number;
  };
  districts: DistrictRecord[];
  repos: RepoRecord[];
};

type RawRepo = {
  id: string;
  fullName: string;
  name: string;
  owner: string;
  description: Record<Locale, string>;
  domain: DomainKey;
  totalStars: number;
  starDelta1d: number;
  starDelta7d: number;
  updateEvents7d: number;
  contributors30d: number;
  createdDaysAgo: number;
  lastPushHoursAgo: number;
  trend: number[];
};

const districts: DistrictRecord[] = [
  {
    id: "agents",
    color: "#7dd3fc",
    center: { x: -34, z: -20 },
    size: { width: 32, depth: 26 },
  },
  {
    id: "tooling",
    color: "#f9a8d4",
    center: { x: 34, z: -20 },
    size: { width: 32, depth: 26 },
  },
  {
    id: "automation",
    color: "#c4b5fd",
    center: { x: 0, z: -2 },
    size: { width: 36, depth: 28 },
  },
  {
    id: "inference",
    color: "#fcd34d",
    center: { x: -24, z: 28 },
    size: { width: 30, depth: 24 },
  },
  {
    id: "memory",
    color: "#86efac",
    center: { x: 24, z: 28 },
    size: { width: 30, depth: 24 },
  },
];

const districtLots: Record<DomainKey, { x: number; z: number }[]> = {
  agents: [
    { x: -9, z: -7 },
    { x: 8, z: -7 },
    { x: -8, z: 7 },
    { x: 8, z: 6 },
  ],
  tooling: [
    { x: -8, z: -7 },
    { x: 9, z: -6 },
    { x: -9, z: 7 },
    { x: 7, z: 8 },
  ],
  automation: [
    { x: -11, z: -7 },
    { x: 10, z: -7 },
    { x: -10, z: 8 },
    { x: 10, z: 8 },
  ],
  inference: [
    { x: -8, z: -6 },
    { x: 8, z: -7 },
    { x: -7, z: 7 },
    { x: 8, z: 7 },
  ],
  memory: [
    { x: -8, z: -6 },
    { x: 8, z: -6 },
    { x: -7, z: 7 },
    { x: 8, z: 7 },
  ],
};

const rawRepos: RawRepo[] = [
  {
    id: "openhands",
    owner: "all-hands-ai",
    name: "OpenHands",
    fullName: "all-hands-ai/OpenHands",
    description: {
      zh: "通用软件工程代理，社区热度高，持续获得关注。",
      en: "General software engineering agent with strong community momentum.",
    },
    domain: "agents",
    totalStars: 48500,
    starDelta1d: 210,
    starDelta7d: 1740,
    updateEvents7d: 52,
    contributors30d: 39,
    createdDaysAgo: 420,
    lastPushHoursAgo: 2,
    trend: [140, 180, 230, 260, 240, 310, 380],
  },
  {
    id: "autogen",
    owner: "microsoft",
    name: "AutoGen",
    fullName: "microsoft/autogen",
    description: {
      zh: "多代理框架，star 稳定，贡献者结构健康。",
      en: "Multi-agent framework with sustained stars and active contributor base.",
    },
    domain: "agents",
    totalStars: 39500,
    starDelta1d: 84,
    starDelta7d: 620,
    updateEvents7d: 28,
    contributors30d: 24,
    createdDaysAgo: 860,
    lastPushHoursAgo: 8,
    trend: [48, 56, 73, 90, 105, 118, 130],
  },
  {
    id: "crewai",
    owner: "crewAIInc",
    name: "crewAI",
    fullName: "crewAIInc/crewAI",
    description: {
      zh: "面向任务编排的代理框架，产品化势头明显。",
      en: "Agent workflow orchestration with strong product energy.",
    },
    domain: "agents",
    totalStars: 28700,
    starDelta1d: 102,
    starDelta7d: 760,
    updateEvents7d: 36,
    contributors30d: 18,
    createdDaysAgo: 510,
    lastPushHoursAgo: 5,
    trend: [62, 78, 91, 106, 116, 144, 163],
  },
  {
    id: "openai-agents",
    owner: "openai",
    name: "Agents SDK",
    fullName: "openai/openai-agents-python",
    description: {
      zh: "结构化代理运行时，生态采用速度很快。",
      en: "Structured agent runtime with fast ecosystem adoption.",
    },
    domain: "agents",
    totalStars: 9600,
    starDelta1d: 160,
    starDelta7d: 1490,
    updateEvents7d: 45,
    contributors30d: 14,
    createdDaysAgo: 38,
    lastPushHoursAgo: 3,
    trend: [90, 110, 150, 180, 210, 330, 420],
  },
  {
    id: "continue",
    owner: "continuedev",
    name: "Continue",
    fullName: "continuedev/continue",
    description: {
      zh: "开源 AI 编码助手，插件生态比较完整。",
      en: "Open-source AI coding assistant with a healthy plugin ecosystem.",
    },
    domain: "tooling",
    totalStars: 26100,
    starDelta1d: 92,
    starDelta7d: 710,
    updateEvents7d: 41,
    contributors30d: 32,
    createdDaysAgo: 740,
    lastPushHoursAgo: 4,
    trend: [70, 83, 92, 99, 105, 126, 135],
  },
  {
    id: "aider",
    owner: "Aider-AI",
    name: "aider",
    fullName: "Aider-AI/aider",
    description: {
      zh: "终端原生的 AI 编程搭档，更新频率很高。",
      en: "Terminal-native coding pair programmer with a very frequent release cadence.",
    },
    domain: "tooling",
    totalStars: 34400,
    starDelta1d: 124,
    starDelta7d: 820,
    updateEvents7d: 48,
    contributors30d: 22,
    createdDaysAgo: 620,
    lastPushHoursAgo: 1,
    trend: [83, 96, 108, 114, 133, 142, 144],
  },
  {
    id: "cline",
    owner: "cline",
    name: "Cline",
    fullName: "cline/cline",
    description: {
      zh: "VS Code 里的编码代理，日常新增用户很猛。",
      en: "VS Code coding agent with strong daily adoption velocity.",
    },
    domain: "tooling",
    totalStars: 19400,
    starDelta1d: 141,
    starDelta7d: 1260,
    updateEvents7d: 35,
    contributors30d: 16,
    createdDaysAgo: 190,
    lastPushHoursAgo: 7,
    trend: [102, 115, 128, 156, 188, 246, 325],
  },
  {
    id: "goose",
    owner: "block",
    name: "Goose",
    fullName: "block/goose",
    description: {
      zh: "轻量代理工具集，最近一周增长很陡。",
      en: "Lightweight AI agent toolkit with breakout weekly growth.",
    },
    domain: "tooling",
    totalStars: 5200,
    starDelta1d: 133,
    starDelta7d: 1180,
    updateEvents7d: 54,
    contributors30d: 11,
    createdDaysAgo: 1,
    lastPushHoursAgo: 2,
    trend: [40, 58, 87, 120, 155, 290, 430],
  },
  {
    id: "browser-use",
    owner: "browser-use",
    name: "browser-use",
    fullName: "browser-use/browser-use",
    description: {
      zh: "浏览器代理框架，最近的爆发速度非常夸张。",
      en: "Browser agent framework with explosive week-on-week momentum.",
    },
    domain: "automation",
    totalStars: 62100,
    starDelta1d: 198,
    starDelta7d: 2120,
    updateEvents7d: 59,
    contributors30d: 31,
    createdDaysAgo: 165,
    lastPushHoursAgo: 2,
    trend: [145, 188, 232, 265, 295, 430, 565],
  },
  {
    id: "stagehand",
    owner: "browserbase",
    name: "Stagehand",
    fullName: "browserbase/stagehand",
    description: {
      zh: "面向代理的浏览器自动化 SDK，还在陡峭上升段。",
      en: "Browser automation SDK for agents, still climbing steeply.",
    },
    domain: "automation",
    totalStars: 9300,
    starDelta1d: 118,
    starDelta7d: 1030,
    updateEvents7d: 43,
    contributors30d: 17,
    createdDaysAgo: 54,
    lastPushHoursAgo: 4,
    trend: [68, 74, 101, 120, 150, 216, 301],
  },
  {
    id: "playwright-mcp",
    owner: "microsoft",
    name: "Playwright MCP",
    fullName: "microsoft/playwright-mcp",
    description: {
      zh: "浏览器控制层，更新密度很高，适合作为增量信号。",
      en: "Model control layer for browser flows with intense update velocity.",
    },
    domain: "automation",
    totalStars: 7100,
    starDelta1d: 84,
    starDelta7d: 860,
    updateEvents7d: 61,
    contributors30d: 9,
    createdDaysAgo: 0,
    lastPushHoursAgo: 1,
    trend: [53, 59, 80, 96, 123, 185, 264],
  },
  {
    id: "webvoyager",
    owner: "mshumer",
    name: "WebVoyager",
    fullName: "mshumer/WebVoyager",
    description: {
      zh: "实验型 Web 代理项目，创作者驱动型增长明显。",
      en: "Experimental web agent showing fast creator-driven bursts.",
    },
    domain: "automation",
    totalStars: 3300,
    starDelta1d: 55,
    starDelta7d: 390,
    updateEvents7d: 18,
    contributors30d: 6,
    createdDaysAgo: 8,
    lastPushHoursAgo: 5,
    trend: [16, 25, 31, 44, 59, 86, 129],
  },
  {
    id: "vllm",
    owner: "vllm-project",
    name: "vLLM",
    fullName: "vllm-project/vllm",
    description: {
      zh: "高吞吐推理运行时，基盘很大，更新也足够强。",
      en: "High-throughput inference runtime with a large installed base.",
    },
    domain: "inference",
    totalStars: 45800,
    starDelta1d: 77,
    starDelta7d: 590,
    updateEvents7d: 57,
    contributors30d: 44,
    createdDaysAgo: 780,
    lastPushHoursAgo: 1,
    trend: [58, 62, 73, 79, 93, 105, 120],
  },
  {
    id: "sglang",
    owner: "sgl-project",
    name: "SGLang",
    fullName: "sgl-project/sglang",
    description: {
      zh: "服务引擎很适合代理和推理闭环，热度持续上升。",
      en: "Serving engine optimized for fast agent and reasoning loops.",
    },
    domain: "inference",
    totalStars: 17800,
    starDelta1d: 112,
    starDelta7d: 910,
    updateEvents7d: 62,
    contributors30d: 29,
    createdDaysAgo: 280,
    lastPushHoursAgo: 3,
    trend: [74, 88, 96, 124, 145, 166, 217],
  },
  {
    id: "litellm",
    owner: "BerriAI",
    name: "LiteLLM",
    fullName: "BerriAI/litellm",
    description: {
      zh: "模型网关和路由层，运营层面的更新非常密集。",
      en: "Model gateway and routing layer with constant operational churn.",
    },
    domain: "inference",
    totalStars: 22100,
    starDelta1d: 65,
    starDelta7d: 430,
    updateEvents7d: 49,
    contributors30d: 27,
    createdDaysAgo: 640,
    lastPushHoursAgo: 6,
    trend: [36, 52, 59, 61, 69, 72, 81],
  },
  {
    id: "tgi",
    owner: "huggingface",
    name: "TGI",
    fullName: "huggingface/text-generation-inference",
    description: {
      zh: "比较成熟的推理栈，增量温和但维护频率很高。",
      en: "Mature serving stack with moderate growth and very high update frequency.",
    },
    domain: "inference",
    totalStars: 17000,
    starDelta1d: 39,
    starDelta7d: 280,
    updateEvents7d: 46,
    contributors30d: 26,
    createdDaysAgo: 970,
    lastPushHoursAgo: 12,
    trend: [28, 31, 38, 41, 39, 48, 55],
  },
  {
    id: "langgraph",
    owner: "langchain-ai",
    name: "LangGraph",
    fullName: "langchain-ai/langgraph",
    description: {
      zh: "面向代理工作流的状态和记忆图层，增长速度很稳。",
      en: "Stateful orchestration and memory graph for agent workflows.",
    },
    domain: "memory",
    totalStars: 11200,
    starDelta1d: 116,
    starDelta7d: 980,
    updateEvents7d: 38,
    contributors30d: 21,
    createdDaysAgo: 250,
    lastPushHoursAgo: 9,
    trend: [55, 69, 82, 104, 126, 155, 188],
  },
  {
    id: "mem0",
    owner: "mem0ai",
    name: "Mem0",
    fullName: "mem0ai/mem0",
    description: {
      zh: "长时记忆层，已经进入快速扩圈阶段。",
      en: "Memory layer for long-running agents, scaling quickly.",
    },
    domain: "memory",
    totalStars: 31500,
    starDelta1d: 95,
    starDelta7d: 690,
    updateEvents7d: 25,
    contributors30d: 13,
    createdDaysAgo: 410,
    lastPushHoursAgo: 13,
    trend: [49, 58, 72, 78, 85, 116, 124],
  },
  {
    id: "llamaindex",
    owner: "run-llama",
    name: "LlamaIndex",
    fullName: "run-llama/llama_index",
    description: {
      zh: "检索和数据层基础设施，老牌但仍有稳定活跃度。",
      en: "Data framework for retrieval-heavy AI apps and agents.",
    },
    domain: "memory",
    totalStars: 40600,
    starDelta1d: 51,
    starDelta7d: 340,
    updateEvents7d: 22,
    contributors30d: 19,
    createdDaysAgo: 1040,
    lastPushHoursAgo: 11,
    trend: [31, 40, 42, 44, 51, 61, 71],
  },
  {
    id: "chroma",
    owner: "chroma-core",
    name: "Chroma",
    fullName: "chroma-core/chroma",
    description: {
      zh: "向量数据库，基盘稳定，但最近涨幅相对平缓。",
      en: "Vector store with broad usage but calmer week-over-week momentum.",
    },
    domain: "memory",
    totalStars: 17600,
    starDelta1d: 27,
    starDelta7d: 160,
    updateEvents7d: 19,
    contributors30d: 12,
    createdDaysAgo: 900,
    lastPushHoursAgo: 16,
    trend: [19, 22, 23, 21, 25, 24, 26],
  },
];

const districtIndex = new Map(districts.map((district) => [district.id, district]));

const scoreRepo = (repo: RawRepo) => {
  const starBase = Math.log10(repo.totalStars + 1) * 12;
  const weeklyStarVelocity = repo.starDelta7d * 0.019;
  const updateSignal = repo.updateEvents7d * 0.46;
  const contributorSignal = repo.contributors30d * 0.42;
  const newbornBoost =
    repo.createdDaysAgo <= 1 ? 10 : repo.createdDaysAgo <= 14 ? 6 : repo.createdDaysAgo <= 45 ? 3 : 0;

  return starBase + weeklyStarVelocity + updateSignal + contributorSignal + newbornBoost;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const getSkylineSnapshot = (): SkylineSnapshot => {
  const maxUpdates = Math.max(...rawRepos.map((repo) => repo.updateEvents7d));
  const domainCounters = new Map<DomainKey, number>();

  const repos = rawRepos.map((repo) => {
    const district = districtIndex.get(repo.domain);

    if (!district) {
      throw new Error(`Missing district mapping for ${repo.domain}`);
    }

    const lotIndex = domainCounters.get(repo.domain) ?? 0;
    const lot = districtLots[repo.domain][lotIndex];
    domainCounters.set(repo.domain, lotIndex + 1);

    if (!lot) {
      throw new Error(`Missing lot mapping for ${repo.domain} at index ${lotIndex}`);
    }

    const score = scoreRepo(repo);
    const width = clamp(5.6 + Math.log10(repo.totalStars + 10) * 1.5, 6.2, 12.5);
    const depth = clamp(5.4 + Math.sqrt(repo.updateEvents7d) * 0.52, 6.0, 11.8);
    const height = clamp(12 + score * 0.58, 14, 40);

    return {
      ...repo,
      color: district.color,
      score: Number(score.toFixed(1)),
      width: Number(width.toFixed(1)),
      depth: Number(depth.toFixed(1)),
      lotWidth: Number((width + 4.2).toFixed(1)),
      lotDepth: Number((depth + 4.2).toFixed(1)),
      height: Number(height.toFixed(1)),
      lightStrength: Number((repo.updateEvents7d / maxUpdates).toFixed(2)),
      x: Number((district.center.x + lot.x).toFixed(1)),
      z: Number((district.center.z + lot.z).toFixed(1)),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    demoMode: true,
    stats: {
      trackedRepos: repos.length,
      newRepos24h: repos.filter((repo) => repo.createdDaysAgo <= 1).length,
      starsAdded7d: repos.reduce((sum, repo) => sum + repo.starDelta7d, 0),
      updates7d: repos.reduce((sum, repo) => sum + repo.updateEvents7d, 0),
    },
    districts,
    repos: repos.sort((a, b) => b.score - a.score),
  };
};
