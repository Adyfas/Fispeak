import { useRef } from 'react'
import { getApi } from '@/lib/ipc'

/**
 * Drag is implemented in the main process (04b §4.5): the renderer only reports the start
 * and end of the gesture, while the main-process cursor poll moves the window.
 */
export function DragHandle({ enabled }: { enabled: boolean }): JSX.Element | null {
  const activePointer = useRef<number | null>(null)

  if (!enabled) return null

  return (
    <div
      data-testid="drag-handle"
      className="absolute inset-x-0 top-0 z-20 h-3.5 cursor-grab active:cursor-grabbing"
      onPointerDown={(event) => {
        activePointer.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        getApi().island.dragStart()
      }}
      onPointerUp={(event) => {
        if (activePointer.current !== event.pointerId) return
        activePointer.current = null
        getApi().island.dragEnd()
      }}
      onPointerCancel={() => {
        activePointer.current = null
        getApi().island.dragEnd()
      }}
    />
  )
}
