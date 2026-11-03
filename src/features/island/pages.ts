export type IslandPage =
  | 'prompt'
  | 'listen'
  | 'speak'
  | 'voice'
  | 'notes'
  | 'focus'
  | 'sessions'
  | 'settings'
  | 'clock'

/** The feature rail lists pages in this order (top to bottom). */
export const PAGE_ORDER: readonly IslandPage[] = [
  'prompt',
  'listen',
  'speak',
  'voice',
  'notes',
  'focus',
  'sessions',
  'settings',
  'clock'
]

export const PAGE_TITLE: Record<IslandPage, string> = {
  prompt: 'Prompt',
  clock: 'Clock',
  listen: 'Listen',
  speak: 'Speak',
  voice: 'Voice',
  notes: 'Notes',
  focus: 'Focus',
  sessions: 'Sessions',
  settings: 'Settings'
}

export function stepPage(page: IslandPage, direction: -1 | 1): IslandPage {
  const index = PAGE_ORDER.indexOf(page)
  const next = (index + direction + PAGE_ORDER.length) % PAGE_ORDER.length
  return PAGE_ORDER[next]
}
