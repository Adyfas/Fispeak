import { useEffect, useState } from 'react'
import { formatClockCompact } from '@/lib/time'
import { PageShell } from './PageShell'

function weekNumber(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1)
  const days = Math.floor((date.getTime() - start.getTime()) / 86_400_000)
  return Math.ceil((days + start.getDay() + 1) / 7)
}

/** Clock feature page: time, date, month, day, year, timezone, week. */
export function ClockPage(): JSX.Element {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const time = formatClockCompact(now)
  const seconds = now.getSeconds().toString().padStart(2, '0')
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now)
  const day = new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(now)
  const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(now)
  const year = now.getFullYear()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offsetMinutes = -now.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60)
  const offsetMins = Math.abs(offsetMinutes) % 60
  const offset = `UTC${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`

  return (
    <PageShell title="Clock" subtitle={`${weekday}, ${day} ${month} ${year}`}>
      <div className="relative flex min-h-0 flex-1 flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5">
        {/* Soft gradient wash, MacIsland-style but static. */}
        <div
          aria-hidden
          className="gradient-aurora pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full opacity-20 blur-2xl"
        />

        <div className="relative flex items-start justify-between">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="font-rounded text-[64px] font-semibold leading-none tracking-tight tabular-nums text-white">
                {time}
              </span>
              <span className="text-[16px] font-medium tabular-nums text-white/35">{seconds}</span>
            </div>
            <p className="mt-2 text-[13px] text-white/55">
              {weekday}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] uppercase tracking-[0.08em] text-white/45">
              {timezone}
            </span>
            <span className="text-[10px] tabular-nums text-white/35">{offset}</span>
          </div>
        </div>

        <div className="relative grid grid-cols-4 gap-2">
          <Stat label="Day" value={day} />
          <Stat label="Month" value={month} />
          <Stat label="Year" value={String(year)} />
          <Stat label="Week" value={String(weekNumber(now))} />
        </div>
      </div>
    </PageShell>
  )
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-black/25 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-white/35">{label}</p>
      <p className="font-rounded truncate text-[15px] font-medium text-white/85">{value}</p>
    </div>
  )
}
