import type { ReactNode } from 'react'

/**
 * Every function of the expanded island (clock, focus, notes, translate, panel) lives in its
 * own block. One shell keeps the radius, border, padding and label rhythm identical.
 */
export function Block({
  label,
  slot,
  children,
  className = '',
  bodyClassName = ''
}: {
  label: string
  slot?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}): JSX.Element {
  return (
    <section
      className={`flex min-h-0 flex-col rounded-2xl border border-white/[0.055] bg-white/[0.045] px-2.5 py-2 ${className}`}
    >
      <header className="mb-1 flex shrink-0 items-center justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-white/40">
          {label}
        </span>
        {slot}
      </header>
      <div className={`flex min-h-0 flex-1 flex-col ${bodyClassName}`}>{children}</div>
    </section>
  )
}
