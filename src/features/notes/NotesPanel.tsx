import { useEffect, useRef, useState } from 'react'
import { Block } from '@/components/Block'
import { formatRelative } from '@/lib/time'
import { useNotesStore } from '@/stores/notesStore'

/** Quick notes: the newest rows stay visible, 50 are kept in SQLite (04b §8). */
export function NotesPanel(): JSX.Element {
  const notes = useNotesStore((state) => state.notes)
  const load = useNotesStore((state) => state.load)
  const add = useNotesStore((state) => state.add)
  const edit = useNotesStore((state) => state.edit)
  const remove = useNotesStore((state) => state.remove)

  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  // Relative timestamps ("5m") only need to be refreshed occasionally.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const submit = async (): Promise<void> => {
    const body = draft.trim()
    if (!body) return
    setDraft('')
    await add(body)
    inputRef.current?.focus()
  }

  const commitEdit = async (): Promise<void> => {
    if (!editingId) return
    const body = editingValue.trim()
    const id = editingId
    setEditingId(null)
    setEditingValue('')
    if (body) await edit(id, body)
  }

  return (
    <Block
      label="Notes"
      className="flex-1"
      slot={<span className="text-[9px] tabular-nums text-white/25">{notes.length}/50</span>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {notes.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-center">
            <p className="text-[10px] leading-relaxed text-white/28">
              No notes yet.
              <br />
              Type below and press Enter.
            </p>
          </div>
        )}

        {notes.slice(0, 8).map((note) =>
          editingId === note.id ? (
            <input
              key={note.id}
              autoFocus
              value={editingValue}
              onChange={(event) => setEditingValue(event.target.value)}
              onBlur={() => void commitEdit()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitEdit()
                if (event.key === 'Escape') {
                  setEditingId(null)
                  setEditingValue('')
                }
              }}
              aria-label="Edit note"
              className="w-full rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white outline-none ring-1 ring-white/25"
            />
          ) : (
            <div
              key={note.id}
              className="group flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/[0.06]"
            >
              <button
                type="button"
                onClick={() => {
                  setEditingId(note.id)
                  setEditingValue(note.body)
                }}
                className="min-w-0 flex-1 truncate text-left text-[11px] leading-tight text-white/80 transition-colors hover:text-white"
                title={note.body}
              >
                {note.body}
              </button>
              <span className="shrink-0 text-[9px] tabular-nums text-white/25">
                {formatRelative(note.createdAt, now)}
              </span>
              <button
                type="button"
                onClick={() => void remove(note.id)}
                aria-label={`Delete note ${note.body}`}
                className="shrink-0 text-[12px] leading-none text-white/30 opacity-0 transition group-hover:opacity-100 hover:text-white/80"
              >
                ×
              </button>
            </div>
          )
        )}
      </div>

      <div className="relative mt-1.5 shrink-0">
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          placeholder="Add a note…"
          aria-label="New note"
          className="w-full rounded-lg border border-white/[0.08] bg-black/25 py-1.5 pl-2.5 pr-11 text-[11px] text-white placeholder:text-white/25 transition focus:border-white/25 focus:bg-black/40 focus:outline-none"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-white/20">
          ⏎
        </span>
      </div>
    </Block>
  )
}
