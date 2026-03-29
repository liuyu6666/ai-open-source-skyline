import { loadMaterializedSkylineSnapshot } from "@/lib/skyline-db";

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

type GitHubSearchResponse = {
  items: GitHubRepository[];
};

type GitHubRepository = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  owner: {
    login: string;
  };
  created_at: string;
  pushed_at: string;
};

type GitHubEvent = {
  type: string;
  created_at: string;
  actor?: {
    login?: string;
  };
};

type SearchSeed = {
  domain: DomainKey;
  perPage: number;
  query: string;
  sort: "updated" | "stars";
};

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const liveCacheTtlMs = 12 * 60 * 1000;
const extraLiveRepoCount = 72;

const districts: DistrictRecord[] = [
  {
    id: "agents",
    color: "#7dd3fc",
    center: { x: -42, z: -24 },
    size: { width: 112, depth: 86 },
  },
  {
    id: "tooling",
    color: "#f9a8d4",
    center: { x: 44, z: -16 },
    size: { width: 108, depth: 84 },
  },
  {
    id: "automation",
    color: "#c4b5fd",
    center: { x: 4, z: 14 },
    size: { width: 132, depth: 102 },
  },
  {
    id: "inference",
    color: "#fcd34d",
    center: { x: -34, z: 62 },
    size: { width: 104, depth: 82 },
  },
  {
    id: "memory",
    color: "#86efac",
    center: { x: 40, z: 66 },
    size: { width: 104, depth: 82 },
  },
];

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
      en: "Vector store with broad usage but calmer week-on-week momentum.",
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
const curatedLiveRepoSeeds = rawRepos
  .filter((repo) => repo.fullName !== "mshumer/WebVoyager")
  .map((repo) => ({
    domain: repo.domain,
    fullName: repo.fullName,
  }));

let cachedLiveSnapshot: SkylineSnapshot | null = null;
let cachedLiveAt = 0;
let liveInFlight: Promise<SkylineSnapshot | null> | null = null;

const updateEventTypes = new Set([
  "PushEvent",
  "PullRequestEvent",
  "IssuesEvent",
  "PullRequestReviewEvent",
  "IssueCommentEvent",
  "ReleaseEvent",
  "CreateEvent",
]);

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const scoreRepo = (repo: RawRepo) => {
  const starBase = Math.log10(repo.totalStars + 1) * 12;
  const weeklyStarVelocity = repo.starDelta7d * 0.018;
  const updateSignal = repo.updateEvents7d * 0.52;
  const contributorSignal = repo.contributors30d * 0.44;
  const newbornBoost =
    repo.createdDaysAgo <= 1 ? 11 : repo.createdDaysAgo <= 7 ? 8 : repo.createdDaysAgo <= 30 ? 4 : 0;

  return starBase + weeklyStarVelocity + updateSignal + contributorSignal + newbornBoost;
};

const hashValue = (seed: number) => {
  const value = Math.sin(seed) * 43758.5453123;

  return value - Math.floor(value);
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const daysSince = (isoString: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / dayMs));

const hoursSince = (isoString: string) =>
  Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / hourMs));

const normalizeDescription = (value: string | null | undefined, fallback: string) => {
  const nextValue = value?.trim();

  return nextValue && nextValue.length > 0 ? nextValue : fallback;
};

const buildChineseLiveDescription = (
  domain: DomainKey,
  repo: GitHubRepository,
  starDelta7d: number,
  updateEvents7d: number,
) => {
  const domainLabel: Record<DomainKey, string> = {
    agents: "代理系统",
    tooling: "开发工具",
    automation: "浏览器自动化",
    inference: "推理与服务",
    memory: "记忆与数据",
  };

  return `${repo.name} 属于${domainLabel[domain]}方向，当前 ${repo.stargazers_count.toLocaleString("zh-CN")} star，最近 7 天记录到 ${starDelta7d.toLocaleString("zh-CN")} 次 star 事件和 ${updateEvents7d.toLocaleString("zh-CN")} 次公开更新。`;
};

const createLotOffsets = (district: DistrictRecord, count: number) => {
  const offsets: { x: number; z: number }[] = [];
  const downtownCore = { x: 6, z: 14 };
  const driftX = (downtownCore.x - district.center.x) * 0.12;
  const driftZ = (downtownCore.z - district.center.z) * 0.12;
  const baseAngle = Math.atan2(
    district.center.z - downtownCore.z,
    district.center.x - downtownCore.x,
  );

  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      offsets.push({ x: 0, z: 0 });
      continue;
    }

    const ring = Math.ceil(Math.sqrt(index));
    const ringStart = (ring - 1) * (ring - 1) + 1;
    const slot = index - ringStart;
    const slotCount = Math.max(5, ring * 6);
    const seed = count * 31 + index * 17 + district.center.x * 0.4;
    const angle =
      baseAngle +
      (slot / slotCount) * Math.PI * 1.88 +
      (hashValue(seed) - 0.5) * 0.38;
    const radiusX = Math.min(
      district.size.width * 0.46,
      9 + ring * 7.2 + hashValue(seed + 5.1) * 3.6,
    );
    const radiusZ = Math.min(
      district.size.depth * 0.46,
      8 + ring * 6.8 + hashValue(seed + 9.7) * 3,
    );
    const spreadX =
      Math.cos(angle) * radiusX +
      driftX * ring +
      (hashValue(seed + 2.2) - 0.5) * 2.8;
    const spreadZ =
      Math.sin(angle) * radiusZ +
      driftZ * ring +
      (hashValue(seed + 6.4) - 0.5) * 2.5;

    offsets.push({
      x: Number(spreadX.toFixed(1)),
      z: Number(spreadZ.toFixed(1)),
    });
  }

  offsets.sort((left, right) => {
    const leftWeight = Math.hypot(left.x - driftX * 2, left.z - driftZ * 2);
    const rightWeight = Math.hypot(right.x - driftX * 2, right.z - driftZ * 2);

    return leftWeight - rightWeight;
  });

  return offsets.slice(0, count);
};

