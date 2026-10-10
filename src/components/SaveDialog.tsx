import { useEffect, useRef, useState } from 'react'
import { FolderPlus, X } from 'lucide-react'
import { useLibrary } from '../store/library'
import { toast } from '../store/toast'
import { useSaveDialog } from '../store/ui'
import { Cover } from './Cover'

/** 「收藏到…」弹窗：勾选要放进哪些收藏夹，也可以新建 */
export function SaveDialog() {
  const repo = useSaveDialog((s) => s.repo)
  const close = useSaveDialog((s) => s.close)
  const folders = useLibrary((s) => s.folders)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!repo) return
    const inFolders = useLibrary
      .getState()
      .folders.filter((f) => f.items.some((i) => i.repo.nameWithOwner === repo.nameWithOwner))
      .map((f) => f.id)
    setChecked(new Set(inFolders.length ? inFolders : ['default']))
    setCreating(false)
    setNewName('')
    dialog.current?.showModal()
  }, [repo])

  useEffect(() => {
    if (!repo) dialog.current?.close()
  }, [repo])

  if (!repo) return <dialog ref={dialog} className="dialog" />

  const toggle = (id: string) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChecked(next)
  }

  const create = () => {
    const name = newName.trim()
    if (!name) return
    const id = useLibrary.getState().createFolder(name)
    setChecked(new Set([...checked, id]))
    setCreating(false)
    setNewName('')
  }

  const confirm = () => {
    useLibrary.getState().setFolders(repo, [...checked])
    toast(checked.size ? `已保存到 ${checked.size} 个收藏夹` : '已取消收藏')
    close()
  }

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="save-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close()
      }}
    >
      <div className="dialog__panel">
        <header className="dialog__head">
          <h2 id="save-title">收藏到…</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={close}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog__repo">
          <div className="dialog__thumb">
            <Cover repo={repo} stats={false} />
          </div>
          <div>
            <strong>{repo.name}</strong>
            <p>{repo.owner}</p>
          </div>
        </div>
        <ul className="folder-list">
          {folders.map((f, i) => (
            <li key={f.id}>
              <label className="check">
                <input
                  type="checkbox"
                  autoFocus={i === 0}
                  checked={checked.has(f.id)}
                  onChange={() => toggle(f.id)}
                />
                <span className="check__name">{f.name}</span>
                <span className="check__count">{f.items.length}</span>
              </label>
            </li>
          ))}
        </ul>
        {creating ? (
          <form
            className="new-folder"
            onSubmit={(e) => {
              e.preventDefault()
              create()
            }}
          >
            <input
              autoFocus
              className="input"
              placeholder="收藏夹名称，例如：毕设参考"
              maxLength={30}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button type="submit" className="btn" disabled={!newName.trim()}>
              创建
            </button>
          </form>
        ) : (
          <button type="button" className="text-btn new-folder-btn" onClick={() => setCreating(true)}>
            <FolderPlus size={16} aria-hidden="true" /> 新建收藏夹
          </button>
        )}
        <footer className="dialog__foot">
          <button type="button" className="btn btn--ghost" onClick={close}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={confirm}>
            确定
          </button>
        </footer>
      </div>
    </dialog>
  )
}
