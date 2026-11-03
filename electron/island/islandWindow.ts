import { BrowserWindow, screen, type Display } from 'electron'
import { join } from 'node:path'
import type {
  CardRect,
  IslandMetrics,
  IslandState,
  PlacementMode,
  Settings
} from '@shared/api'
import { IPC } from '@shared/api'
import {
  HOVER_POLL_MS,
  ISLAND_CARD_SIZES,
  ISLAND_GUTTER,
  RAIL_GAP,
  RAIL_WIDTH,
  TRANSITION_MS,
  isNavState
} from '@shared/island'
import {
  clampCardRect,
  centeredCardX,
  computeIslandGeometry,
  isPointInsideCard,
  isPointInsideRail,
  sameRect,
  toWindowPoint,
  type Point,
  type Rect
} from './layout'
import { logger } from '../logger'

export interface IslandHooks {
  onHoverChange(inside: boolean): void
  onVisibilityChange(visible: boolean): void
  onPositionChange(position: Point): void
}

const isMac = process.platform === 'darwin'

/**
 * The dynamic island window (04b §4). Window mechanics live here, not in the renderer:
 * sizing, click-through polling, manual drag and always-on-top re-assertion.
 */
export class IslandWindow {
  private window: BrowserWindow | null = null
  private state: IslandState = 'IDLE'
  private placement: PlacementMode = 'floating'
  private cardRect: CardRect = {
    x: ISLAND_GUTTER,
    y: 0,
    width: ISLAND_CARD_SIZES.IDLE.width,
    height: ISLAND_CARD_SIZES.IDLE.height
  }
  private settings: Settings
  private animating = false
  private ignoring: boolean | null = null
  private lastInside: boolean | null = null
  private drag: { cursor: Point; origin: Point } | null = null
  private hidden = false
  /** True while the renderer shows the hover-only feature rail outside the card. */
  private navVisible = false
  private disposed = false
  private pollTimer: NodeJS.Timeout | null = null
  private transitionTimer: NodeJS.Timeout | null = null
  private topmostTimer: NodeJS.Timeout | null = null
  /** Bounds applied after a shrink animation; growing applies immediately. */
  private pendingBounds: Rect | null = null

  constructor(
    private readonly hooks: IslandHooks,
    settings: Settings
  ) {
    this.settings = settings
  }

