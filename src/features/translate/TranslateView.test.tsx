import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { DEFAULT_SETTINGS, type TranscriptLine } from '@shared/api'
import { useTranslateStore } from '@/stores/translateStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { TranslateView } from './TranslateView'

function setup(lines: TranscriptLine[] = []): void {
  useTranslateStore.setState({
    lines,
    partials: { you: null, remote: null },
    speakTranslation: null,
    sttMode: null,
    levels: { you: 0.1, remote: 0 },
    status: {
      mic: 'running',
      system: 'running',
      message: null,
      sessionId: 'test-session',
      sidecar: 'connected'
    },
    lastError: null
  })
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: true })
}

function installDefaultApi(): void {
  ;(window as unknown as { fispeak: unknown }).fispeak = {
    translate: {
      start: vi.fn(),
      stop: vi.fn(),
      setMode: vi.fn(),
      speak: vi.fn(),
      finishSpeak: () => Promise.resolve(null),
      languages: () => Promise.resolve([]),
      onEvent: () => () => undefined,
      onStatus: () => () => undefined,
      onMode: () => () => undefined
    },
    session: {
      list: () => Promise.resolve([]),
      turns: () => Promise.resolve([]),
      takes: () => Promise.resolve([]),
      resume: () => Promise.resolve(''),
      rename: () => Promise.resolve(),
      create: () => Promise.resolve('')
    }
  }
}

describe('TranslateView', () => {
  beforeEach(() => {
    setup()
    installDefaultApi()
  })

  it('shows the empty state while nothing was transcribed', () => {
    render(<TranslateView variant="full" />)
    expect(screen.getByText(/Listening/i)).toBeInTheDocument()
  })

  it('renders the transcript and its translation', () => {
    setup([
      {
        chunkId: 'c-001',
        tag: 'remote',
        srcLang: 'en',
        text: 'When can you ship it?',
        translated: 'Kapan bisa dikirim?',
        tgtLang: 'id',
        quality: 'ok',
        startedMs: 12_000,
        endedMs: 13_000,
        confidence: 0.9
      }
    ])
    render(<TranslateView variant="full" />)
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(screen.getByText('When can you ship it?')).toBeInTheDocument()
    expect(screen.getByText('Kapan bisa dikirim?')).toBeInTheDocument()
    expect(screen.getByText('00:12')).toBeInTheDocument()
  })

  it('hides the you lines in listen mode (exclusive modes)', () => {
    setup([
      {
        chunkId: 'c-002',
        tag: 'you',
        srcLang: 'id',
        text: 'Minggu depan',
        translated: null,
        tgtLang: null,
        quality: 'ok',
        startedMs: 0,
        endedMs: 900,
        confidence: 0.8
      }
    ])
    render(<TranslateView variant="full" />)
    // Revisi 1: LISTEN only shows the remote stream; the mic lines belong to SPEAK.
    expect(screen.queryByText('You')).not.toBeInTheDocument()
    expect(screen.queryByText('Minggu depan')).not.toBeInTheDocument()
  })

  it('shows the last translation in the mini variant', () => {
    setup([
      {
        chunkId: 'c-003',
        tag: 'remote',
        srcLang: 'en',
        text: 'Sounds good',
        translated: 'Kedengarannya bagus',
        tgtLang: 'id',
        quality: 'ok',
        startedMs: 0,
        endedMs: 900,
        confidence: 0.9
      }
    ])
    render(<TranslateView variant="mini" />)
    expect(screen.getByText('Kedengarannya bagus')).toBeInTheDocument()
  })

  it('switches to the speak mode and translates before playing', async () => {
    const setMode = vi.fn()
    const speak = vi.fn()
    ;(window as unknown as { fispeak: unknown }).fispeak = {
      translate: { start: vi.fn(), stop: vi.fn(), setMode, speak, finishSpeak: () => Promise.resolve(null), languages: () => Promise.resolve([]), onMode: () => () => undefined, onEvent: () => () => undefined, onStatus: () => () => undefined }
    }
    setup([
      {
        chunkId: 'c-004',
        tag: 'you',
        srcLang: 'id',
        text: 'Minggu depan kalau oke',
        translated: null,
        tgtLang: null,
        quality: 'ok',
        startedMs: 1000,
        endedMs: 2000,
        confidence: 0.9
      }
    ])
    useTranslateStore.setState({ mode: 'speak' })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, remoteLang: 'en', autoDetectRemoteLang: false },
      loaded: true
    })

    render(<TranslateView variant="full" />)
    // Live phase: the recognised source text and the "Selesai" action.
    expect(screen.getByText('Minggu depan kalau oke')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /selesai/i }))

    // Ready phase: editable source, nothing is played until the user presses Putar.
    const editor = screen.getByRole('textbox', { name: /source text/i })
    fireEvent.change(editor, { target: { value: 'Minggu depan kalau boleh' } })
    expect(speak).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /putar/i }))
    expect(speak).toHaveBeenCalledWith('Minggu depan kalau boleh', 'en', true)

    // Played phase: the on-demand translation from the sidecar fills the card.
    act(() => {
      useTranslateStore.setState({
        speakTranslation: { srcText: 'Minggu depan kalau boleh', text: 'Next week if that is ok', tgtLang: 'en' }
      })
    })
    expect(await screen.findByText('Next week if that is ok')).toBeInTheDocument()
  })

  it('offers the listen and speak modes', () => {
    const setMode = vi.fn()
    ;(window as unknown as { fispeak: unknown }).fispeak = {
      translate: { start: vi.fn(), stop: vi.fn(), setMode, speak: vi.fn(), finishSpeak: () => Promise.resolve(null), languages: () => Promise.resolve([]), onMode: () => () => undefined, onEvent: () => () => undefined, onStatus: () => () => undefined }
    }
    setup([])
    render(<TranslateView variant="full" />)

    fireEvent.click(screen.getByRole('tab', { name: 'Speak' }))
    expect(setMode).toHaveBeenCalledWith('speak')
  })
})
