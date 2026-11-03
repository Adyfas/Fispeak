// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ISLAND_GUTTER, ISLAND_NAV_GUTTER, RAIL_GAP, RAIL_WIDTH } from '@shared/island'
import {
  clampCardRect,
  computeIslandGeometry,
  isPointInsideCard,
  isPointInsideRail,
  toWindowPoint,
  type DisplayLike
} from './layout'

const display: DisplayLike = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 37, width: 1512, height: 945 }
}

const card = { width: 185, height: 34 }

describe('island geometry', () => {
  it('pins the notch card flush with the display top edge and centers it', () => {
    const geometry = computeIslandGeometry({ display, placement: 'notch', card, savedPosition: null })
    expect(geometry.bounds.y).toBe(0)
    expect(geometry.bounds.width).toBe(card.width + ISLAND_GUTTER * 2)
    expect(geometry.bounds.height).toBe(card.height + ISLAND_GUTTER)
    expect(geometry.bounds.x).toBe(Math.round((1512 - geometry.bounds.width) / 2))
    expect(geometry.cardRect).toEqual({ x: ISLAND_GUTTER, y: 0, ...card })
  })

  it('floats below the work area with a 10 px margin', () => {
    const geometry = computeIslandGeometry({
      display,
      placement: 'floating',
      card,
      savedPosition: null
    })
    expect(geometry.bounds.y).toBe(display.workArea.y + 10)
    expect(geometry.cardRect.y).toBe(0)
  })

  it('honours a saved drag position in floating mode only', () => {
    const saved = { x: 300, y: 120 }
    const floating = computeIslandGeometry({
      display,
      placement: 'floating',
      card,
      savedPosition: saved
    })
    expect(floating.bounds.x).toBe(300)
    expect(floating.bounds.y).toBe(120)

    const notch = computeIslandGeometry({ display, placement: 'notch', card, savedPosition: saved })
    expect(notch.bounds.y).toBe(0)
    expect(notch.bounds.x).not.toBe(saved.x)
  })

  it('clamps a renderer-reported card rect to the window', () => {
    const clamped = clampCardRect(
      { x: -20, y: 900, width: 2000, height: 40 },
      { width: 400, height: 300 }
    )
    expect(clamped).toEqual({ x: 0, y: 260, width: 400, height: 40 })
  })

  it('keeps the card centered with the rail gutter on both sides', () => {
    const geometry = computeIslandGeometry({
      display,
      placement: 'notch',
      card: { width: 760, height: 380 },
      savedPosition: null,
      nav: true
    })
    expect(geometry.bounds.width).toBe(760 + ISLAND_NAV_GUTTER * 2)
    expect(geometry.cardRect.x).toBe(ISLAND_NAV_GUTTER)
    // Window and card share the same center: shrinking stays centered on screen.
    const cardCenter = geometry.bounds.x + geometry.cardRect.x + 760 / 2
    expect(cardCenter).toBe(1512 / 2)
  })
})

describe('feature rail hit testing', () => {
  const cardRect = { x: 28, y: 0, width: 480, height: 400 }
  const railLeft = cardRect.x + cardRect.width + RAIL_GAP

  it('counts a point inside the rail', () => {
    expect(isPointInsideRail({ x: railLeft + 4, y: 120 }, cardRect, RAIL_WIDTH, RAIL_GAP)).toBe(
      true
    )
  })

  it('counts the gap between card and rail as inside', () => {
    // Otherwise hover would drop while the cursor crosses the 8 px gap.
    expect(isPointInsideRail({ x: railLeft - 2, y: 120 }, cardRect, RAIL_WIDTH, RAIL_GAP)).toBe(
      true
    )
  })

  it('ignores points above or below the card', () => {
    expect(isPointInsideRail({ x: railLeft + 4, y: 420 }, cardRect, RAIL_WIDTH, RAIL_GAP)).toBe(
      false
    )
  })
})

describe('hover hit testing', () => {
  const windowBounds = { x: 100, y: 50, width: 241, height: 62 }
  const cardRect = { x: 28, y: 0, width: 185, height: 34 }

  it('counts a point inside the visible card', () => {
    const point = toWindowPoint({ x: 150, y: 60 }, windowBounds)
    expect(isPointInsideCard(point, cardRect)).toBe(true)
  })

  it('counts a point outside the card but inside the window as outside', () => {
    const point = toWindowPoint({ x: 320, y: 100 }, windowBounds)
    expect(isPointInsideCard(point, cardRect)).toBe(false)
  })

  it('tolerates 4 px past the edge to avoid flicker', () => {
    const justBelow = toWindowPoint({ x: 150, y: 50 + 34 + 3 }, windowBounds)
    const tooFarBelow = toWindowPoint({ x: 150, y: 50 + 34 + 8 }, windowBounds)
    expect(isPointInsideCard(justBelow, cardRect)).toBe(true)
    expect(isPointInsideCard(tooFarBelow, cardRect)).toBe(false)
  })
})