  create(): BrowserWindow {
    const display = this.display()
    this.placement = this.resolvePlacement(display)
    const geometry = computeIslandGeometry({
      display,
      placement: this.placement,
      card: ISLAND_CARD_SIZES[this.state],
      savedPosition: this.settings.floatingPosition,
      nav: isNavState(this.state)
    })
    this.cardRect = geometry.cardRect

    const win = new BrowserWindow({
      ...geometry.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      roundedCorners: false,
      ...(isMac ? { type: 'panel' as const } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false
      }
    })

    this.window = win
    win.setAlwaysOnTop(true, 'screen-saver')
    if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.once('ready-to-show', () => {
      if (!this.hidden) win.showInactive()
      this.broadcastMetrics()
    })
    win.on('closed', () => {
      this.window = null
    })
    win.on('close', (event) => {
      if (this.disposed) return
      event.preventDefault()
      this.hide()
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(devUrl)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'))
    }

    this.setIgnore(true)
    this.startPolling()
    this.startTopmostGuard()
    logger.info('island', 'island window created', { placement: this.placement, ...geometry.bounds })
    return win
  }

  getBrowserWindow(): BrowserWindow | null {
    return this.window
  }

  setState(state: IslandState): void {
    if (this.state === state) {
      this.broadcastMetrics()
      return
    }
    this.state = state
    logger.debug('island', 'state change', { state })

    if (state === 'HIDDEN') {
      this.hide()
      return
    }
    if (this.hidden) this.show()
    this.applyGeometry()
    this.broadcastMetrics()
  }

  getState(): IslandState {
    return this.state
  }

  requestMetrics(): void {
    this.broadcastMetrics()
  }

  isVisible(): boolean {
    return !this.hidden
  }

  setVisible(visible: boolean): void {
    if (visible) this.show()
    else this.hide()
  }

  toggleVisible(): void {
    this.setVisible(this.hidden)
  }

  reportCardRect(rect: CardRect): void {
    const win = this.window
    if (!win) return
    // While the window is being resized the renderer may still report the previous (larger)
    // card rect. Clamping that against the new, smaller window would shift the card
    // off-center, so only trust reports once the window has settled.
    if (this.animating) return
    const bounds = win.getBounds()
    const clamped = clampCardRect(rect, { width: bounds.width, height: bounds.height })
    if (sameRect(clamped, this.cardRect)) return
    this.cardRect = clamped
    this.broadcastMetrics()
  }

  /** The renderer reports whether the hover-only feature rail is visible. */
  setNavVisible(visible: boolean): void {
    if (this.navVisible === visible) return
    this.navVisible = visible
    // Re-evaluate immediately so moving from the card to the rail keeps the window clickable.
    this.tick()
  }

  dragStart(): void {
    const win = this.window
    if (!win || this.hidden || this.placement !== 'floating') return
    const bounds = win.getBounds()
    this.drag = { cursor: screen.getCursorScreenPoint(), origin: { x: bounds.x, y: bounds.y } }
    this.animating = false
    this.setIgnore(false)
  }

  dragEnd(): void {
    if (!this.drag) return
    this.drag = null
    const bounds = this.window?.getBounds()
    if (bounds) this.hooks.onPositionChange({ x: bounds.x, y: bounds.y })
    this.lastInside = null
    this.tick()
  }

  applySettings(settings: Settings): void {
    this.settings = settings
    const display = this.display()
    const nextPlacement = this.resolvePlacement(display)
    const placementChanged = nextPlacement !== this.placement
    this.placement = nextPlacement
    if (placementChanged) this.applyGeometry()
    else this.broadcastMetrics()
  }

  /** Recompute placement after display changes (resolution, monitor removed, ...). */
  reposition(): void {
    const nextPlacement = this.resolvePlacement(this.display())
    this.placement = nextPlacement
    this.applyGeometry()
    this.broadcastMetrics()
  }

  hide(): void {
    const win = this.window
    if (!win) return
    this.hidden = true
    this.navVisible = false
    this.lastInside = null
    this.drag = null
    this.ignoring = null
    this.animating = false
    this.pendingBounds = null
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer)
      this.transitionTimer = null
    }
    this.setIgnore(true)
    win.hide()
    this.hooks.onVisibilityChange(false)
    this.broadcastMetrics()
  }

  show(): void {
    const win = this.window
    if (!win) return
    this.hidden = false
    this.applyGeometry()
    this.ignoring = null
    this.setIgnore(true)
    win.showInactive()
    this.lastInside = null
    this.hooks.onVisibilityChange(true)
    this.broadcastMetrics()
    this.tick()
  }

  destroy(): void {
    this.disposed = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.transitionTimer) clearTimeout(this.transitionTimer)
    if (this.topmostTimer) clearInterval(this.topmostTimer)
    this.pollTimer = null
    this.transitionTimer = null
    this.topmostTimer = null
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private applyGeometry(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const card = ISLAND_CARD_SIZES[this.state]
    const current: Rect = win.getBounds()
    const navigation = isNavState(this.state)
    let geometry = computeIslandGeometry({
      display: this.display(),
      placement: this.placement,
      card,
      savedPosition: this.settings.floatingPosition,
      nav: navigation
    })

    // Floating: keep the island's horizontal center, not its left edge, so growing and
    // collapsing never slides it sideways.
    if (this.placement === 'floating' && this.settings.floatingPosition) {
      const centerX = current.x + current.width / 2
      geometry = {
        ...geometry,
        bounds: { ...geometry.bounds, x: Math.round(centerX - geometry.bounds.width / 2) }
      }
    }

    if (sameRect(current, geometry.bounds)) {
      this.pendingBounds = null
      this.cardRect = geometry.cardRect
      this.broadcastMetrics()
      return
    }

    // The window is already at its final size while the card animates. Keep the window
    // capturing the mouse (the renderer disables its own content) so a click during the
    // transition is swallowed instead of landing in the app behind the island (04b §4.2).
    this.animating = true
    this.setIgnore(false)
    if (this.transitionTimer) clearTimeout(this.transitionTimer)

    // Growing: resize first so the card has room to animate into.
    // Shrinking: keep the old window for the animation, otherwise the window edge would clip
    // the card mid-collapse and the shrink would look like a hard cut.
    const shrinking =
      geometry.bounds.width < current.width || geometry.bounds.height < current.height
    this.pendingBounds = shrinking ? geometry.bounds : null
    if (!shrinking) win.setBounds(geometry.bounds, false)

    // The renderer always centers the card inside the window, so the hit-test rect must be
    // centered on the window width that is on screen right now (the old one while shrinking).
    const shown = shrinking ? current : win.getBounds()
    this.cardRect = {
      x: centeredCardX(shown.width, card.width),
      y: 0,
      width: card.width,
      height: card.height
    }
    this.broadcastMetrics()

    this.transitionTimer = setTimeout(() => {
      this.animating = false
      this.transitionTimer = null
      const target = this.pendingBounds
      this.pendingBounds = null
      if (target) win.setBounds(target, false)
      // The window has settled: restore the canonical card rect and let the renderer put the
      // card back in the center before hover hit-testing resumes.
      const settled = win.getBounds()
      this.cardRect = {
        x: centeredCardX(settled.width, card.width),
        y: 0,
        width: card.width,
        height: card.height
      }
      this.broadcastMetrics()
      this.tick()
    }, TRANSITION_MS)
  }

  private broadcastMetrics(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const metrics: IslandMetrics = {
      state: this.state,
      placement: this.placement,
      cardWidth: ISLAND_CARD_SIZES[this.state].width,
      cardHeight: ISLAND_CARD_SIZES[this.state].height,
      gutterX: this.cardRect.x,
      gutterTop: this.cardRect.y,
      animating: this.animating
    }
    win.webContents.send(IPC.islandMetrics, metrics)
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => this.tick(), HOVER_POLL_MS)
  }

  private startTopmostGuard(): void {
    if (isMac) return
    // Windows/Linux: re-assert topmost so fullscreen apps cannot bury the island (04b §4.1).
    this.topmostTimer = setInterval(() => {
      const win = this.window
      if (win && !win.isDestroyed() && !this.hidden) win.setAlwaysOnTop(true, 'screen-saver')
    }, 2000)
  }

  private tick(): void {
    const win = this.window
    if (!win || win.isDestroyed() || this.hidden) return

    const cursor = screen.getCursorScreenPoint()
    if (this.drag) {
      this.applyDrag(cursor)
      return
    }

    const bounds = win.getBounds()
    const point = toWindowPoint(cursor, bounds)
    const insideCard = isPointInsideCard(point, this.cardRect)
    const insideRail =
      this.navVisible && isPointInsideRail(point, this.cardRect, RAIL_WIDTH, RAIL_GAP)
    const inside = insideCard || insideRail

    if (this.animating) {
      // Swallow clicks during the resize: the renderer turns its content inert, so nothing
      // fires, and the click never reaches the app behind the island.
      this.setIgnore(false)
      return
    }

    this.setIgnore(!inside)
    this.emitHover(inside)
  }

  private applyDrag(cursor: Point): void {
    const win = this.window
    if (!win || !this.drag) return
    const x = Math.round(this.drag.origin.x + (cursor.x - this.drag.cursor.x))
    const y = Math.round(this.drag.origin.y + (cursor.y - this.drag.cursor.y))
    win.setPosition(x, y)
  }

  private emitHover(inside: boolean): void {
    if (this.lastInside === inside) return
    this.lastInside = inside
    logger.debug('island', 'hover', { inside })
    this.hooks.onHoverChange(inside)
  }

  private setIgnore(ignore: boolean): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    if (this.ignoring === ignore) return
    this.ignoring = ignore
    logger.debug('island', 'ignore-mouse', { ignore })
    win.setIgnoreMouseEvents(ignore, { forward: true })
  }

  private display(): Display {
    const primary = screen.getPrimaryDisplay()
    if (this.placement === 'notch') return primary
    const saved = this.settings.floatingPosition
    if (!saved) return primary
    // Follow the saved position onto whichever display now contains it.
    return screen.getDisplayNearestPoint(saved)
  }

  /**
   * Electron has no notch API. Notched MacBooks report a taller menu bar (~37 px) than
   * regular ones (~24 px); when the menu bar is auto-hidden that signal disappears, so fall
   * back to the panel aspect ratio (notched panels are slightly taller than 16:10: 1512x982
   * -> 1.539, 1728x1117 -> 1.547). The Swift helper in Phase 3 reports the real
   * `NSScreen.auxiliaryTop*Area` geometry; Settings can always override.
   */
  private resolvePlacement(display: Display): PlacementMode {
    if (this.settings.placement !== 'auto') return this.settings.placement
    if (!isMac) return 'floating'
    if (display.workArea.y >= 30) return 'notch'
    if (display.internal) {
      const ratio = display.bounds.width / display.bounds.height
      if (ratio > 1.5 && ratio < 1.58) return 'notch'
    }
    return 'floating'
  }
}
