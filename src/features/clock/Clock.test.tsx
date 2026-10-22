import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Clock } from './Clock'

describe('Clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T10:42:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders a live hh:mm clock', () => {
    render(<Clock />)
    expect(screen.getByLabelText('Current time')).toHaveTextContent(/^\d{1,2}:\d{2}(\s?[AP]M)?$/i)
  })
})
