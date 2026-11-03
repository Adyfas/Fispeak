import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { SidecarEvent } from '@shared/api'
import { useTranslateStore } from '@/stores/translateStore'
import { TranscriptList } from './TranscriptList'

function partial(text: string): SidecarEvent {
  return {
    t: 'partial',
    tag: 'remote',
    window_id: 'remote-1',
    text,
    started_ms: 2_000,
    end_ms: 3_000,
    conf: 0.5,
    session_id: 's-1'
  }
}

function transcript(text: string): SidecarEvent {
  return {
    t: 'transcript',
    tag: 'remote',
    lang: 'en',
    text,
    conf: 0.9,
    started_ms: 2_000,
    end_ms: 4_000,
    session_id: 's-1',
    chunk_id: 'c-001'
  }
}

describe('TranscriptList partial layer', () => {
  it('renders the live partial dimmed, then the committed final line', () => {
    useTranslateStore.setState({
      lines: [],
      partials: { you: null, remote: null },
      speakTranslation: null,
      sttMode: null
    })
    const store = useTranslateStore.getState()

    act(() => {
      store.applyEvent(partial('I think we should'))
    })
    render(<TranscriptList />)
    expect(screen.getByText(/I think we should/)).toBeInTheDocument()
    expect(screen.getByText('live')).toBeInTheDocument()

    act(() => {
      store.applyEvent(partial('I think we should move the deadline.'))
    })
    // The same row is replaced, not appended.
    expect(screen.getAllByText('live')).toHaveLength(1)

    act(() => {
      store.applyEvent(transcript('I think we should move the deadline.'))
    })
    expect(screen.queryByText('live')).not.toBeInTheDocument()
    expect(screen.getByText('I think we should move the deadline.')).toBeInTheDocument()
  })
})
