import { useEffect, useState } from 'react'
import { formatFullDate } from '@/lib/time'

export function DateLabel({ className }: { className?: string }): JSX.Element {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <span className={className} aria-label="Current date">
      {formatFullDate(now)}
    </span>
  )
}
