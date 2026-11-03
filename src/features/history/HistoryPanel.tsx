import { useEffect, useState } from 'react'
import type { SessionRecord, TakeRecord, TurnRecord } from '@shared/api'
import { getApi } from '@/lib/ipc'

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const STATUS_BADGE: Record<SessionRecord['status'], string> = {
  active: 'bg-[#4CD964]/15 text-[#4CD964]',
  paused: 'bg-amber-300/15 text-amber-300/70',
  closed: 'bg-white/8 text-white/40'
}

/** History tab: sessions recorded in SQLite, with rename / resume / takes. */
export function HistoryPanel(): JSX.Element {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [selected, setSelected] = useState<SessionRecord | null>(null)
  const [turns, setTurns] = useState<TurnRecord[]>([])
  const [takes, setTakes] = useState<TakeRecord[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    void getApi().session.list().then(setSessions)
  }, [])

  const openSession = (session: SessionRecord): void => {
    setSelected(session)
    void getApi().session.turns(session.id).then(setTurns).catch(() => setTurns([]))
    void getApi().session.takes(session.id).then(setTakes).catch(() => setTakes([]))
  }

  const startRename = (session: SessionRecord): void => {
    setRenaming(session.id)
    setRenameValue(session.name)
  }

  const confirmRename = async (sessionId: string): Promise<void> => {
    if (renameValue.trim()) {
      await getApi().session.rename(sessionId, renameValue.trim())
      setSessions((current) =>
        current.map((s) => (s.id === sessionId ? { ...s, name: renameValue.trim() } : s))
      )
      if (selected?.id === sessionId) {
        setSelected({ ...selected, name: renameValue.trim() })
      }
    }
    setRenaming(null)
  }

  const resumeSession = async (session: SessionRecord): Promise<void> => {
    await getApi().session.resume(session.id)
    setSessions((current) =>
      current.map((s) => (s.id === session.id ? { ...s, status: 'active' } : s))
    )
  }

  if (sessions.length === 0) {
    return (
      <p className="py-6 text-center text-[11px] text-white/30">No sessions yet.</p>
    )
  }

  return (
    <div className="flex flex-col gap-2 py-1">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`rounded-lg border px-3 py-2 transition ${
            selected?.id === session.id
              ? 'border-white/20 bg-white/[0.07]'
              : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => openSession(session)}
              className="min-w-0 flex-1 text-left"
            >
              {renaming === session.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void confirmRename(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void confirmRename(session.id)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="w-full rounded bg-white/10 px-1.5 py-0.5 text-[12px] text-white/90 outline-none"
                />
              ) : (
                <span className="block truncate text-[12px] text-white/85">{session.name}</span>
              )}
              <span className="block text-[10px] text-white/35">
                {formatTime(session.startedAt)} · {session.myLang.toUpperCase()} ←{' '}
                {session.remoteLang.toUpperCase()} · {session.turnCount} turns
              </span>
            </button>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] ${STATUS_BADGE[session.status]}`}>
              {session.status}
            </span>
          </div>

          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void resumeSession(session)}
              className="rounded-full bg-[#0A84FF] px-2.5 py-0.5 text-[10px] text-white transition hover:bg-[#0A84FF]/85"
            >
              Lanjutkan
            </button>
            <button
              type="button"
              onClick={() => startRename(session)}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70 transition hover:bg-white/20"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => openSession(session)}
              className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70 transition hover:bg-white/20"
            >
              Detail
            </button>
          </div>
        </div>
      ))}

      {selected && (
        <div className="mt-2 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2">
          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40">
            Takes ({takes.length})
          </h4>
          {takes.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-1.5">
              {takes.map((take) => (
                <li key={take.id} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                  <span className="text-[9px] uppercase tracking-[0.08em] text-white/30">
                    Take {take.index + 1} · {take.mode}
                  </span>
                  <p className="text-[11px] text-white/60">{take.mergedSource}</p>
                  {take.mergedTranslation && (
                    <p className="text-[12px] text-white/90">{take.mergedTranslation}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-[11px] text-white/30">No takes yet.</p>
          )}

          <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40">
            Turns ({turns.length})
          </h4>
          {turns.length === 0 ? (
            <p className="text-[11px] text-white/30">This session has no turns.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {turns.map((turn) => (
                <li key={turn.id} className="flex flex-col gap-0.5">
                  <span className="text-[9px] uppercase tracking-[0.08em] text-white/30">
                    {turn.tag === 'you' ? 'You' : 'Remote'} · {turn.srcLang.toUpperCase()}
                  </span>
                  <span className="text-[11px] text-white/60">{turn.textSrc}</span>
                  {turn.textTgt && <span className="text-[12px] text-white/90">{turn.textTgt}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
