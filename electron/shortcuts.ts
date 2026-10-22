import { globalShortcut } from 'electron'
import { logger } from './logger'

export interface ShortcutHooks {
  toggleTranslate(): void
  togglePill(): void
}

export function registerShortcuts(hooks: ShortcutHooks): void {
  const bind = (accelerator: string, handler: () => void): void => {
    const ok = globalShortcut.register(accelerator, handler)
    if (!ok) logger.warn('shortcuts', 'hotkey registration failed', { accelerator })
  }
  bind('CommandOrControl+Shift+F', () => hooks.toggleTranslate())
  bind('CommandOrControl+Shift+H', () => hooks.togglePill())
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
