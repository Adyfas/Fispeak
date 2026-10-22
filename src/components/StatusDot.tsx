export type StatusKind = 'idle' | 'active' | 'warning' | 'error'

const COLORS: Record<StatusKind, string> = {
  idle: 'bg-white/30',
  active: 'bg-[#4CD964]',
  warning: 'bg-[#FFD60A]',
  error: 'bg-[#FF3B30]'
}

export function StatusDot({
  status,
  pulse = false
}: {
  status: StatusKind
  pulse?: boolean
}): JSX.Element {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${COLORS[status]} ${pulse ? 'animate-pulse' : ''}`}
      aria-hidden
    />
  )
}
