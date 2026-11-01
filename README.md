<p align="center">
  <img src="public/icon/FISPEAK.png" alt="fispeak logo" width="170" />
</p>

<h1 align="center">fispeak</h1>

<p align="center">
  An offline-first meeting translator that lives in your notch.
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-7C4DFF" />
  <img alt="Platform: macOS 13+" src="https://img.shields.io/badge/platform-macOS%2013%2B-000000" />
  <img alt="Electron 45" src="https://img.shields.io/badge/Electron-45-47848F" />
  <img alt="Local-first" src="https://img.shields.io/badge/AI-local--first-4CD964" />
</p>

---

**fispeak** is a small always-on-top island for macOS that listens to a meeting, translates it
live, and speaks your reply in the other language. Speech recognition, translation, and
text-to-speech run **on your machine** — no account, no API key, no audio leaving the laptop.

It is built as an Electron app with a Python AI sidecar, and it is designed to stay out of the
way: the island is click-through until you hover it, then it expands into a compact set of
feature pages.

> **Status:** active development. The macOS capture + live translation pipeline, TTS, voice
> cloning, and the island UI are working. Meeting summary, transcript export, and signed
> installers are still in progress.

---

## Features

| Page         | What it does                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prompt**   | Dictate into any focused app. Stop flushes the take and pastes it with `⌘V`. Optional **AI prompt upgrade** rewrites a rough spoken idea into a detailed, prompt-engineered brief before pasting. |
| **Listen**   | Captures the **system audio** (the other person in a meeting, a video, a call) and shows live translated subtitles.                                                                               |
| **Speak**    | Captures **your microphone**, translates what you say, and reads the translation aloud so the other side can hear it.                                                                             |
| **Voice**    | Records a short reference sample and clones your voice locally with **Qwen3-TTS** (Apple Silicon). Kokoro-82M is the default built-in voice.                                                      |
| **Notes**    | Quick notes and checklists, stored locally.                                                                                                                                                       |
| **Focus**    | Pomodoro timer with work / short break / long break modes.                                                                                                                                        |
| **Sessions** | Transcript history of past translations, stored in a local SQLite database.                                                                                                                       |
| **Settings** | Engines, models, languages, TTS output (speaker or BlackHole), idle behaviour, and more.                                                                                                          |
| **Clock**    | Clock and date for the idle island.                                                                                                                                                               |

The island also has a **vertical feature rail** on the right edge. It is a set of separate round
buttons, and hovering one reveals its label word by word.

---

## How it works

fispeak is a three-process app. The renderer is deliberately dumb: it only draws UI and sends
IPC. All privileged work (windows, database, audio, network) happens in the main process, and all
heavy AI work happens in the Python sidecar.

```
 microphone (hidden window) ─┐
 system audio (ScreenCaptureKit helper) ─┤   16 kHz mono, 200 ms frames
                                          ▼
                                   Electron main
                                   │  resample · mix · route
                                   │  SQLite · windows · tray · hotkeys
                                   │
                                   └── WebSocket (127.0.0.1:8765) ──► Python sidecar
                                                                       │  VAD
                                                                       │  faster-whisper  (STT)
                                                                       │  NLLB-200       (MT)
                                                                       │  Kokoro / Qwen3-TTS (TTS)
                                   ◄──── JSON events ──────────────────┘
                                          │
                                          ▼
                                   React island
                                   subtitles · waveform · controls
```

**The pipeline, step by step**

1. **Capture** — the microphone is read in a hidden window; system audio comes from a small
   ScreenCaptureKit helper. Both are resampled to 16 kHz mono and cut into 200 ms frames.
2. **Transport** — frames go to the Python sidecar over a local WebSocket. The renderer never
   talks to the sidecar directly; main broadcasts events to every window over IPC.
3. **Speech to text** — a rolling VAD finds speech windows and `faster-whisper` transcribes them
   on CPU (int8).
4. **Translation** — `NLLB-200-distilled-600M` translates locally, or the text is sent to a
   remote engine (Ollama, OpenRouter, or a custom OpenAI-compatible endpoint) if you choose one.
5. **Text to speech** — Kokoro-82M or a cloned Qwen3-TTS voice synthesises a WAV in the sidecar;
   Electron plays it to the speaker, or to BlackHole so it can be used as a virtual microphone.
6. **Display** — the island renders subtitles, the live waveform, and the session state. The
   SQLite database keeps notes, settings, and transcript history.

**Why a separate sidecar?** Python owns the audio models, so the Electron process stays light
and the AI stack can be upgraded or replaced without touching the UI. The sidecar is started on
demand and released when idle, which keeps RAM flat when fispeak is not being used.

### Local-first by default

| Task              | Default                        | Optional cloud                       |
| ----------------- | ------------------------------ | ------------------------------------ |
| Speech to text    | `faster-whisper` (local)       | —                                    |
| Translation       | NLLB-200 (local)               | Ollama, OpenRouter, custom endpoint  |
| Text to speech    | Kokoro-82M / Qwen3-TTS (local) | —                                    |
| Prompt AI upgrade | Off                            | OVHcloud, OpenRouter, Ollama, custom |
| Meeting summary   | Planned                        | Ollama / OpenRouter                  |

Audio and transcripts are **not** sent anywhere unless you explicitly turn on a remote engine or
the Prompt AI upgrade. There is no telemetry and no analytics.

