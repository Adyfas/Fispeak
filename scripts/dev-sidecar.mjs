#!/usr/bin/env node
/**
 * `pnpm dev:sidecar` - run the Python sidecar in dev mode (09-sidecar-spec §1.1).
 *
 * The Electron main process can also spawn the sidecar itself (electron/sidecar/sidecarManager.ts);
 * this script exists for manual runs, for the WS test client and for debugging.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'sidecar', 'main.py')
const venvPython =
  process.platform === 'win32'
    ? join(root, '.venv', 'Scripts', 'python.exe')
    : join(root, '.venv', 'bin', 'python')

if (!existsSync(entry)) {
  console.error('[fispeak] sidecar/main.py does not exist yet - the Python sidecar is Phase 2.')
  console.error('[fispeak] See the vault: fispeak/11-roadmap.md (PHASE 2).')
  process.exit(1)
}

const python = process.env.FISPEAK_PYTHON ?? venvPython
if (!existsSync(python)) {
  console.error(`[fispeak] python runtime not found: ${python}`)
  console.error('[fispeak] create it with:')
  console.error('[fispeak]   /opt/homebrew/bin/python3.11 -m venv .venv')
  console.error('[fispeak]   .venv/bin/pip install -r sidecar/requirements.txt')
  process.exit(1)
}

const child = spawn(python, [entry, '--mode', 'normal'], { cwd: root, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
