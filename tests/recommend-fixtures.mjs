export function repo(name, topics = [], extra = {}) {
  const nameWithOwner = name.includes('/') ? name : `owner-${name}/${name}`
  return {
    id: nameWithOwner, nameWithOwner, name: nameWithOwner.split('/')[1], owner: nameWithOwner.split('/')[0],
    ownerId: `user:${nameWithOwner.split('/')[0]}`, ownerType: 'User', ownerAvatar: '', description: 'A public project',
    url: `https://github.com/${nameWithOwner}`, homepageUrl: null, stars: 100, forks: 2,
    language: 'TypeScript', languageColor: null, topics, pushedAt: new Date().toISOString(),
    createdAt: '2023-01-01T00:00:00Z', viewerHasStarred: false, coverImage: null, isArchived: false,
    license: 'MIT', defaultBranch: 'main', ...extra,
  }
}

export function library(extra = {}) {
  return {
    version: 1, onboarded: true, interests: [], folders: [], later: [], history: [], events: [],
    dislikedRepos: [], blockedTopics: [], blockedLangs: [], seen: {}, recommendationMode: 'normal',
    followingWeights: {}, dwellRecorded: {}, ...extra,
  }
}

export function context(extra = {}) {
  return { seeds: null, lib: library(), following: [], isStarred: () => false, ...extra }
}

export function memoryStorage() {
  const data = new Map()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key), clear: () => data.clear(), data,
  }
}

export function seededRandom(seed = 17) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function candidateSearch(candidates, calls = []) {
  return async (specs) => {
    calls.push(specs)
    return specs.map((spec, i) => ({
      repos: candidates.slice(i * (spec.first ?? 12), (i + 1) * (spec.first ?? 12)),
      endCursor: `cursor-${i}`, hasNextPage: true, total: candidates.length,
    }))
  }
}

export function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
