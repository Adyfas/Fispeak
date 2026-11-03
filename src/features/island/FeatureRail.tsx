import { useEffect, useRef, useState } from 'react'
import { RAIL_GAP, RAIL_ITEM_GAP, RAIL_ITEM_SIZE, RAIL_WIDTH } from '@shared/island'
import {
  ChecklistIcon,
  ClockIcon,
  FocusIcon,
  GlobeIcon,
  HistoryIcon,
  MicIcon,
  PromptIcon,
  SettingsIcon,
  SpeakerIcon
} from '@/components/icons'
import { PAGE_ORDER, PAGE_TITLE, type IslandPage } from './pages'

const ICONS: Record<IslandPage, (props: { className?: string }) => JSX.Element> = {
  prompt: PromptIcon,
  listen: GlobeIcon,
  speak: SpeakerIcon,
  voice: MicIcon,
  notes: ChecklistIcon,
  focus: FocusIcon,
  sessions: HistoryIcon,
  settings: SettingsIcon,
  clock: ClockIcon
}

/** Drag distance in px before the list follows the pointer. */
const DRAG_THRESHOLD_PX = 4

interface FeatureRailProps {
  page: IslandPage
  visible: boolean
  /** Card metrics: the rail is positioned just outside the card's right edge. */
  cardWidth: number
  cardHeight: number
  onSelect(page: IslandPage): void
}

/**
 * Vertical feature rail (04-ui redesign): replaces the old circular prev/next arrows.
 *
 * Separate round buttons with real spacing, outside the card and flush with its vertical
 * bounds. The rail never grows past the island height: when the list is longer, the items
 * fade out at the top/bottom edge and the user scrolls (trackpad, middle-drag or the wheel).
 */
export function FeatureRail({
  page,
  visible,
  cardWidth,
  cardHeight,
  onSelect
}: FeatureRailProps): JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<IslandPage, HTMLButtonElement>())
  const drag = useRef<{ startY: number; startScroll: number; active: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [hoveredPage, setHoveredPage] = useState<IslandPage | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [labelTop, setLabelTop] = useState(0)

  // Keep the active icon inside the visible window of the list. Only the page changes can
  // move the list: the card height changes must not re-center or scroll it, otherwise the
  // icon under the cursor jumps right after a click.
  useEffect(() => {
    const item = itemRefs.current.get(page)
    const list = listRef.current
    if (!item || !list) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < list.scrollTop) list.scrollTo({ top: top - 8, behavior: 'smooth' })
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: bottom - list.clientHeight + 8, behavior: 'smooth' })
    }
  }, [page])

  // Only fade the edges when the list actually has to scroll; otherwise the first/last
  // button would look permanently dimmed.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const check = (): void => setOverflowing(list.scrollHeight > list.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(list)
    return () => observer.disconnect()
  }, [cardHeight])

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    // Middle mouse: drag the list up/down (same as a scrollbar).
    if (event.button !== 1) return
    const list = listRef.current
    if (!list) return
    event.preventDefault()
    drag.current = { startY: event.clientY, startScroll: list.scrollTop, active: false }
    const move = (moveEvent: MouseEvent): void => {
      const state = drag.current
      if (!state) return
      const delta = moveEvent.clientY - state.startY
      if (!state.active && Math.abs(delta) < DRAG_THRESHOLD_PX) return
      if (!state.active) {
        state.active = true
        setDragging(true)
      }
      list.scrollTop = state.startScroll - delta
    }
    const up = (): void => {
      drag.current = null
      setDragging(false)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Label position: resolved in an effect (refs must not be read during render).
  useEffect(() => {
    if (!hoveredPage) return
    const element = itemRefs.current.get(hoveredPage)
    if (!element) return
    // offsetTop is relative to the rail wrapper (the scroll container starts at y = 0).
    setLabelTop(element.offsetTop - scrollTop + RAIL_ITEM_SIZE / 2)
  }, [hoveredPage, scrollTop, cardHeight])

  const labelPage = hoveredPage
  const labelWords = labelPage ? PAGE_TITLE[labelPage].split(' ') : []

  return (
    <div
      role="tablist"
      aria-label="Features"
      aria-orientation="vertical"
      style={{ left: cardWidth + RAIL_GAP, width: RAIL_WIDTH, height: cardHeight }}
      className={`rail absolute top-0 z-20 ${visible ? 'rail-visible' : 'rail-hidden'} ${
        dragging ? 'cursor-grabbing' : ''
      }`}
      onMouseDown={onMouseDown}
      onAuxClick={(event) => event.preventDefault()}
      onMouseLeave={() => setHoveredPage(null)}
    >
      <div
        ref={listRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className={`scrollbar-none flex h-full flex-col items-center overflow-y-auto py-2 ${
          overflowing ? 'rail-fade' : ''
        }`}
      >
        {PAGE_ORDER.map((entry) => {
          const Icon = ICONS[entry]
          const active = entry === page
          return (
            <button
              key={entry}
              ref={(element) => {
                if (element) itemRefs.current.set(entry, element)
                else itemRefs.current.delete(entry)
              }}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={PAGE_TITLE[entry]}
              tabIndex={visible ? 0 : -1}
              onClick={() => onSelect(entry)}
              onMouseEnter={() => setHoveredPage(entry)}
              onFocus={() => setHoveredPage(entry)}
              onBlur={() => setHoveredPage(null)}
              style={{
                width: RAIL_ITEM_SIZE,
                height: RAIL_ITEM_SIZE,
                marginBottom: entry === PAGE_ORDER[PAGE_ORDER.length - 1] ? 0 : RAIL_ITEM_GAP
              }}
              className={`rail-item flex shrink-0 items-center justify-center rounded-full border text-white/55 ${
                active
                  ? 'rail-item-active border-white/20'
                  : 'border-white/[0.10] bg-[#0F0F12] hover:text-white/80'
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
          )
        })}
      </div>

      {/* Hover label: rendered outside the scroll container so the mask cannot clip it. */}
      {visible && labelPage && (
        <div
          key={labelPage}
          className="rail-label"
          style={{ right: RAIL_WIDTH + 8, top: labelTop }}
          aria-hidden
        >
          {labelWords.map((word, index) => (
            <span
              key={`${word}-${index}`}
              className="rail-label-word"
              style={{
                animationDelay: `${index * 40}ms`,
                marginRight: index === labelWords.length - 1 ? 0 : 4
              }}
            >
              {word}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
