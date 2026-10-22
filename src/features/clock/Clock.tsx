import { useEffect, useState } from 'react'
import { formatClock, formatClockCompact } from '@/lib/time'

export function Clock({
  className,
  hour12,
  compact = false
}: {
  className?: string
  hour12?: boolean
  compact?: boolean
}): JSX.Element {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <span className={className} aria-label="Current time">
      {compact ? formatClockCompact(now, { hour12 }) : formatClock(now, { hour12 })}
    </span>
  )
}
