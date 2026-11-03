import { shell } from 'electron'
import { existsSync } from 'node:fs'
import type { SckCapture } from './sckCapture'

export type PermissionState = 'granted' | 'denied' | 'unsupported' | 'unknown'

export interface PrivacyStatus {
  screenRecording: PermissionState
  systemAudio: 'available' | 'unavailable'
  blackhole: boolean
  platform: NodeJS.Platform
}

/**
 * Permission and capability probe (05-audio-capture §7).
 *
 * macOS 13+ uses ScreenCaptureKit, older systems need the BlackHole driver. The Screen
 * Recording permission can only be checked by asking the system, which the helper does.
 */
export async function getPrivacyStatus(sck: SckCapture): Promise<PrivacyStatus> {
  const platform = process.platform
  if (platform !== 'darwin') {
    return {
      screenRecording: 'unsupported',
      systemAudio: 'unavailable',
      blackhole: false,
      platform
    }
  }

  const available = sck.available
  const granted = available ? await sck.checkPermission() : false

  return {
    screenRecording: available ? (granted ? 'granted' : 'denied') : 'unsupported',
    systemAudio: available ? 'available' : 'unavailable',
    blackhole: hasBlackHole(),
    platform
  }
}

/** Open the macOS Screen Recording settings pane so the user can grant the permission. */
export function openScreenRecordingSettings(): void {
  if (process.platform !== 'darwin') return
  void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
}

/** Open the macOS Microphone settings pane. */
export function openMicrophoneSettings(): void {
  if (process.platform !== 'darwin') return
  void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
}

const BLACKHOLE_DRIVERS = [
  '/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver',
  '/Library/Audio/Plug-Ins/HAL/BlackHole16ch.driver',
  '/Library/Audio/Plug-Ins/HAL/BlackHole32ch.driver'
]

export function hasBlackHole(): boolean {
  return BLACKHOLE_DRIVERS.some((path) => existsSync(path))
}
