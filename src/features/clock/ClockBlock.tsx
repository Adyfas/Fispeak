import { useEffect, useState } from 'react'
import { Block } from '@/components/Block'
import { StatusDot, type StatusKind } from '@/components/StatusDot'
import { formatClock, formatDate } from '@/lib/time'

/** Clock block: the idle pill shows the same clock, the expanded card gives it a home. */
export function ClockBlock({ status }: { status: StatusKind }): JSX.Element {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <Block
      label="Clock"
      className="shrink-0"
      bodyClassName="justify-center"
      slot={
        <span className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-[0.08em] text-white/30">
          <StatusDot status={status} /> fispeak
        </span>
      }
    >
      <div className="flex items-end justify-between gap-2">
        <span className="text-[26px] font-semibold leading-none tracking-tight tabular-nums text-white">
          {formatClock(now)}
        </span>
        <span className="pb-0.5 text-[10px] text-white/40">{formatDate(now)}</span>
      </div>
    </Block>
  )
}
