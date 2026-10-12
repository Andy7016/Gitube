import { useState } from 'react'

interface Props {
  src?: string | null
  name: string
  size?: number
  square?: boolean
}

/** 头像；图片加载失败时显示首字母 */
export function Avatar({ src, name, size = 32, square = false }: Props) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size, borderRadius: square ? Math.round(size / 5) : '50%' }
  if (!src || broken) {
    return (
      <span className="avatar avatar--fallback" style={{ ...style, fontSize: size * 0.42 }} aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className="avatar"
      src={src && /^https?:\/\//i.test(src) ? src : undefined}
      alt=""
      width={size}
      height={size}
      style={style}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  )
}
