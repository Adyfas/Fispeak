# AGENTS.md

## What this repo is

`floating-app` is the implementation repo for **fispeak**: a cross-platform Electron "dynamic island" (always-on-top pill) with a local Python sidecar for offline speech translation (faster-whisper STT -> NLLB-200 MT -> Kokoro TTS), plus clock, notes, pomodoro, AI meeting summary, and transcript export.

## Current state (verified 2026-10-22, Phase 1 + Phase 2 complete)

- Phase 1 (Electron UI shell) is **implemented and verified at runtime on macOS**: pill island with hover expand, quick notes (SQLite, max 50), pomodoro with notification, tray, global hotkeys, panel window, settings persistence.
- Phase 2 (Python sidecar) is **implemented and verified**: `sidecar/` FastAPI service with exactly `/health`, `/languages`, `/ws`, `/shutdown`; faster-whisper STT (anti-hallucination) + NLLB-200 CT2 MT behind an abstract engine; CLI smoke tools; 33 pytest green; Electron spawns/reuses/shuts it down via `electron/sidecar/sidecarManager.ts`. Still no audio capture and no translate UI (Phase 3).
- Entry points: `electron/main.ts` (main), `preload/index.ts` (typed `window.fispeak` bridge), `src/main.tsx` (renderer; `src/index.html` = island, `src/panel.html` = panel). Contract lives in `shared/api.ts`; card sizes/timing in `shared/island.ts`; sidecar entry `sidecar/main.py` (`--mode normal|doctor`).
- `scripts/` holds `generate-tray-icons.mjs` (PNG tray icons), `dev-sidecar.mjs` (real sidecar launcher), `fetch_dev_models.py` (dev model download), `make_test_fixtures.py` (macOS `say` fixtures), `ws_test_client.py` (manual WS client).
- Git is initialized by the owner; **the agent does not commit**. `.opencode/package.json` + `.opencode/node_modules` are OpenCode tooling, **not** the app manifest.
- Planned, not implemented yet: per-OS audio capture + live translate UI (Phase 3), TTS/summary/export (Phase 4), packaging artifacts (Phase 5).

## Spec lives outside the repo

Authoritative, owner-approved spec: `/Users/adyfas/Documents/Obsidian Vault/fispeak/` (machine-local, deliberately not committed here).

Read in this order before any implementation work:
1. `README.md` - index + final decisions (stack is final; do not re-litigate)
2. `PROGRESS.md` - cross-agent state; read first, append after every milestone (never delete entries)
3. `TASKS.md` - checklist backlog: what is done, what is still open per phase
4. `11-roadmap.md` - phase order + acceptance criteria
5. The doc for the area you touch (`01`-`14`, e.g. `09-sidecar-spec`, `04-ui-spec`).
6. `04b-ui-notchnook-reference.md` - if the work touches the island UI, read this before `04-ui-spec`; it is the NotchNook-derived visual and window-mechanics reference.

