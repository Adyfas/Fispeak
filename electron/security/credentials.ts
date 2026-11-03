import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * API keys for the cloud translation engines.
 *
 * Keys are encrypted with Electron's `safeStorage`, which is backed by the OS credential
 * store: macOS Keychain, Windows DPAPI, libsecret/kwallet on Linux. Only the ciphertext is
 * written to `userData/secrets.json`; the plaintext key never touches the disk and never
 * appears in settings.json (which is plain JSON and easily grepped).
 *
 * One key per provider: the same OpenRouter key serves STT and MT.
 */

const SECRETS_FILE = 'secrets.json'

type SecretMap = Record<string, string>

let cache: SecretMap | null = null

function filePath(): string {
  return join(app.getPath('userData'), SECRETS_FILE)
}

function load(): SecretMap {
  if (cache) return cache
  const path = filePath()
  if (!existsSync(path)) {
    cache = {}
    return cache
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    cache = parsed && typeof parsed === 'object' ? (parsed as SecretMap) : {}
  } catch {
    cache = {}
  }
  return cache
}

function persist(map: SecretMap): void {
  const path = filePath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(map, null, 2), { mode: 0o600 })
  } catch {
    // A read-only userData must not crash the app; the key just stays for this session.
  }
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function setSecret(name: string, value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return clearSecret(name)
  if (!encryptionAvailable()) return false
  const map = load()
  map[name] = safeStorage.encryptString(trimmed).toString('base64')
  persist(map)
  return true
}

export function getSecret(name: string): string {
  const stored = load()[name]
  if (!stored || !encryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}

export function hasSecret(name: string): boolean {
  return getSecret(name).length > 0
}

export function clearSecret(name: string): boolean {
  const map = load()
  if (!(name in map)) return true
  delete map[name]
  persist(map)
  return true
}

/** Keychain entry name for an engine provider (`local` never stores anything). */
export function secretName(provider: string): string {
  return `fispeak.engine.${provider}`
}
