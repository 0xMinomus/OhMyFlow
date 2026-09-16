import type { ReactNode } from 'react'

export function Fieldset({ num, title, children, className = '' }: {
  num: string
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={`rounded border border-flow-600 min-w-0 ${className}`}>
      <legend className="ml-2 px-2 font-mono text-[13px] font-bold uppercase tracking-[0.18em] text-zinc-300">
        {num}. {title}
      </legend>
      {children}
    </fieldset>
  )
}
