---
name: fispeak
description: Use when working on fispeak / floating-app, the Electron dynamic-island app with a local Python sidecar (faster-whisper, NLLB-200, Kokoro TTS). Covers required Obsidian memory reads, phase order, architecture contracts, and progress logging. Use ONLY for this repo, not generic Electron or Python tasks.
---

# fispeak Implementation Skill

## First action every session

Read the project memory before touching code. The repo itself is only the build target; the approved spec lives outside it.

1. `AGENTS.md` in this repo.
2. `/Users/adyfas/Documents/Obsidian Vault/fispeak/README.md` - master index and final decisions.
3. `/Users/adyfas/Documents/Obsidian Vault/fispeak/PROGRESS.md` - current cross-agent state. Never repeat completed work.
4. `/Users/adyfas/Documents/Obsidian Vault/fispeak/11-roadmap.md` - active phase and acceptance criteria.
5. The task-specific docs listed below.

If the Obsidian path is missing, stop and ask the owner. Do not reconstruct the spec from memory or guess.

## Current status

- Phase 0 planning is complete. All 14 spec docs plus `04b-ui-notchnook-reference.md` exist in the Obsidian vault, and every corrected doc carries a `CORRECTION` section (2026-10-22) - read those before implementing.
- This repo is still empty: no `package.json`, no source, no git history.
- Do not scaffold Phase 1 unless the owner explicitly asks for implementation. Until then, this is an understanding/spec-review task.

## Workflow

1. Read `PROGRESS.md` and the roadmap. Identify the next incomplete phase.
2. Read the docs for that phase before editing anything.
3. Implement the smallest testable slice for the phase; do not skip phases or pull work forward.
4. Run the phase verification (see Commands). Prefer focused single tests while iterating.
5. Append a dated entry to the Obsidian `PROGRESS.md` using the existing format: phase, done, next, blockers/notes. Never delete old entries.
6. If a spec is genuinely wrong, append a `CORRECTION` section to that doc with the reason. Never rewrite the spec for coding convenience.

## Doc map

| Work area | Doc |
|---|---|
| Product scope, user stories | `01-vision.md` |
| System diagram, process boundaries | `02-architecture.md` |
| Stack and fallbacks (final) | `03-tech-stack.md` |
| Pill states, sizes, animation, click-through | `04-ui-spec.md` |
| Island visuals (NotchNook reference) + window mechanics | `04b-ui-notchnook-reference.md` |
| Mic and system audio per OS | `05-audio-capture.md` |
| Whisper, VAD, anti-hallucination | `06-stt-engine.md` |
| NLLB, FLORES codes, abstract MT interface | `07-translation-engine.md` |
| Kokoro voices, queueing | `08-tts-engine.md` |
| HTTP/WS protocol and frame tags | `09-sidecar-spec.md` |
| Summary, export, SQLite schema | `10-summary-export.md` |
| Phase order and acceptance criteria | `11-roadmap.md` |
| Target folder tree and file ownership | `12-project-structure.md` |
| Bootstrap, commands, env vars | `13-dev-env.md` |
| Risks, edge cases, licenses | `14-risks-notes.md` |

## Non-negotiable contracts

- Audio entering the sidecar is always Float32, 16 kHz, mono, 200 ms frames (3200 samples). Electron resamples everything it captures; the only exceptions are the paths captured natively inside the sidecar (Linux Pulse monitor, macOS < 13 BlackHole), which resample internally before the VAD buffer.
- One WebSocket (`/ws`) to the sidecar. Binary audio frames start with a tag byte: `0x01` = user mic, `0x02` = remote/system, `0x03` = TTS audio from sidecar.
- Sidecar binds `127.0.0.1:8765`, falls back to `8766`-`8770`, writes `userData/sidecar.port`. Electron reads the port file, health-checks, then connects.
- Sidecar owns AI audio work only (STT, MT, TTS, VAD). Electron main owns windows, SQLite, model downloads, summary LLM calls, and TTS playback.
- Summary belongs in Electron main: Ollama `qwen3:4b` first, OpenRouter fallback. Do not add it to the Python sidecar.
- NLLB-200 is CC-BY-NC 4.0. Keep the `TranslationEngine` abstraction so Argos Translate can replace it for commercial use.
- All large paths (models, DB, exports, logs) go under `app.getPath('userData')`, never the install directory.
- Preserve `.commandcode/taste/taste.md`.

## Phase summary

1. **Electron shell** - pill window, hover expand, notes, pomodoro, tray, hotkeys, basic panel. No audio/AI.
2. **Python sidecar** - FastAPI `/health`, `/languages`, `/ws`, `/shutdown`; STT/MT engines; CLI smoke tools; pytest.
3. **Audio + live translate** - per-OS capture, model downloader, transcript UI, session persistence, error wizard.
4. **TTS + summary + export** - English TTS, speaking indicator, summary streaming, `.md`/`.txt` export, history.
5. **Packaging** - PyInstaller sidecar per OS, electron-builder targets, diagnostics, installer audit.

## Commands (after Phase 1 scaffold exists)

Verify `package.json` before trusting these:

- `pnpm dev`, `pnpm dev:sidecar`
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:sidecar`
- `pnpm build`, `pnpm dist`
- Single frontend test: `pnpm vitest run <path>`
- Single sidecar test: `.venv/bin/pytest <test> -q`
- STT smoke: `python sidecar/engine/stt_cli.py --file sidecar/tests/fixtures/en_meeting_30s.wav`
- MT smoke: `python sidecar/engine/mt_cli.py --text "..." --src ind_Latn --tgt eng_Latn`

## Known traps

- Whisper hallucinates on silence: keep `condition_on_previous_text=False`, the blacklist filter, and the silence tests from `06-stt-engine.md`.
- Windows click-through needs cursor polling; `setIgnoreMouseEvents` alone is not enough. Actually: poll the cursor in the **main process** every 60 ms on **every** OS, and compare against the **visible card rect** (not the window bounds), otherwise the transparent area swallows clicks. `forward: true` only works on Windows/Linux, so it is a supplement, never the source of truth. Do not rely on DOM `mouseenter` (the macOS menu bar eats it).
- The island UI is modelled on **NotchNook** (closed-source, commercial: use its design language only, never its code or assets). `04b-ui-notchnook-reference.md` is authoritative for visuals and window mechanics and overrides the visual parts of `04-ui-spec.md`. Two placement modes: `notch` (notched MacBook) and `floating` (everything else).
- `hasShadow: false` on the transparent island window (native shadow is a rectangle), and no `backdrop-blur` (Electron cannot blur other apps' windows). Use solid black + CSS `drop-shadow`.
- Kokoro ONNX lives in `onnx-community/Kokoro-82M-v1.0-ONNX` (`onnx/model.onnx` + `voices/<id>.bin`). `hexgrad/Kokoro-82M` has **no** ONNX file - the download 404s.
- macOS system audio needs ScreenCaptureKit on 13+; BlackHole is the documented fallback, not a silent replacement.
- MVP TTS is English-only. If the target language has no Kokoro voice, show the text and a clear notice; never call a cloud TTS.
- NLLB lazy-loads. Missing models produce `model_missing`, which the Electron downloader must handle.
- Model downloads are on-demand and checksum-verified; do not bundle multi-GB models into the installer.
- Do not hardcode language mappings in two places. `sidecar/engine/languages.py` is the source of truth and is served over `/languages`.
