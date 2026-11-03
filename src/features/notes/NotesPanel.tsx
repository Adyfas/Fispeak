import { useEffect, useRef, useState } from 'react'
import type { ChecklistItem, Note } from '@shared/api'
import { Block } from '@/components/Block'
import { ChecklistIcon } from '@/components/icons'
import { formatRelative } from '@/lib/time'
import { useNotesStore } from '@/stores/notesStore'

function newItem(text: string): ChecklistItem {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, done: false }
}

/** Quick notes: the newest rows stay visible, 50 are kept in SQLite (04b §8). */
export function NotesPanel(): JSX.Element {
  const notes = useNotesStore((state) => state.notes)
  const load = useNotesStore((state) => state.load)
  const add = useNotesStore((state) => state.add)
  const edit = useNotesStore((state) => state.edit)
  const remove = useNotesStore((state) => state.remove)

  const [draft, setDraft] = useState('')
  const [listMode, setListMode] = useState(false)
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
    if (!listMode) {
      await add(body)
      inputRef.current?.focus()
      return
    }
    // A checklist grows item by item: append to the newest list, create one when none exists.
    const target = notes.find((note) => note.items.length > 0)
    if (target) await edit(target.id, target.body, [...target.items, newItem(body)])
    else await add('', [newItem(body)])
    inputRef.current?.focus()
  }

  const commitEdit = async (): Promise<void> => {
    if (!editingId) return
    const body = editingValue.trim()
    const id = editingId
    const target = notes.find((note) => note.id === id)
    setEditingId(null)
    setEditingValue('')
    if (!target) return
    if (!body && target.items.length === 0) return
    await edit(id, body, target.items)
  }

  const toggleItem = async (note: Note, itemId: string): Promise<void> => {
    const items = note.items.map((item) =>
      item.id === itemId ? { ...item, done: !item.done } : item
    )
    await edit(note.id, note.body, items)
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
          ) : note.items.length > 0 ? (
            <div
              key={note.id}
              className="group shrink-0 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/[0.05]"
            >
              <div className="flex items-center gap-2">
                {note.body ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(note.id)
                      setEditingValue(note.body)
                    }}
                    className="min-w-0 flex-1 truncate text-left text-[10px] font-medium text-white/70 hover:text-white"
                    title={note.body}
                  >
                    {note.body}
                  </button>
                ) : (
                  <span className="flex-1 text-[9px] uppercase tracking-wider text-white/25">
                    Checklist
                  </span>
                )}
                <span className="shrink-0 text-[9px] tabular-nums text-white/25">
                  {formatRelative(note.createdAt, now)}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(note.id)}
                  aria-label={`Delete checklist ${note.body}`}
                  className="shrink-0 text-[12px] leading-none text-white/30 opacity-0 transition group-hover:opacity-100 hover:text-white/80"
                >
                  ×
                </button>
              </div>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {note.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void toggleItem(note, item.id)}
                    aria-pressed={item.done}
                    className="flex items-start gap-1.5 rounded px-0.5 py-0.5 text-left transition hover:bg-white/[0.06]"
                  >
                    <span
                      className={`mt-[1px] flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-[3px] border transition ${
                        item.done
                          ? 'border-[#4CD964] bg-[#4CD964] text-[#0b0b0d]'
                          : 'border-white/25 bg-transparent'
                      }`}
                      aria-hidden
                    >
                      {item.done && (
                        <svg viewBox="0 0 12 12" className="h-2 w-2" fill="none" stroke="currentColor" strokeWidth={2.4}>
                          <path d="M2.5 6.2l2.2 2.2 4.8-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span
                      className={`min-w-0 flex-1 text-[10px] leading-tight transition-colors ${
                        item.done ? 'text-white/28 line-through' : 'text-white/75'
                      }`}
                    >
                      {item.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
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
          placeholder={listMode ? 'Add checklist item…' : 'Add a note…'}
          aria-label={listMode ? 'New checklist item' : 'New note'}
          className="w-full rounded-lg border border-white/[0.08] bg-black/25 py-1.5 pl-2.5 pr-[52px] text-[11px] text-white placeholder:text-white/25 transition focus:border-white/25 focus:bg-black/40 focus:outline-none"
        />
        <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setListMode((value) => !value)
              inputRef.current?.focus()
            }}
            aria-label="Checklist mode"
            aria-pressed={listMode}
            title={listMode ? 'Checklist mode on' : 'Add to a checklist'}
            className={`flex h-5 w-5 items-center justify-center rounded-md transition ${
              listMode
                ? 'bg-[#4CD964]/20 text-[#4CD964]'
                : 'text-white/30 hover:bg-white/10 hover:text-white/70'
            }`}
          >
            <ChecklistIcon className="h-3 w-3" />
          </button>
          <span className="pointer-events-none text-[9px] text-white/20">⏎</span>
        </span>
      </div>
    </Block>
  )
}
