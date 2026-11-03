import type { ReactNode } from 'react'

interface PageShellProps {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}

/**
 * One feature page (MacIsland-style): a single wide surface, 16 px padding, one header.
 * The prev/next arrows are rendered by the parent outside this card, never inside.
 */
export function PageShell({ title, subtitle, action, children }: PageShellProps): JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div
        aria-hidden
        className="gradient-aurora pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full opacity-[0.08] blur-2xl"
      />
      <header className="relative flex shrink-0 items-center justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="font-rounded truncate text-[15px] font-semibold tracking-tight text-white">
            {title}
          </h2>
          {subtitle && (
            <p className="truncate text-[10px] text-white/40">{subtitle}</p>
          )}
        </div>
        {action}
      </header>
      <div className="page-enter flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">{children}</div>
    </div>
  )
}
