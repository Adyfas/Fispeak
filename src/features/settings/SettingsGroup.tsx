import type { ReactNode } from 'react'
import type { AiTaskMode } from '@shared/providers'

/**
 * macOS System Settings-style card: icon, title, one-line explanation, then separated rows.
 * The same shell is used by the full panel and the compact island page so the two never drift.
 */
export function SettingsGroup({
  icon,
  title,
  subtitle,
  action,
  children
}: {
  icon?: ReactNode
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025]">
      <header className="flex items-start gap-2.5 px-3.5 pb-1.5 pt-3">
        {icon && (
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-white/60">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-white/85">{title}</span>
          {subtitle && (
            <span className="mt-0.5 block text-[10px] leading-relaxed text-white/35">
              {subtitle}
            </span>
          )}
        </span>
        {action}
      </header>
      <div className="divide-y divide-white/[0.05] px-3.5 pb-1">{children}</div>
    </section>
  )
}

export function SettingsRow({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-[12px] text-white/80">{label}</span>
        {hint && <span className="mt-0.5 block text-[10px] leading-relaxed text-white/30">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">{children}</span>
    </div>
  )
}

const TONE: Record<AiTaskMode, string> = {
  local: 'bg-[#4CD964]/12 text-[#4CD964]',
  cloud: 'bg-[#0A84FF]/15 text-[#6CB6FF]',
  fallback: 'bg-[#FF9F0A]/15 text-[#FFB340]',
  off: 'bg-white/[0.06] text-white/35'
}

const LABEL: Record<AiTaskMode, string> = {
  local: 'Local',
  cloud: 'Cloud',
  fallback: 'Fallback · Local',
  off: 'Off'
}

export function AiModeBadge({
  mode,
  provider,
  compact = false
}: {
  mode: AiTaskMode
  provider?: string
  compact?: boolean
}): JSX.Element {
  const text =
    mode === 'cloud' && provider ? `Cloud · ${provider}` : compact && mode === 'fallback' ? 'Local' : LABEL[mode]
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${TONE[mode]}`}
      title={LABEL[mode]}
    >
      {text}
    </span>
  )
}
