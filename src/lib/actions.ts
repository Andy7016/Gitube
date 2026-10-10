/** 卡片、详情页共用的快捷操作 */
import { followUser } from '../api/github'
import type { Repo } from '../api/types'
import { useAuth } from '../store/auth'
import { DEFAULT_FOLDER_ID, useLibrary, type DislikeReason } from '../store/library'
import { useFeed } from '../store/feed'
import { useStars } from '../store/stars'
import { toast } from '../store/toast'
import { useSaveDialog } from '../store/ui'
import { cloneCommand, copyText } from './format'

const isSaved = (repo: Repo) =>
  useLibrary.getState().folders.some((f) => f.items.some((i) => i.repo.nameWithOwner === repo.nameWithOwner))

/** 一键收藏：没收藏过就直接放进默认收藏夹；收藏过就打开收藏夹选择 */
export function quickSave(repo: Repo) {
  if (isSaved(repo)) {
    useSaveDialog.getState().open(repo)
    return
  }
  useLibrary.getState().quickSave(repo)
  const name = useLibrary.getState().folders.find((f) => f.id === DEFAULT_FOLDER_ID)?.name ?? '默认收藏夹'
  toast(`已收藏到「${name}」`, { label: '换收藏夹', onClick: () => useSaveDialog.getState().open(repo) })
}

export function toggleLater(repo: Repo) {
  const added = useLibrary.getState().toggleLater(repo)
  toast(added ? '已加入稍后再看' : '已移出稍后再看', {
    label: '撤销',
    onClick: () => useLibrary.getState().toggleLater(repo),
  })
}

export async function copyClone(repo: Repo) {
  const ok = await copyText(cloneCommand(repo.nameWithOwner))
  toast(ok ? '已复制 git clone 命令' : '复制失败，请手动复制')
}

export function dislike(repo: Repo, reason: DislikeReason) {
  useLibrary.getState().dislike(repo, reason)
  const label =
    reason.type === 'repo'
      ? '将减少推荐类似项目'
      : reason.type === 'topic'
        ? `不再推荐 #${reason.topic}`
        : `不再推荐 ${reason.lang} 项目`
  useFeed.getState().dismiss(repo.nameWithOwner, { label, reason })
}

export function undoDislike(repo: Repo, reason: DislikeReason) {
  useLibrary.getState().undoDislike(repo, reason)
  useFeed.getState().undismiss(repo.nameWithOwner)
}

/**
 * 一键三连（长按 Star 按钮）：Star + 收藏 + 关注作者
 * 关注作者需要 token 有 user:follow 权限，没有也不影响前两项。
 */
export async function tripleAction(repo: Repo) {
  const viewer = useAuth.getState().viewer
  const starred = useStars.getState().ensureStarred(repo)
  if (!isSaved(repo)) useLibrary.getState().quickSave(repo)
  const canFollow = repo.ownerType === 'User' && repo.owner !== viewer?.login
  let followed = false
  if (canFollow) {
    try {
      await followUser(repo.owner)
      followed = true
    } catch {
      followed = false
    }
  }
  const ok = await starred
  const done = [ok && ' Star', '收藏', followed && `关注 @${repo.owner}`].filter(Boolean).join('、')
  toast(
    canFollow && !followed
      ? `已${done}（关注作者需要 token 带 user:follow 权限）`
      : `一键三连：已${done}`,
  )
}
