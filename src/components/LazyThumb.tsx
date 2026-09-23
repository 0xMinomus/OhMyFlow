import { useEffect, useRef, useState } from 'react'
import type { PhotoItem } from '@/types'
import { fetchThumb, getMemThumb } from '@/lib/thumbCache'

export function LazyThumb({ item, className }: { item: PhotoItem; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null | undefined>(() => {
    const m = getMemThumb(item.filePath)
    if (m !== undefined) return m
    return item.thumbUrl ?? undefined
  })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (url !== undefined) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          ob.disconnect()
        }
      },
      { rootMargin: '400px' }
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [item.filePath]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (url !== undefined || !visible) return
    let cancelled = false
    fetchThumb(item).then((u) => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [visible, item.filePath]) // eslint-disable-line react-hooks/exhaustive-deps

  if (url === null) {
    return (
      <div ref={ref} className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#e8eff5] px-3">
        <span className="font-sans text-[11px] font-bold tracking-widest">RAW · {item.ext.replace('.', '').toUpperCase()}</span>
        <span className="w7-muted w-full truncate text-center font-sans text-[11px]">{item.fileName}</span>
      </div>
    )
  }

  if (url === undefined) {
    return <div ref={ref} className="h-full w-full animate-pulse bg-[#dbe5ee]" aria-hidden="true" />
  }

  return (
    <div ref={ref} className="w-full h-full">
      <img
        src={url}
        className={className ?? 'w-full h-full object-cover'}
        loading="lazy"
        decoding="async"
        draggable={false}
        alt={item.fileName}
      />
    </div>
  )
}
