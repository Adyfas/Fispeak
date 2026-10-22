#!/usr/bin/env node
/**
 * `pnpm dev:sidecar` placeholder. The Python sidecar is Phase 2 (11-roadmap); this keeps the
 * documented command honest instead of silently doing nothing.
 */
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'sidecar', 'main.py')

if (!existsSync(entry)) {
  console.error('[fispeak] sidecar/main.py does not exist yet - the Python sidecar is Phase 2.')
  console.error('[fispeak] See the vault: fispeak/11-roadmap.md (PHASE 2).')
  process.exit(1)
}

const python = process.env.FISPEAK_PYTHON ?? '.venv/bin/python'
const child = spawn(python, [entry, '--mode', 'normal'], { cwd: root, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
