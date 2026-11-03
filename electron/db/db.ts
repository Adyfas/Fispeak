import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import schema from './schema.sql?raw'
import { logger } from '../logger'

let connection: Database.Database | null = null

export function getDb(): Database.Database {
  if (connection) return connection
  const file = join(app.getPath('userData'), 'fispeak.db')
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(schema)
  // Existing databases predate the checklist column; CREATE TABLE IF NOT EXISTS is a no-op
  // there, so add it once and let the logger record the upgrade.
  const columns = db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'items')) {
    db.exec('ALTER TABLE notes ADD COLUMN items TEXT')
    logger.info('db', 'notes table upgraded with checklist items')
  }

  // M3.7: sessions gained name/status/tts_model/tts_voice. CREATE TABLE IF NOT EXISTS does not
  // alter an existing table, so add the columns once for databases created before this revision.
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
  const sessionAdditions: Array<[string, string]> = [
    ['name', "TEXT NOT NULL DEFAULT ''"],
    ['status', "TEXT DEFAULT 'active'"],
    ['tts_model', 'TEXT'],
    ['tts_voice', 'TEXT']
  ]
  for (const [name, definition] of sessionAdditions) {
    if (!sessionColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${definition}`)
      logger.info('db', `sessions table upgraded with ${name}`)
    }
  }

  connection = db
  logger.info('db', 'database ready', { file })
  return db
}

export function closeDb(): void {
  connection?.close()
  connection = null
}
