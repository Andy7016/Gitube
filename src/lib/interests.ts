/**
 * 兴趣标签：首次登录时让用户挑选（像 B 站的「选择你感兴趣的分区」），
 * 每个标签对应一个或多个 GitHub topic。
 */
export interface Interest {
  id: string
  label: string
  topics: string[]
}

export const INTERESTS: Interest[] = [
  { id: 'llm', label: '大模型 / LLM', topics: ['llm', 'large-language-models', 'ai-agents'] },
  { id: 'ml', label: '机器学习', topics: ['machine-learning', 'deep-learning', 'pytorch'] },
  { id: 'cv', label: '计算机视觉', topics: ['computer-vision', 'image-processing'] },
  { id: 'nlp', label: '自然语言处理', topics: ['nlp', 'natural-language-processing'] },
  { id: 'bioinfo', label: '生物信息', topics: ['bioinformatics', 'genomics', 'computational-biology'] },
  { id: 'chem', label: '药物发现 / 化学信息', topics: ['drug-discovery', 'cheminformatics', 'molecular-dynamics'] },
  { id: 'protein', label: '蛋白质结构', topics: ['protein-structure', 'protein-design', 'alphafold'] },
  { id: 'datasci', label: '数据科学', topics: ['data-science', 'data-visualization', 'jupyter'] },
  { id: 'frontend', label: '前端', topics: ['frontend', 'react', 'vue'] },
  { id: 'backend', label: '后端', topics: ['backend', 'api', 'microservices'] },
  { id: 'python', label: 'Python', topics: ['python'] },
  { id: 'rust', label: 'Rust', topics: ['rust'] },
  { id: 'go', label: 'Go', topics: ['golang', 'go'] },
  { id: 'cpp', label: 'C / C++', topics: ['cpp', 'c'] },
  { id: 'cli', label: '命令行工具', topics: ['cli', 'terminal'] },
  { id: 'devtools', label: '开发者工具', topics: ['developer-tools', 'productivity'] },
  { id: 'selfhosted', label: '自托管', topics: ['self-hosted', 'homelab'] },
  { id: 'database', label: '数据库', topics: ['database', 'sql'] },
  { id: 'devops', label: '运维 / 云原生', topics: ['kubernetes', 'devops', 'docker'] },
  { id: 'security', label: '网络安全', topics: ['security', 'cybersecurity'] },
  { id: 'mobile', label: '移动开发', topics: ['android', 'ios', 'flutter'] },
  { id: 'game', label: '游戏开发', topics: ['game-development', 'game-engine'] },
  { id: 'learning', label: '学习资源', topics: ['awesome', 'tutorial', 'interview'] },
  { id: 'chinese', label: '中文社区', topics: ['chinese'] },
]

export const INTEREST_BY_ID = new Map(INTERESTS.map((i) => [i.id, i]))

/** 太泛、对推荐没帮助的 topic */
export const TOPIC_STOPLIST = new Set([
  'hacktoberfest',
  'hacktoberfest2020',
  'hacktoberfest2021',
  'hacktoberfest2022',
  'hacktoberfest2023',
  'hacktoberfest2024',
  'hacktoberfest2025',
  'open-source',
  'opensource',
  'github',
  'good-first-issue',
  'free',
  'hacktober',
])

/** 根据用户已 Star 仓库的 topic，猜他可能感兴趣的标签（用于预选） */
export function suggestInterests(topicCounts: Map<string, number>): string[] {
  const scored = INTERESTS.map((i) => ({
    id: i.id,
    score: i.topics.reduce((s, t) => s + (topicCounts.get(t) ?? 0), 0),
  }))
  return scored
    .filter((s) => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((s) => s.id)
}