const buildSkylineSnapshot = (
  sourceRepos: RawRepo[],
  { demoMode }: { demoMode: boolean },
): SkylineSnapshot => {
  const scoredRepos = sourceRepos
    .map((repo) => ({ repo, score: scoreRepo(repo) }))
    .sort((left, right) => right.score - left.score);

  const grouped = new Map<DomainKey, { repo: RawRepo; score: number }[]>();

  for (const entry of scoredRepos) {
    const bucket = grouped.get(entry.repo.domain) ?? [];
    bucket.push(entry);
    grouped.set(entry.repo.domain, bucket);
  }

  const lotsByRepoId = new Map<string, { x: number; z: number }>();

  for (const [domain, items] of grouped) {
    const district = districtIndex.get(domain);

    if (!district) {
      continue;
    }

    const offsets = createLotOffsets(district, items.length);

    items.forEach((entry, index) => {
      const lot = offsets[index];

      if (!lot) {
        return;
      }

      lotsByRepoId.set(entry.repo.id, {
        x: Number((district.center.x + lot.x).toFixed(1)),
        z: Number((district.center.z + lot.z).toFixed(1)),
      });
    });
  }

  const maxUpdates = Math.max(1, ...sourceRepos.map((repo) => repo.updateEvents7d));

  const repos = scoredRepos.map(({ repo, score }) => {
    const district = districtIndex.get(repo.domain);
    const lot = lotsByRepoId.get(repo.id);

    if (!district || !lot) {
      throw new Error(`Missing skyline layout for ${repo.fullName}`);
    }

    const width = clamp(6.3 + Math.log10(repo.totalStars + 10) * 1.45, 7.1, 14.4);
    const depth = clamp(6.2 + Math.sqrt(repo.updateEvents7d + 1) * 0.48, 7.1, 13.8);
    const height = clamp(17 + score * 0.76, 21, 74);

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
      x: lot.x,
      z: lot.z,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    demoMode,
    stats: {
      trackedRepos: repos.length,
      newRepos24h: repos.filter((repo) => repo.createdDaysAgo <= 1).length,
      starsAdded7d: repos.reduce((sum, repo) => sum + repo.starDelta7d, 0),
      updates7d: repos.reduce((sum, repo) => sum + repo.updateEvents7d, 0),
    },
    districts,
    repos,
  };
};

const getDemoSkylineSnapshot = () => buildSkylineSnapshot(rawRepos, { demoMode: true });

const getLiveToken = () =>
  process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || null;

const buildLiveSearchSeeds = (): SearchSeed[] => {
  const recentDate = toIsoDate(new Date(Date.now() - 120 * dayMs));
  const activeDate = toIsoDate(new Date(Date.now() - 45 * dayMs));

  return [
    {
      domain: "agents",
      perPage: 22,
      query: `agent ai in:name,description created:>=${recentDate} archived:false mirror:false stars:>3`,
      sort: "updated",
    },
    {
      domain: "agents",
      perPage: 22,
      query:
        `("ai agent" OR "agent framework" OR "multi-agent" OR "agent sdk") in:name,description pushed:>=${activeDate} archived:false mirror:false stars:>6`,
      sort: "updated",
    },
    {
      domain: "agents",
      perPage: 18,
      query:
        `("ai agent" OR "agent framework" OR "multi-agent") in:name,description stars:>20 archived:false mirror:false`,
      sort: "stars",
    },
    {
      domain: "agents",
      perPage: 18,
      query: `topic:agent archived:false mirror:false stars:>8`,
      sort: "updated",
    },
    {
      domain: "tooling",
      perPage: 22,
      query:
        `("coding assistant" OR copilot OR "ai coding" OR "code agent") in:name,description created:>=${recentDate} archived:false mirror:false stars:>3`,
      sort: "updated",
    },
    {
      domain: "tooling",
      perPage: 22,
      query:
        `("coding assistant" OR "ai coding" OR copilot OR "code agent") in:name,description pushed:>=${activeDate} archived:false mirror:false stars:>6`,
      sort: "updated",
    },
    {
      domain: "tooling",
      perPage: 18,
      query:
        `("coding assistant" OR "ai coding" OR copilot OR "code agent") in:name,description stars:>20 archived:false mirror:false`,
      sort: "stars",
    },
    {
      domain: "tooling",
      perPage: 18,
      query: `("model context protocol" OR mcp OR "ai editor") in:name,description archived:false mirror:false stars:>6`,
      sort: "updated",
    },
    {
      domain: "automation",
      perPage: 22,
      query:
        `("browser automation" OR "computer use" OR "browser agent" OR "web agent") in:name,description created:>=${recentDate} archived:false mirror:false stars:>3`,
      sort: "updated",
    },
    {
      domain: "automation",
      perPage: 22,
      query:
        `("browser automation" OR "computer use" OR "browser agent" OR "web agent") in:name,description pushed:>=${activeDate} archived:false mirror:false stars:>6`,
      sort: "updated",
    },
    {
      domain: "automation",
      perPage: 18,
      query:
        `("browser automation" OR "computer use" OR "browser agent" OR "web agent") in:name,description stars:>10 archived:false mirror:false`,
      sort: "stars",
    },
    {
      domain: "automation",
      perPage: 18,
      query: `(playwright OR puppeteer OR selenium OR "computer use") in:name,description archived:false mirror:false stars:>8`,
      sort: "updated",
    },
    {
      domain: "inference",
      perPage: 22,
      query:
        `("inference engine" OR "llm serving" OR "inference server" OR "llm runtime") in:name,description created:>=${recentDate} archived:false mirror:false stars:>3`,
      sort: "updated",
    },
    {
      domain: "inference",
      perPage: 22,
      query:
        `("llm serving" OR "inference server" OR "inference runtime" OR "inference engine") in:name,description pushed:>=${activeDate} archived:false mirror:false stars:>6`,
      sort: "updated",
    },
    {
      domain: "inference",
      perPage: 18,
      query:
        `("llm serving" OR "inference server" OR "inference runtime" OR "inference engine") in:name,description stars:>20 archived:false mirror:false`,
      sort: "stars",
    },
    {
      domain: "inference",
      perPage: 18,
      query:
        `("model gateway" OR "llm gateway" OR "llm proxy" OR "model router") in:name,description archived:false mirror:false stars:>8`,
      sort: "updated",
    },
    {
      domain: "memory",
      perPage: 22,
      query:
        `("agent memory" OR rag OR "vector database" OR "knowledge base") in:name,description created:>=${recentDate} archived:false mirror:false stars:>3`,
      sort: "updated",
    },
    {
      domain: "memory",
      perPage: 22,
      query:
        `("agent memory" OR rag OR "vector database" OR "knowledge base") in:name,description pushed:>=${activeDate} archived:false mirror:false stars:>6`,
      sort: "updated",
    },
    {
      domain: "memory",
      perPage: 18,
      query:
        `("agent memory" OR rag OR "vector database" OR "knowledge base") in:name,description stars:>20 archived:false mirror:false`,
      sort: "stars",
    },
    {
      domain: "memory",
      perPage: 18,
      query:
        `("retrieval" OR "vector store" OR "graph rag" OR embeddings) in:name,description archived:false mirror:false stars:>8`,
      sort: "updated",
    },
  ];
};

const fetchGitHubJson = async <T>(path: string, token: string) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ai-open-source-skyline",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    next: {
      revalidate: Math.floor(liveCacheTtlMs / 1000),
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${path}`);
  }

  return (await response.json()) as T;
};

const fetchSearchRepos = async (seed: SearchSeed, token: string) => {
  const search = new URLSearchParams({
    order: "desc",
    per_page: seed.perPage.toString(),
    q: seed.query,
    sort: seed.sort,
  });

  const response = await fetchGitHubJson<GitHubSearchResponse>(
    `/search/repositories?${search.toString()}`,
    token,
  );

  return response.items.map((repo) => ({ domain: seed.domain, repo }));
};

const fetchRepo = async (fullName: string, token: string) =>
  fetchGitHubJson<GitHubRepository>(`/repos/${fullName}`, token);

const computeLiveSignals = (events: GitHubEvent[]) => {
  const starTrend = Array.from({ length: 7 }, () => 0);
  const contributorSet = new Set<string>();
  let starDelta1d = 0;
  let starDelta7d = 0;
  let updateEvents7d = 0;

  for (const event of events) {
    const ageMs = Date.now() - new Date(event.created_at).getTime();

    if (Number.isNaN(ageMs) || ageMs < 0) {
      continue;
    }

    if (event.type === "WatchEvent" && ageMs <= 7 * dayMs) {
      const dayOffset = Math.floor(ageMs / dayMs);
      const trendIndex = 6 - dayOffset;

      if (trendIndex >= 0 && trendIndex < starTrend.length) {
        starTrend[trendIndex] += 1;
      }

      starDelta7d += 1;

      if (ageMs <= dayMs) {
        starDelta1d += 1;
      }
    }

    if (updateEventTypes.has(event.type)) {
      if (ageMs <= 7 * dayMs) {
        updateEvents7d += 1;
      }

      if (ageMs <= 30 * dayMs && event.actor?.login) {
        contributorSet.add(event.actor.login);
      }
    }
  }

  return {
    contributors30d: contributorSet.size,
    starDelta1d,
    starDelta7d,
    trend: starTrend,
    updateEvents7d,
  };
};

const buildLiveRawRepo = async (
  repo: GitHubRepository,
  domain: DomainKey,
  token: string,
): Promise<RawRepo> => {
  const events = await fetchGitHubJson<GitHubEvent[]>(
    `/repos/${repo.full_name}/events?per_page=100`,
    token,
  ).catch(() => [] as GitHubEvent[]);
  const signals = computeLiveSignals(events);
  const fallbackDescription = normalizeDescription(
    repo.description,
    `${repo.name} is an active open-source project inside the AI ecosystem.`,
  );

  return {
    id: repo.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    description: {
      zh: buildChineseLiveDescription(
        domain,
        repo,
        signals.starDelta7d,
        signals.updateEvents7d,
      ),
      en: fallbackDescription,
    },
    domain,
    totalStars: repo.stargazers_count,
    starDelta1d: signals.starDelta1d,
    starDelta7d: signals.starDelta7d,
    updateEvents7d: signals.updateEvents7d,
    contributors30d: signals.contributors30d,
    createdDaysAgo: daysSince(repo.created_at),
    lastPushHoursAgo: hoursSince(repo.pushed_at),
    trend: signals.trend,
  };
};

const rankCandidate = (repo: GitHubRepository) => {
  const freshnessBoost = Math.max(0, 28 - daysSince(repo.created_at)) * 4;

  return repo.stargazers_count + freshnessBoost;
};

const pickBalancedCandidates = (
  candidates: { domain: DomainKey; repo: GitHubRepository }[],
  perDomainLimit: number,
  globalLimit: number,
) => {
  const buckets = new Map<DomainKey, GitHubRepository[]>();

  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.domain) ?? [];
    bucket.push(candidate.repo);
    buckets.set(candidate.domain, bucket);
  }

  const selected: { domain: DomainKey; repo: GitHubRepository }[] = [];

  for (const [domain, bucket] of buckets) {
    bucket
      .sort((left, right) => rankCandidate(right) - rankCandidate(left))
      .slice(0, perDomainLimit)
      .forEach((repo) => selected.push({ domain, repo }));
  }

  return selected
    .sort((left, right) => rankCandidate(right.repo) - rankCandidate(left.repo))
    .slice(0, globalLimit);
};

const getLiveSkylineSnapshot = async () => {
  const token = getLiveToken();

  if (!token) {
    return null;
  }

  const now = Date.now();

  if (cachedLiveSnapshot && now - cachedLiveAt < liveCacheTtlMs) {
    return cachedLiveSnapshot;
  }

  if (liveInFlight) {
    return liveInFlight;
  }

  liveInFlight = (async () => {
    try {
      const seeds = buildLiveSearchSeeds();
      const [curatedRepos, searchResults] = await Promise.all([
        Promise.allSettled(
          curatedLiveRepoSeeds.map(async (seed) => ({
            domain: seed.domain,
            repo: await fetchRepo(seed.fullName, token),
          })),
        ),
        Promise.allSettled(
        seeds.map((seed) => fetchSearchRepos(seed, token)),
        ),
      ]);
      const deduped = new Map<string, { domain: DomainKey; repo: GitHubRepository }>();

      for (const result of curatedRepos) {
        if (result.status !== "fulfilled") {
          console.warn("GitHub skyline curated repo failed", result.reason);
          continue;
        }

        deduped.set(result.value.repo.full_name.toLowerCase(), result.value);
      }

      const searchCandidates: { domain: DomainKey; repo: GitHubRepository }[] = [];

      for (const result of searchResults) {
        if (result.status !== "fulfilled") {
          console.warn("GitHub skyline search seed failed", result.reason);
          continue;
        }

        for (const item of result.value) {
          if (!deduped.has(item.repo.full_name.toLowerCase())) {
            searchCandidates.push(item);
          }
        }
      }

      for (const item of pickBalancedCandidates(searchCandidates, 14, extraLiveRepoCount)) {
        deduped.set(item.repo.full_name.toLowerCase(), item);
      }

      const selected = [...deduped.values()];

      if (selected.length < 6) {
        console.warn("GitHub skyline live snapshot fell back to demo due to low repo count", {
          deduped: deduped.size,
          selected: selected.length,
        });
        return null;
      }

      const liveRepos = await Promise.all(
        selected.map((item) => buildLiveRawRepo(item.repo, item.domain, token)),
      );
      const snapshot = buildSkylineSnapshot(liveRepos, { demoMode: false });

      cachedLiveSnapshot = snapshot;
      cachedLiveAt = Date.now();

      return snapshot;
    } catch (error) {
      console.error("Failed to build live skyline snapshot", error);

      return null;
    } finally {
      liveInFlight = null;
    }
  })();

  return liveInFlight;
};

export async function getSkylineSnapshot(): Promise<SkylineSnapshot> {
  const materializedSnapshot = await loadMaterializedSkylineSnapshot();

  if (materializedSnapshot) {
    return materializedSnapshot;
  }

  const liveSnapshot = await getLiveSkylineSnapshot();

  return liveSnapshot ?? getDemoSkylineSnapshot();
}
