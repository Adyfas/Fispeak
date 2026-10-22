import type { IslandState, PlacementMode } from './api'

/**
 * Card (visible island) sizes, in CSS px.
 *
 * The idle pill is deliberately wider than the MacBook camera housing (~200 pt): the card
 * has to peek out on both sides of the notch, otherwise the clock and status dot are hidden
 * behind the camera. 04b §7 numbers are the floor, not the ceiling.
 */
export const ISLAND_CARD_SIZES: Record<IslandState, { width: number; height: number }> = {
  IDLE: { width: 330, height: 34 },
  EXPANDED_TOOL: { width: 500, height: 300 },
  TRANSLATE_ON: { width: 560, height: 360 },
  TRANSLATE_MINI: { width: 260, height: 46 },
  ERROR_PILL: { width: 320, height: 46 },
  HIDDEN: { width: 330, height: 34 }
}

/** Transparent gutter around the card so the CSS drop-shadow is not clipped. */
export const ISLAND_GUTTER = 28

/** Margin from the top of the work area in floating placement (04-ui-spec §2). */
export const FLOATING_TOP_MARGIN = 10

/** Drag-handle strip height at the top of the card (04b §4.5). */
export const DRAG_HANDLE_HEIGHT = 14

/** Cursor tolerance around the card edge to stop expand/collapse flicker (04b §4.4). */
export const HOVER_TOLERANCE = 4

/** Hover polling cadence in the main process (04b §4.4). */
export const HOVER_POLL_MS = 60

/**
 * Ignore-mouse blackout while the window resizes between card sizes (04b §4.2).
 * Keep this <= the card transition duration so the first frame after settling is clickable.
 */
export const TRANSITION_MS = 360

/**
 * Top clearance inside the card when it is attached to the notch. Content must start below
 * the camera housing or the header renders behind it.
 */
export const NOTCH_HEADER_CLEARANCE = 38

/**
 * Fixed corner radius. A constant radius beats `rounded-full` -> `rounded-3xl`: animating
 * 9999px down to 24px makes the corners visibly snap. At the 34 px idle height this value
 * is clamped by CSS to a perfect pill, then it stays put while the card grows.
 */
export const ISLAND_RADIUS = 20

export function isExpandableState(state: IslandState): boolean {
  return state === 'IDLE' || state === 'TRANSLATE_MINI'
}

export function isMode(state: IslandState, mode: PlacementMode): boolean {
  void mode
  return state !== 'HIDDEN'
}
