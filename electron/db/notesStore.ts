import type { Note } from '@shared/api'
import { randomUUID } from 'node:crypto'
import { getDb } from './db'

/** Notes are rotated: the newest 50 survive (04b §8). */
export const MAX_NOTES = 50

export class NotesStore {
  list(): Note[] {
    const rows = getDb()
      .prepare('SELECT id, body, created_at as createdAt, pinned FROM notes ORDER BY created_at DESC')
      .all() as Array<{ id: string; body: string; createdAt: number; pinned: number }>
    return rows.map((row) => ({ ...row, pinned: row.pinned === 1 }))
  }

  create(body: string): Note {
    const trimmed = body.trim()
    if (!trimmed) throw new Error('Note body is empty')
    const note: Note = {
      id: randomUUID(),
      body: trimmed,
      createdAt: Date.now(),
      pinned: false
    }
    const db = getDb()
    db.prepare('INSERT INTO notes (id, body, created_at, pinned) VALUES (?, ?, ?, 0)').run(
      note.id,
      note.body,
      note.createdAt
    )
    db.prepare(
      'DELETE FROM notes WHERE id NOT IN (SELECT id FROM notes ORDER BY created_at DESC LIMIT ?)'
    ).run(MAX_NOTES)
    return note
  }

  update(id: string, body: string): Note[] {
    const trimmed = body.trim()
    if (!trimmed) throw new Error('Note body is empty')
    getDb().prepare('UPDATE notes SET body = ? WHERE id = ?').run(trimmed, id)
    return this.list()
  }

  remove(id: string): Note[] {
    getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
    return this.list()
  }
}
