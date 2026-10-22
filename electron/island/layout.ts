import type { CardRect, PlacementMode } from '@shared/api'
import { FLOATING_TOP_MARGIN, HOVER_TOLERANCE, ISLAND_GUTTER } from '@shared/island'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayLike {
  bounds: Rect
  workArea: Rect
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface IslandGeometry {
  bounds: Rect
  cardRect: CardRect
}

/**
 * Single source of truth for island window placement (04b §3, §4.2).
 *
 * The window is always card + transparent gutters. In `notch` placement the card is flush
 * with the display's top edge; in `floating` it hangs below the work-area top with a 10 px
 * margin. The top gutter is 0 in both modes so the card never starts off-screen.
 */
export function computeIslandGeometry(options: {
  display: DisplayLike
  placement: PlacementMode
  card: Size
  savedPosition: Point | null
}): IslandGeometry {
  const { display, placement, card, savedPosition } = options
  const width = card.width + ISLAND_GUTTER * 2
  const height = card.height + ISLAND_GUTTER

  const anchorArea = placement === 'notch' ? display.bounds : display.workArea
  const defaultX = anchorArea.x + Math.round((anchorArea.width - width) / 2)
  const defaultY = placement === 'notch' ? display.bounds.y : anchorArea.y + FLOATING_TOP_MARGIN

  const x = placement === 'floating' && savedPosition ? savedPosition.x : defaultX
  const y = placement === 'floating' && savedPosition ? savedPosition.y : defaultY

  return {
    bounds: { x, y, width, height },
    cardRect: { x: ISLAND_GUTTER, y: 0, width: card.width, height: card.height }
  }
}

/** Card rect reported by the renderer, clamped so it can never exceed the window. */
export function clampCardRect(rect: CardRect, windowSize: Size): CardRect {
  const width = Math.max(1, Math.min(rect.width, windowSize.width))
  const height = Math.max(1, Math.min(rect.height, windowSize.height))
  return {
    x: Math.max(0, Math.min(rect.x, windowSize.width - width)),
    y: Math.max(0, Math.min(rect.y, windowSize.height - height)),
    width,
    height
  }
}

/**
 * Hit test in window-local CSS pixels with a small tolerance so the edge does not flicker
 * between expand/collapse (04b §4.4).
 */
export function isPointInsideCard(
  pointInWindow: Point,
  cardRect: CardRect,
  tolerance = HOVER_TOLERANCE
): boolean {
  return (
    pointInWindow.x >= cardRect.x - tolerance &&
    pointInWindow.x <= cardRect.x + cardRect.width + tolerance &&
    pointInWindow.y >= cardRect.y - tolerance &&
    pointInWindow.y <= cardRect.y + cardRect.height + tolerance
  )
}

export function toWindowPoint(point: Point, bounds: Rect): Point {
  return { x: point.x - bounds.x, y: point.y - bounds.y }
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