---

## Tech stack

| Layer                | Technology                                              |
| -------------------- | ------------------------------------------------------- |
| Desktop shell        | Electron 45, electron-vite, electron-builder            |
| Renderer             | React 18, TypeScript (strict), Tailwind CSS v4, Zustand |
| Database             | better-sqlite3 (WAL, local file)                        |
| Sidecar              | Python 3.11, FastAPI/uvicorn, WebSocket                 |
| Speech to text       | faster-whisper (CTranslate2, int8, CPU)                 |
| Translation          | NLLB-200-distilled-600M (CT2 int8)                      |
| Text to speech       | Kokoro-82M ONNX, Qwen3-TTS 0.6B (MLX)                   |
| Local LLM (optional) | Ollama                                                  |
| Tests                | Vitest + Testing Library, pytest                        |
| Tooling              | pnpm 10, ESLint 9, Prettier                             |

---

## Requirements

- **macOS 13 (Ventura) or newer** — system audio capture uses ScreenCaptureKit.
  Apple Silicon is recommended; voice cloning needs it (MLX).
- **Node.js 20+** and **pnpm 10**
- **Python 3.11** (the sidecar does not support 3.14 yet)
- **ffmpeg** — used when saving a voice sample (`brew install ffmpeg`)
- **Screen Recording** and **Accessibility** permissions for system audio and auto-paste
- Optional: **Ollama** for a fully local translation LLM
- Optional: **BlackHole 2ch** to route spoken translations into a meeting as a virtual mic

The macOS arm64 ScreenCaptureKit helper ships prebuilt in `resources/bin/`. On another
architecture, build it with `native/sck-capture/build.sh`.

---

## Getting started

```bash
# 1. Clone your fork (see CONTRIBUTING.md if you want to contribute)
git clone https://github.com/Adyfas/Fispeak.git
cd Fispeak

# 2. JavaScript dependencies
pnpm install

# 3. Python sidecar
python3.11 -m venv .venv
.venv/bin/pip install -r sidecar/requirements.txt

# 4. Run the app
pnpm dev
```

The sidecar is started on demand by the app. To run it alone while debugging:

```bash
pnpm dev:sidecar
```

### Models

Models are **not** committed to the repository. The app downloads them on demand into
`~/Library/Application Support/fispeak/models`:

- Open the panel → **Download** tab → install the essential pack (Whisper + NLLB), or
- install only the models you need from the same tab.

For a quick development setup you can also fetch the two core models directly:

```bash
pnpm sidecar:models
```

The voice-clone model (`mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16`) is downloaded separately;
the Voice page explains what is missing if it is not installed yet.

### Useful commands

| Command             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Run Electron + sidecar in development         |
| `pnpm dev:sidecar`  | Run the Python sidecar alone                  |
| `pnpm typecheck`    | TypeScript check (main + renderer)            |
| `pnpm lint`         | ESLint                                        |
| `pnpm test`         | Vitest (renderer + main)                      |
| `pnpm test:sidecar` | pytest (Python sidecar)                       |
| `pnpm build`        | Type-check and build the app                  |
| `pnpm dist`         | Build a macOS installer with electron-builder |

### Keyboard shortcuts

| Shortcut | Action                                  |
| -------- | --------------------------------------- |
| `⌘ ⇧ F`  | Show / hide the live translation island |
| `⌘ ⇧ H`  | Show / hide the idle pill               |

---

## Project structure

```
electron/            Electron main process
  audio/             capture, resampling, ScreenCaptureKit helper bridge
  db/                SQLite stores (notes, sessions, settings)
  engine/            remote engines (Ollama, OpenRouter, custom) + prompt AI
  island/            island window, layout, hover/click-through logic
  models/            model registry + resumable downloader
  sidecar/           sidecar process manager + WebSocket bridge
  translate/         live translation + dictation controllers
  tts/               playback
  windows/           panel window, hidden audio window
preload/             sandboxed preload bridges
src/                 React renderer
  features/          island pages, prompt, translate, notes, focus, settings
  stores/            Zustand stores
  styles/            Tailwind entry + island animations
shared/              cross-process TypeScript contracts
sidecar/             Python AI sidecar (VAD, STT, MT, TTS)
native/              ScreenCaptureKit helper source
scripts/             dev tooling
```

---

## Roadmap

- [x] Dynamic island UI, feature rail, hover labels
- [x] On-demand sidecar lifecycle (RAM stays flat when idle)
- [x] Local STT + MT pipeline on macOS
- [x] TTS: Kokoro-82M and Qwen3-TTS voice cloning
- [x] Prompt page with optional AI prompt upgrade
- [ ] Meeting summary (local Ollama or remote)
- [ ] Transcript export
- [ ] Signed installers and auto-update
- [ ] Windows and Linux audio capture

---

## Contributing

Contributions are welcome — bug fixes, performance work, docs, and new features. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) first: it explains the fork → branch → pull request flow and
the checks a change must pass.

For security issues, please use GitHub's private **Report a vulnerability** flow instead of a
public issue.

---

## License

Released under the [MIT License](LICENSE).

fispeak bundles or downloads third-party models with their own licenses (for example NLLB-200 is
CC-BY-NC 4.0). Check each model's license before commercial use.
