import { useEffect, useState } from 'react'
import type { SessionRecord } from '@shared/api'
import { getApi } from '@/lib/ipc'

interface SessionPopupProps {
  open: boolean
  activeSessionId?: string | null
  onClose(): void
  onSelect(sessionId: string): void
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Session list popup shown inside the island (LISTEN/SPEAK). */
export function SessionPopup({ open, activeSessionId, onClose, onSelect }: SessionPopupProps): JSX.Element | null {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (open) void getApi().session.list().then(setSessions)
  }, [open])

  if (!open) return null

  const confirmRename = async (sessionId: string): Promise<void> => {
    if (renameValue.trim()) {
      await getApi().session.rename(sessionId, renameValue.trim())
      setSessions((current) =>
        current.map((s) => (s.id === sessionId ? { ...s, name: renameValue.trim() } : s))
      )
    }
    setRenaming(null)
  }

  const createNew = async (): Promise<void> => {
    const id = await getApi().session.create()
    onSelect(id)
    onClose()
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col rounded-2xl bg-[#141416]">
      <header className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">
          Sessions
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70 transition hover:bg-white/20"
        >
          Close
        </button>
      </header>

      <button
        type="button"
        onClick={() => void createNew()}
        className="mx-3 mt-2 rounded-full bg-[#0A84FF] px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-[#0A84FF]/85"
      >
        + New Session
      </button>

      <div className="mt-2 flex-1 overflow-y-auto px-3 pb-3">
        {sessions.length === 0 && (
          <p className="py-4 text-center text-[11px] text-white/30">No sessions yet.</p>
        )}
        <ul className="flex flex-col gap-1.5">
          {sessions.map((session) => (
            <li
              key={session.id}
              className={`rounded-lg border px-2.5 py-1.5 ${
                activeSessionId === session.id
                  ? 'border-[#0A84FF]/40 bg-[#0A84FF]/10'
                  : 'border-white/[0.06] bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSelect(session.id)
                    onClose()
                  }}
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
                      className="w-full rounded bg-white/10 px-1 py-0.5 text-[11px] text-white/90 outline-none"
                    />
                  ) : (
                    <span className="block truncate text-[11px] text-white/85">{session.name}</span>
                  )}
                  <span className="block text-[9px] text-white/35">
                    {formatTime(session.startedAt)} · {session.turnCount} turns
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(session.id)
                    setRenameValue(session.name)
                  }}
                  className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-white/60 transition hover:bg-white/20"
                >
                  Rename
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