Every doc corrected on 2026-10-22 carries a trailing `CORRECTION` section. Read those sections - they supersede the older text above them (e.g. Kokoro's real ONNX repo, the whisper/NLLB file lists, the final sidecar REST surface, the resampling rule for sidecar-native capture paths).

If the vault path is missing, stop and ask the owner. Never invent or reconstruct spec from memory. Store new decisions in the vault, not in a new repo memory file. If a spec is genuinely wrong, append a `CORRECTION` section to that doc with the reason - never edit spec for coding convenience.

## Process boundaries (not obvious from filenames)

- **Electron main** owns: windows, tray, hotkeys, SQLite (`better-sqlite3`), model downloads, audio capture + resampling, WS bridge, TTS playback, and **all LLM/summary calls**.
- **Python sidecar** owns only AI audio work: VAD, STT, MT, TTS synthesis, audio-level events. It keeps no transcript DB.
- **Renderer** is React 18 + Zustand; it never talks to the sidecar directly. One WS connection per Electron runtime, broadcast main -> IPC -> all windows.

## Non-negotiable contracts

- Audio: Float32, 16 kHz, mono, 200 ms frames (3200 samples = 12,800 bytes). Electron resamples everything it captures; the only exceptions are paths captured natively inside the sidecar (Linux Pulse monitor, macOS < 13 BlackHole), which resample internally before the VAD buffer.
- WS `/ws` binary frames start with a tag byte: `0x01` = you (mic), `0x02` = remote (system/loopback), `0x03` = TTS audio back to Electron (followed by 4-byte BE requestId length + id + Float32 24 kHz payload).
- Sidecar binds `127.0.0.1:8765`, falls back to `8766`-`8770`, writes the actual port to `userData/sidecar.port`. Electron reads it, retries `/health` up to 10 s, then connects. If a healthy sidecar already exists, reuse it instead of spawning. `/shutdown`, then hard kill after 5 s.
- Phase 2 sidecar surface is only `/health`, `/languages`, `/ws`, `/shutdown`. The REST table in `09-sidecar-spec` still lists `/session/*`, `/models/status`, `/tts/prepare`, but §4.2 revises that away: **summary never runs in Python** (`09-sidecar-spec` > `04-ui-spec` > `02-architecture` when docs conflict).
- `sidecar/engine/languages.py` is the single source of truth for Whisper <-> FLORES-200 codes and is served over `/languages`. Never hardcode language mappings in the frontend too.
- UI is dark-only, and its visual reference is **NotchNook** (commercial, closed source - take the design language only, never the code or assets). `04b-ui-notchnook-reference.md` is authoritative for island visuals and window mechanics and overrides the visual parts of `04-ui-spec.md`. Two placement modes: `notch` (notched MacBook) and `floating` (everything else). Final tuned sizes (2026-10-22): idle **330x34**, tools **500x300**, translate **560x360**, translate-mini **260x46**, error **320x46**, gutter 28, radius **20** (notch keeps the top edge square), card transition **340 ms** expo-out, click blackout **360 ms**, notch content clearance **38 px**. The idle pill always shows the clock (compact, no AM/PM, because the notch wings are narrow). The expanded card is a dashboard of blocks - clock, focus, notes, translate, panel - all sharing `src/components/Block.tsx`. Rationale is recorded in `PROGRESS.md`.
- Expand/collapse choreography: **growing** resizes the window first, then the card animates into it; **shrinking** holds the old window until the card animation ends, then resizes, otherwise the window edge clips the card mid-collapse. In notch placement the card is centered inside the window (absolute position must not move when the window recenters), and the window keeps a constant radius per placement - never animate `border-radius` between pill and panel, that is the "corners pop" bug. Renderer-reported card rects are ignored while `animating` (stale rects would shift the card).
- Click-through = `setIgnoreMouseEvents(true, {forward:true})` **plus** cursor polling in the **main process** every **60 ms** on every OS. Compare against the **visible card rect** (renderer -> IPC), not the window bounds, or the transparent area swallows the user's clicks. `forward: true` only works on Windows/Linux, so it is a supplement, never the source of truth; DOM `mouseenter` is unreliable on macOS. Drag must be implemented manually in the main process (cursor delta -> `setPosition`), not with `-webkit-app-region: drag`. Island window: `hasShadow: false` (native shadow is a rectangle), no `backdrop-blur` (Electron cannot blur other apps), `backgroundThrottling: false`, never auto-`focus()`.
- Models are downloaded on demand, checksum-verified, into `userData/models` - never bundled into the installer.
- All large paths (models, DB, exports, logs) live under `app.getPath('userData')`, never the install directory.
- Stack is fixed: Electron (>= 41 recommended: it fixes the 1 px border and smearing regressions on transparent frameless windows) + electron-vite + electron-builder, React 18, TS strict, Tailwind v4, Zustand, Python 3.11 + FastAPI/uvicorn, PyInstaller `--onedir`, faster-whisper `small` int8 CPU, NLLB-200-distilled-600M CT2 int8, Kokoro-82M ONNX fp32 (`onnx-community/Kokoro-82M-v1.0-ONNX`).
- NLLB is CC-BY-NC 4.0. Keep `TranslationEngine`/MT worker behind an abstract interface so Argos Translate can replace it for commercial use.
- Code, comments, and UI strings are English; user-facing error copy may be casual. No i18n framework in the MVP.
- Preserve `.commandcode/taste/taste.md`.

## Known traps

- Whisper hallucinates on silence. Keep `condition_on_previous_text=False`, the `no_speech_prob > 0.6` / `avg_logprob < -1.0` filter, and the blacklist regex from `06-stt-engine` §4.3-4.4; `test_stt_hallucination.py` (4 s silence -> 0 segments) must stay green.
- macOS `type:'panel'` **does accept keyboard input** (verified Phase 1: notes typing works), so no `type:'normal'` fallback is needed. The island still never calls `focus()`; it uses `showInactive()` + `acceptFirstMouse`.
- pnpm 10 silently skips dependency build scripts. Keep `pnpm.onlyBuiltDependencies = ["better-sqlite3", "electron", "esbuild"]` or the Electron binary / natives go missing.
- Sidecar pings Electron every 10 s; >10 s without pong means restart + reconnect (UI shows a yellow "reconnecting" state). WS send buffer >5 MB: drop remote audio frames, never block.
- NLLB lazy-loads; a missing model yields `model_missing`, which the Electron downloader/panel must handle rather than crash.
- macOS system audio needs a ScreenCaptureKit helper (13+) with BlackHole as an explicit documented fallback, not a silent swap. Windows needs the WASAPI loopback N-API addon (VS Build Tools), Linux uses a Pulse monitor in Python. Native helpers live in `native/`, built into `resources/bin/` (gitignored).
- MVP TTS is English-only. If the target language has no Kokoro voice, show text + a clear notice; never fall back to a cloud TTS.
- Pomodoro countdown is deadline-based (`PomodoroSnapshot.endsAt`); the renderer interpolates locally every 500 ms. Do not re-introduce `startedAt` + an already-decremented `remainingMs`, that double subtraction makes the clock run 2x (Phase 1 bug).
- Notch detection: `display.workArea.y >= 30` first, then the built-in panel aspect ratio (`internal && 1.5 < width/height < 1.58`) for auto-hidden menu bars. Both are heuristics; the Swift helper (Phase 3) replaces them.
- Roadmap acceptance criteria say `npm run ...`; treat `13-dev-env.md` as authoritative: **pnpm** (`npm` only if pnpm is a hard blocker). Single test: `pnpm vitest run <path>`, `.venv/bin/pytest <test> -q`.
- **Python must be 3.11** (`/opt/homebrew/bin/python3.11`); the machine default `python3` is 3.14 and breaks the wheels. The venv lives in `.venv` (gitignored) and the models in `userData/models` (~1.1 GB, download once with `pnpm sidecar:models`).
- The sidecar takes an **exclusive flock** on `userData/sidecar.lock`; a second sidecar on the same data dir refuses to start. `electron/sidecar/sidecarManager.ts` therefore reuses a healthy sidecar instead of spawning a second one.
- `app.quit()` does not finish the quit when `before-quit` was prevented; the main process calls `cleanup()` + `app.exit(0)` itself (see `electron/main.ts`) so the app can never get stuck un-quittable.
- STT latency on this machine: ~9.7 s for 30 s of audio with `cpu_threads = cpu_count // 2` (threads 2 -> 17.9 s, threads 8 -> 20.9 s). If Phase 3 feels slow, lower `beam_size` (2 -> 1) before touching the thread count.

## Commands

Verified in Phase 1 (pnpm 10, Node 24, macOS arm64). The roadmap's `npm run ...` wording is superseded by `13-dev-env.md`: **pnpm**.

- `pnpm dev` - Electron + Vite HMR (renderer on 5173, auto-falls back to 5174 if busy)
- `pnpm typecheck` - `tsc` for the node (main/preload/shared) and web (renderer) projects
- `pnpm lint` - ESLint 9 flat config
- `pnpm test` - Vitest (state machine, island geometry/hit-test, time helpers, Clock). Single file: `pnpm vitest run src/stores/pillStore.test.ts`
- `pnpm build` - typecheck + electron-vite build into `out/` (`main`, `preload`, `renderer/index.html`, `renderer/panel.html`)
- `pnpm dist` / `pnpm dist:all` - electron-builder (Phase 5; icons still missing)
- `pnpm icons` - regenerate `resources/icons/trayTemplate*.png`
- `pnpm dev:sidecar` - runs the Python sidecar in dev mode (needs `.venv` + models)
- `pnpm test:sidecar` - `.venv/bin/pytest sidecar/tests -q` (33 tests, needs the models)
- `pnpm sidecar:doctor` - `.venv/bin/python sidecar/main.py --mode doctor` (JSON diagnostics)
- `pnpm sidecar:models` - `.venv/bin/python scripts/fetch_dev_models.py` (whisper small + NLLB int8)
- `pnpm sidecar:fixtures` - `.venv/bin/python scripts/make_test_fixtures.py` (regenerate the wav fixtures)

Bootstrap: `pnpm install` (pnpm 10 blocks build scripts unless `pnpm.onlyBuiltDependencies` lists `better-sqlite3`, `electron`, `esbuild`; if the Electron binary is missing run `node node_modules/electron/install.js`). better-sqlite3 13 ships N-API prebuilds, so no electron-rebuild step is needed; `pnpm exec electron-builder install-app-deps` is the fallback.

Sidecar commands: `.venv/bin/pytest sidecar/tests/test_mt_en_id.py -q`, `.venv/bin/python sidecar/engine/stt_cli.py --file sidecar/tests/fixtures/en_meeting_30s.wav`, `.venv/bin/python sidecar/engine/mt_cli.py --text "..." --src ind_Latn --tgt eng_Latn`, `.venv/bin/python scripts/ws_test_client.py --file sidecar/tests/fixtures/en_meeting_30s.wav --tag remote --my-lang id`, `.venv/bin/python sidecar/main.py --mode doctor`.

Dev env vars: `FISPEAK_DEBUG=1`, `FISPEAK_SIDECAR_PORT`, `FISPEAK_MODELS_DIR`, `HF_TOKEN` (optional, for HF mirror rate limits). Electron dev renderer port 5173, Ollama 11434.

## Working rules

- Phase order is mandatory and each phase must pass its full `11-roadmap.md` checklist before the next starts: 1 UI shell -> 2 sidecar/CLI -> 3 audio + live translate -> 4 TTS/summary/export -> 5 packaging.
- Commit style is conventional commits (`feat:`, `fix:`, `chore:`); keep commits task-sized. All work happens on this external volume; the repo may not be a git repo yet.
- Verify with the smoke checklist in `13-dev-env.md` §8 and record it in the phase entry of `PROGRESS.md`.
- A project skill exists at `.opencode/skills/fispeak/SKILL.md`; load it (`fispeak`) for the workflow and doc map.
