import { useEffect, useState, type ReactNode } from 'react'

/** 需要点两次才执行的按钮（代替浏览器的 confirm 弹窗） */
export function ConfirmButton({
  children,
  confirmText,
  onConfirm,
  className = 'text-btn',
}: {
  children: ReactNode
  confirmText: string
  onConfirm: () => void
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={`${className}${armed ? ' is-danger' : ''}`}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
    >
      {armed ? confirmText : children}
    </button>
  )
}
