import { describe, expect, it } from 'vitest'
import { ISLAND_STATES, type IslandState } from '@shared/api'
import { nextPillState } from './pillStore'

describe('pill state machine', () => {
  it('keeps exactly the six spec states', () => {
    expect([...ISLAND_STATES]).toEqual([
      'IDLE',
      'EXPANDED_TOOL',
      'TRANSLATE_ON',
      'TRANSLATE_MINI',
      'ERROR_PILL',
      'HIDDEN'
    ])
  })

  it('expands on hover from IDLE and collapses back on leave', () => {
    expect(nextPillState('IDLE', 'hover-enter')).toBe('EXPANDED_TOOL')
    expect(nextPillState('EXPANDED_TOOL', 'hover-leave')).toBe('IDLE')
  })

  it('expands from TRANSLATE_MINI on hover', () => {
    expect(nextPillState('TRANSLATE_MINI', 'hover-enter')).toBe('EXPANDED_TOOL')
  })

  it('does not collapse TRANSLATE_ON when the pointer leaves', () => {
    expect(nextPillState('TRANSLATE_ON', 'hover-leave')).toBe('TRANSLATE_ON')
  })

  it('starts translating from the tool panel and stops back into it', () => {
    expect(nextPillState('EXPANDED_TOOL', 'start-translate')).toBe('TRANSLATE_ON')
    expect(nextPillState('TRANSLATE_ON', 'stop-translate')).toBe('EXPANDED_TOOL')
  })

  it('toggles translate only when the island is visible', () => {
    expect(nextPillState('IDLE', 'toggle-translate')).toBe('TRANSLATE_ON')
    expect(nextPillState('TRANSLATE_ON', 'toggle-translate')).toBe('EXPANDED_TOOL')
    expect(nextPillState('HIDDEN', 'toggle-translate')).toBe('HIDDEN')
  })

  it('routes errors to ERROR_PILL and retry back to the tool panel', () => {
    expect(nextPillState('TRANSLATE_ON', 'error')).toBe('ERROR_PILL')
    expect(nextPillState('ERROR_PILL', 'clear-error')).toBe('EXPANDED_TOOL')
  })

  it('hides from anywhere and only restores to IDLE from HIDDEN', () => {
    const from: IslandState[] = ['IDLE', 'EXPANDED_TOOL', 'TRANSLATE_ON', 'ERROR_PILL']
    for (const state of from) expect(nextPillState(state, 'hide')).toBe('HIDDEN')
    expect(nextPillState('HIDDEN', 'show')).toBe('IDLE')
    expect(nextPillState('IDLE', 'show')).toBe('IDLE')
  })

  it('never invents a state for unknown combinations', () => {
    expect(nextPillState('IDLE', 'hover-leave')).toBe('IDLE')
    expect(nextPillState('ERROR_PILL', 'hover-enter')).toBe('ERROR_PILL')
  })
})
