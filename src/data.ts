export interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  owner: { login: string; avatar_url: string };
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics: string[];
  updated_at: string;
  license: { spdx_id: string } | null;
  homepage: string | null;
  open_issues_count: number;
  viewer_starred?: boolean;
  cover_url?: string;
  created_at?: string;
}
export interface RepoDetailData {
  repo: Repo;
  defaultBranch: string;
  readme: { content: string; path: string; html_url: string; download_url: string | null } | null;
  readmeError: { code: string; message: string } | null;
}
export function projectPath(repo: Pick<Repo, 'owner' | 'name'>) { return `/project/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}`; }

export const interests = [
  { id: 'artificial-intelligence', label: '人工智能', emoji: '✦', short: 'AI', related: ['ai', 'llm', 'machine-learning', 'artificial-intelligence', 'deep-learning'] },
  { id: 'web-development', label: '前端开发', emoji: '◈', short: 'WEB', related: ['react', 'ui', 'frontend', 'web', 'web-development', 'css', 'nextjs'] },
  { id: 'developer-tools', label: '开发工具', emoji: '⌘', short: 'TOOLS', related: ['developer-tools', 'devtools', 'editor', 'testing', 'productivity', 'build-tool'] },
  { id: 'self-hosted', label: '自托管', emoji: '▤', short: 'SELF-HOST', related: ['self-hosted', 'automation', 'no-code', 'low-code'] },
  { id: 'database', label: '数据与后端', emoji: '◉', short: 'BACKEND', related: ['database', 'backend', 'postgresql', 'api', 'serverless'] },
  { id: 'mobile', label: '移动开发', emoji: '▯', short: 'MOBILE', related: ['mobile', 'android', 'ios', 'flutter', 'react-native'] },
] as const;

export interface Preferences { topics: string[]; languages: string[]; }
export interface RecommendationSignal {
  name: string;
  weight: number;
  evidence: { source: 'starred' | 'owned'; repo: string };
}
export interface RecommendationProfile {
  login: string;
  generatedAt: string;
  counts: { starred: number; owned: number };
  limits: { starred: number; owned: number };
  truncated: { starred: boolean; owned: boolean };
  topics: RecommendationSignal[];
  languages: RecommendationSignal[];
  starredIds: number[];
  ownedIds: number[];
  warnings: string[];
}
export const defaultPreferences: Preferences = { topics: ['artificial-intelligence', 'web-development', 'developer-tools'], languages: [] };
export const languages = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Dart', 'C++', 'Swift'];
export const languageColors: Record<string, string> = { TypeScript: '#3b8ac4', JavaScript: '#e6c747', Python: '#4f81ad', Go: '#32b7ca', Rust: '#d89472', Dart: '#1da2b8', 'C++': '#d1619c', Swift: '#ed854a', CSS: '#9367bd', HTML: '#e7754f', Shell: '#8fb96d' };

export function matchingInterests(repo: Repo) {
  const topics = repo.topics ?? [];
  return interests.filter(interest => interest.related.some(topic => topics.includes(topic)));
}

export function recommendationTopics(manual: Preferences | undefined, profile: RecommendationProfile | null): string[] {
  if (!profile) return (manual || defaultPreferences).topics.slice(0, 5);
  if (!profile.topics.length) return manual?.topics.slice(0, 5) || [];
  if (!manual) return profile.topics.slice(0, 5).map(signal => signal.name);
  const selected = manual.topics.slice(0, 3);
  for (const signal of profile.topics) {
    if (!selected.includes(signal.name)) selected.push(signal.name);
    if (selected.length === 5) break;
  }
  return selected;
}

export function recommendationScore(repo: Repo, manual: Preferences | undefined, profile: RecommendationProfile | null) {
  const topics = new Set(repo.topics.map(topic => topic.toLowerCase()));
  const maxTopic = Math.max(1, ...(profile?.topics.map(signal => signal.weight) || []));
  const maxLanguage = Math.max(1, ...(profile?.languages.map(signal => signal.weight) || []));
  const learnedTopics = profile?.topics.reduce((sum, signal) => sum + (topics.has(signal.name.toLowerCase()) ? signal.weight / maxTopic * 4 : 0), 0) || 0;
  const learnedLanguage = profile?.languages.find(signal => signal.name.toLowerCase() === repo.language?.toLowerCase());
  const chosen = manual || (!profile ? defaultPreferences : undefined);
  const handTopics = matchingInterests(repo).filter(interest => chosen?.topics.includes(interest.id)).length * 2;
  const handLanguage = repo.language && chosen?.languages.includes(repo.language) ? 2 : 0;
  return learnedTopics + (learnedLanguage ? learnedLanguage.weight / maxLanguage * 2 : 0) + handTopics + handLanguage;
}

export function profileReason(repo: Repo, profile: RecommendationProfile | null): string | null {
  if (!profile) return null;
  const topics = new Set(repo.topics.map(topic => topic.toLowerCase()));
  const topicSignal = profile.topics.find(signal => topics.has(signal.name.toLowerCase()));
  const languageSignal = profile.languages.find(signal => signal.name.toLowerCase() === repo.language?.toLowerCase());
  const signal = topicSignal || languageSignal;
  if (!signal?.evidence.repo) return null;
  const evidence = signal.evidence.source === 'starred' ? `因为你 Star 了 ${signal.evidence.repo}` : `与你的 ${signal.evidence.repo} 相关`;
  return !topicSignal && languageSignal ? `${evidence} · ${languageSignal.name}` : evidence;
}

export function formatNumber(value: number) { return value >= 10000 ? `${(value / 10000).toFixed(1).replace(/\.0$/, '')}万` : new Intl.NumberFormat('zh-CN').format(value); }
export function formatRelativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return '最近更新';
  if (seconds < 60) return '刚刚更新';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前更新`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前更新`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}天前更新`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}个月前更新`;
  return `${Math.floor(seconds / 31536000)}年前更新`;
}
export function safeUrl(value: string | null | undefined) { try { const parsed = new URL(value ?? ''); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } }
