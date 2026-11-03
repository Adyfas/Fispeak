import type { ChecklistItem, Note } from '@shared/api'
import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/** Notes are rotated: the newest 50 survive (04b §8). */
export const MAX_NOTES = 50

interface NoteRow {
  id: string
  body: string
  items: string | null
  createdAt: number
  pinned: number
}

function parseItems(raw: string | null): ChecklistItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is ChecklistItem => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : randomUUID(),
        text: typeof item.text === 'string' ? item.text : '',
        done: item.done === true
      }))
      .filter((item) => item.text.trim().length > 0)
  } catch {
    return []
  }
}

function normalizeItems(items: ChecklistItem[] | undefined): ChecklistItem[] {
  if (!items?.length) return []
  return items
    .map((item) => ({
      id: item.id || randomUUID(),
      text: String(item.text ?? '').trim(),
      done: item.done === true
    }))
    .filter((item) => item.text.length > 0)
}

export class NotesStore {
  list(): Note[] {
    const rows = getDb()
      .prepare('SELECT id, body, items, created_at as createdAt, pinned FROM notes ORDER BY created_at DESC')
      .all() as NoteRow[]
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      items: parseItems(row.items),
      createdAt: row.createdAt,
      pinned: row.pinned === 1
    }))
  }

  create(body: string, items?: ChecklistItem[]): Note {
    const trimmed = body.trim()
    const checklist = normalizeItems(items)
    if (!trimmed && checklist.length === 0) throw new Error('Note is empty')
    const note: Note = {
      id: randomUUID(),
      body: trimmed,
      items: checklist,
      createdAt: Date.now(),
      pinned: false
    }
    const db = getDb()
    db.prepare('INSERT INTO notes (id, body, created_at, pinned, items) VALUES (?, ?, ?, 0, ?)').run(
      note.id,
      note.body,
      note.createdAt,
      note.items.length > 0 ? JSON.stringify(note.items) : null
    )
    db.prepare(
      'DELETE FROM notes WHERE id NOT IN (SELECT id FROM notes ORDER BY created_at DESC LIMIT ?)'
    ).run(MAX_NOTES)
    return note
  }

  update(id: string, body: string, items?: ChecklistItem[]): Note[] {
    const trimmed = body.trim()
    const checklist = normalizeItems(items)
    if (!trimmed && checklist.length === 0) throw new Error('Note is empty')
    getDb()
      .prepare('UPDATE notes SET body = ?, items = ? WHERE id = ?')
      .run(trimmed, checklist.length > 0 ? JSON.stringify(checklist) : null, id)
    return this.list()
  }

  remove(id: string): Note[] {
    getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
    return this.list()
  }
}
