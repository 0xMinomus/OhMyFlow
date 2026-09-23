import type { ReactNode } from 'react'

export function Fieldset({ num, title, children, className = '' }: {
  num: string
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={`w7-group min-w-0 ${className}`}>
      <legend className="w7-legend ml-2 px-2 font-sans text-[13px] font-bold uppercase tracking-[0.18em]">
        {num}. {title}
      </legend>
      {children}
    </fieldset>
  )
}
