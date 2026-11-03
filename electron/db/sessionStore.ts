import { randomUUID } from 'node:crypto'
import type { AudioTag, SessionRecord, TakeRecord, TurnRecord } from '@shared/api'
import { getDb } from './db'
import { logger } from '../logger'

interface SessionRow {
  id: string
  name: string
  started_at: number
  ended_at: number | null
  status: string
  my_lang: string | null
  remote_lang: string | null
  whisper_model: string | null
  tts_model: string | null
  tts_voice: string | null
  turn_count: number
}

interface TurnRow {
  id: string
  session_id: string
  tag: AudioTag
  started_ms: number | null
  end_ms: number | null
  src_lang: string | null
  tgt_lang: string | null
  text_src: string | null
  text_tgt: string | null
  confidence: number | null
  quality: string | null
  created_at: number
}

interface TakeRow {
  id: string
  session_id: string
  idx: number
  mode: string
  merged_source: string | null
  merged_translation: string | null
  tts_model: string | null
  tts_voice: string | null
  created_at: number
}

/**
 * Sessions, turns, and takes (10-summary-export §3 + M3.7). The sidecar stays stateless:
 * Electron owns the `session_id` and stores every turn it receives.
 */
export class SessionStore {
  start(options: {
    myLang: string
    remoteLang: string
    whisperModel: string
  }): string {
    const id = randomUUID()
    const db = getDb()
    const name = `Session · ${new Date().toLocaleString('id-ID', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    db.prepare(
      `INSERT INTO sessions (id, name, started_at, status, my_lang, remote_lang, whisper_model, turn_count)
       VALUES (?, ?, ?, 'active', ?, ?, ?, 0)`
    ).run(id, name, Date.now(), options.myLang, options.remoteLang, options.whisperModel)
    logger.info('session', 'session started', { id, name, ...options })
    return id
  }

  resume(sessionId: string): void {
    const db = getDb()
    db.prepare("UPDATE sessions SET status = 'active', ended_at = NULL WHERE id = ?").run(sessionId)
    logger.info('session', 'session resumed', { id: sessionId })
  }

  stop(sessionId: string): void {
    const db = getDb()
    db.prepare("UPDATE sessions SET status = 'closed', ended_at = ? WHERE id = ?").run(Date.now(), sessionId)
    logger.info('session', 'session stopped', { id: sessionId })
  }

  rename(sessionId: string, name: string): void {
    const db = getDb()
    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, sessionId)
    logger.info('session', 'session renamed', { id: sessionId, name })
  }

  /** `turns.id` is the sidecar chunk id, so re-delivered chunks must not duplicate rows. */
  recordTurn(turn: {
    chunkId: string
    sessionId: string
    tag: AudioTag
    startedMs: number
    endedMs: number
    srcLang: string
    tgtLang: string | null
    textSrc: string
    textTgt: string | null
    confidence: number
    quality: string
  }): void {
    const db = getDb()
    db.prepare(
      `INSERT OR REPLACE INTO turns
        (id, session_id, tag, started_ms, end_ms, src_lang, tgt_lang, text_src, text_tgt, confidence, quality, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      turn.chunkId,
      turn.sessionId,
      turn.tag,
      turn.startedMs,
      turn.endedMs,
      turn.srcLang,
      turn.tgtLang,
      turn.textSrc,
      turn.textTgt,
      turn.confidence,
      turn.quality,
      Date.now()
    )
    db.prepare('UPDATE sessions SET turn_count = turn_count + 1 WHERE id = ?').run(turn.sessionId)
  }

  recordTake(take: {
    sessionId: string
    index: number
    mode: 'listen' | 'speak'
    mergedSource: string
    mergedTranslation: string | null
    ttsModel?: string | null
    ttsVoice?: string | null
  }): string {
    const id = randomUUID()
    const db = getDb()
    db.prepare(
      `INSERT INTO takes (id, session_id, idx, mode, merged_source, merged_translation, tts_model, tts_voice, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      take.sessionId,
      take.index,
      take.mode,
      take.mergedSource,
      take.mergedTranslation,
      take.ttsModel ?? null,
      take.ttsVoice ?? null,
      Date.now()
    )
    logger.info('session', 'take recorded', { id, sessionId: take.sessionId, index: take.index })
    return id
  }

  list(limit = 30): SessionRecord[] {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id, name, started_at, ended_at, status, my_lang, remote_lang, whisper_model, tts_model, tts_voice, turn_count
         FROM sessions ORDER BY started_at DESC LIMIT ?`
      )
      .all(limit) as SessionRow[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name || `Session · ${new Date(row.started_at).toLocaleDateString()}`,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: (row.status as 'active' | 'paused' | 'closed') || 'closed',
      myLang: row.my_lang ?? 'id',
      remoteLang: row.remote_lang ?? 'auto',
      whisperModel: row.whisper_model ?? 'small',
      ttsModel: row.tts_model,
      ttsVoice: row.tts_voice,
      turnCount: row.turn_count
    }))
  }

  turns(sessionId: string): TurnRecord[] {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id, session_id, tag, started_ms, end_ms, src_lang, tgt_lang, text_src, text_tgt,
                confidence, quality, created_at
         FROM turns WHERE session_id = ? ORDER BY started_ms ASC`
      )
      .all(sessionId) as TurnRow[]
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      tag: row.tag,
      startedMs: row.started_ms ?? 0,
      endedMs: row.end_ms ?? 0,
      srcLang: row.src_lang ?? '',
      tgtLang: row.tgt_lang,
      textSrc: row.text_src ?? '',
      textTgt: row.text_tgt,
      confidence: row.confidence ?? 0,
      quality: row.quality ?? 'ok',
      createdAt: row.created_at
    }))
  }

  takes(sessionId: string): TakeRecord[] {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT id, session_id, idx, mode, merged_source, merged_translation, tts_model, tts_voice, created_at
         FROM takes WHERE session_id = ? ORDER BY idx ASC`
      )
      .all(sessionId) as TakeRow[]
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      index: row.idx,
      mode: (row.mode as 'listen' | 'speak') || 'listen',
      mergedSource: row.merged_source,
      mergedTranslation: row.merged_translation,
      ttsModel: row.tts_model,
      ttsVoice: row.tts_voice,
      createdAt: row.created_at
    }))
  }
}
