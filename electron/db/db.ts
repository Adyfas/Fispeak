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
  connection = db
  logger.info('db', 'database ready', { file })
  return db
}

export function closeDb(): void {
  connection?.close()
  connection = null
}
