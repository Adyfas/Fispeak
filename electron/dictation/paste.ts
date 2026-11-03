import { clipboard, shell, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DictationResult } from '@shared/api'
import { logger } from '../logger'

const run = promisify(execFile)

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * macOS only reports Accessibility trust through `systemPreferences`; without it the app may
 * write to the clipboard but cannot synthesize ⌘V in another application.
 */
export function isAccessibilityTrusted(prompt = false): boolean {
  if (process.platform !== 'darwin') return false
  try {
    return systemPreferences.isTrustedAccessibilityClient(prompt)
  } catch {
    return false
  }
}

export function openAccessibilitySettings(): void {
  void shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  )
}

/** Name of the app that owns the keyboard focus right now (best effort). */
export async function frontmostApp(): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await run(
      'osascript',
      [
        '-e',
        'tell application "System Events" to get name of first application process whose frontmost is true'
      ],
      { timeout: 1_500 }
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function activate(app: string): Promise<void> {
  try {
    await run('osascript', ['-e', `tell application ${JSON.stringify(app)} to activate`], {
      timeout: 1_500
    })
  } catch {
    // The app may have quit while the user was dictating; clipboard still holds the text.
  }
}

/**
 * Prompt page Stop: put the text on the clipboard and, when the owner allowed Accessibility,
 * type ⌘V into the previously focused app instead of asking them to paste manually.
 */
export async function deliverText(
  text: string,
  options: { autoPaste: boolean; previousApp: string | null }
): Promise<DictationResult> {
  const value = text.trim()
  if (!value) return { text: '', pasted: false, copied: false, reason: 'empty' }

  clipboard.writeText(value)

  if (!options.autoPaste) return { text: value, pasted: false, copied: true }
  if (!isAccessibilityTrusted(false)) {
    logger.info('dictation', 'accessibility not granted, text copied only')
    return { text: value, pasted: false, copied: true, reason: 'accessibility' }
  }

  if (options.previousApp) {
    await activate(options.previousApp)
    await delay(90)
  }

  try {
    await run(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      { timeout: 2_500 }
    )
    return { text: value, pasted: true, copied: true }
  } catch (error) {
    logger.warn('dictation', 'paste failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    return { text: value, pasted: false, copied: true, reason: 'failed' }
  }
}
