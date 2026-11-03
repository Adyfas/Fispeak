import { beforeEach, describe, expect, it } from 'vitest'
import type { SidecarEvent, TranscriptLine } from '@shared/api'
import { useTranslateStore } from './translateStore'

function partialEvent(text: string, windowId = 'remote-1'): SidecarEvent {
  return {
    t: 'partial',
    tag: 'remote',
    window_id: windowId,
    text,
    started_ms: 1_000,
    end_ms: 2_000,
    conf: 0.5,
    session_id: 's-1'
  }
}

function transcriptEvent(text: string, chunkId = 'c-001'): SidecarEvent {
  return {
    t: 'transcript',
    tag: 'remote',
    lang: 'en',
    text,
    conf: 0.9,
    started_ms: 1_000,
    end_ms: 2_500,
    session_id: 's-1',
    chunk_id: chunkId
  }
}

function line(text: string): TranscriptLine {
  return {
    chunkId: 'c-000',
    tag: 'remote',
    srcLang: 'en',
    text,
    translated: null,
    tgtLang: null,
    quality: 'ok',
    startedMs: 500,
    endedMs: 900,
    confidence: 0.9
  }
}

describe('translateStore partial handling', () => {
  beforeEach(() => {
    useTranslateStore.setState({
      lines: [],
      partials: { you: null, remote: null },
      speakTranslation: null,
      sttMode: null,
      lastError: null
    })
  })

  it('replaces the in-progress text instead of appending rows', () => {
    const store = useTranslateStore.getState()
    store.applyEvent(partialEvent('I think we'))
    store.applyEvent(partialEvent('I think we should'))

    const state = useTranslateStore.getState()
    expect(state.lines).toHaveLength(0)
    expect(state.partials.remote?.text).toBe('I think we should')
    expect(state.partials.remote?.windowId).toBe('remote-1')
  })

  it('clears the partial when the commit arrives and keeps one final row', () => {
    const store = useTranslateStore.getState()
    store.applyEvent(partialEvent('I think we should move'))
    store.applyEvent(transcriptEvent('I think we should move the deadline.'))

    const state = useTranslateStore.getState()
    expect(state.partials.remote).toBeNull()
    expect(state.lines).toHaveLength(1)
    expect(state.lines[0].text).toBe('I think we should move the deadline.')
  })

  it('keeps the two speakers independent', () => {
    const store = useTranslateStore.getState()
    store.applyEvent(partialEvent('remote words'))

    const state = useTranslateStore.getState()
    expect(state.partials.remote?.text).toBe('remote words')
    expect(state.partials.you).toBeNull()
  })

  it('drops partials on reset (stop means stop)', () => {
    const store = useTranslateStore.getState()
    store.applyEvent(partialEvent('half a sentence'))
    useTranslateStore.getState().reset()

    const state = useTranslateStore.getState()
    expect(state.partials).toEqual({ you: null, remote: null })
    expect(state.lines).toHaveLength(0)
  })

  it('shows the on-demand translation of an edited SPEAK text', () => {
    useTranslateStore.getState().applyEvent({
      t: 'translated_text',
      request_id: 'speak-1',
      text_src: 'Minggu depan kalau boleh',
      text_tgt: 'Next week if that is ok',
      src_lang: 'id',
      tgt_lang: 'en',
      quality: 'ok'
    })

    expect(useTranslateStore.getState().speakTranslation).toEqual({
      srcText: 'Minggu depan kalau boleh',
      text: 'Next week if that is ok',
      tgtLang: 'en'
    })
  })

  it('keeps the last committed lines when only echo-free text repeats', () => {
    const store = useTranslateStore.getState()
    store.applyEvent(partialEvent('x'))
    store.applyEvent(transcriptEvent('When can you ship it?', 'c-010'))
    useTranslateStore.setState({ lines: [...useTranslateStore.getState().lines, line('another')] })

    expect(useTranslateStore.getState().lines).toHaveLength(2)
  })
})
