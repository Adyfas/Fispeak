<p align="center">
  <img src="public/icon/FISPEAK.png" alt="fispeak logo" width="170" />
</p>

<h1 align="center">fispeak</h1>

<p align="center">
  A cross-platform meeting translator that lives in a floating island.
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-7C4DFF" />
  <img alt="Platform: macOS, Windows, Linux" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-000000" />
  <img alt="Electron 45" src="https://img.shields.io/badge/Electron-45-47848F" />
  <img alt="Local or API engines" src="https://img.shields.io/badge/AI-local%20or%20API-4CD964" />
</p>

---

**fispeak** is an always-on-top desktop island for **macOS, Windows, and Linux** that listens to
a meeting, translates it live, and speaks your reply in the other language. It can run entirely
on your machine for privacy, or use an OpenAI-compatible API when local models are too heavy for
your hardware.

It is built as an Electron app with a Python AI sidecar, and it is designed to stay out of the
way: the island is click-through until you hover it, then it expands into a compact set of
feature pages.

> **Status:** active development. The island UI, live translation pipeline, TTS, and voice
> cloning are working. The **macOS** capture path is verified today; **Windows (WASAPI) and Linux
> (Pulse/PipeWire) capture** are the next cross-platform milestone. Meeting summary, transcript
> export, and signed installers are still in progress.

---

## Features

| Page         | What it does                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Prompt**   | Dictate into any focused app. Stop flushes the take and pastes it with `⌘V` / `Ctrl+V`. Optional **AI prompt upgrade** rewrites a rough spoken idea into a detailed, prompt-engineered brief before pasting. |
| **Listen**   | Captures the **system audio** (the other person in a meeting, a video, a call) and shows live translated subtitles.                                                                                          |
| **Speak**    | Captures **your microphone**, translates what you say, and reads the translation aloud so the other side can hear it.                                                                                        |
| **Voice**    | Records a short reference sample and clones your voice locally with **Qwen3-TTS** (Apple Silicon). Kokoro-82M is the default built-in voice.                                                                 |
| **Notes**    | Quick notes and checklists, stored locally.                                                                                                                                                                  |
| **Focus**    | Pomodoro timer with work / short break / long break modes.                                                                                                                                                   |
| **Sessions** | Transcript history of past translations, stored in a local SQLite database.                                                                                                                                  |
| **Settings** | Engines, models, languages, TTS output (speaker or virtual mic), idle behaviour, and more.                                                                                                                   |
| **Clock**    | Clock and date for the idle island.                                                                                                                                                                          |

The island also has a **vertical feature rail** on the right edge. It is a set of separate round
buttons, and hovering one reveals its label word by word.

---

## How it works

fispeak is a three-process app. The renderer is deliberately dumb: it only draws UI and sends
IPC. All privileged work (windows, database, audio, network) happens in the main process, and all
heavy AI work happens in the Python sidecar.

```
 microphone (hidden window) ─┐
 system audio (per-OS capture) ─┤   16 kHz mono, 200 ms frames
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

1. **Capture** — the microphone is read in a hidden window; system audio comes from a per-OS
   backend (ScreenCaptureKit on macOS, WASAPI loopback on Windows, Pulse/PipeWire monitor on
   Linux). Everything is resampled to 16 kHz mono and cut into 200 ms frames.
2. **Transport** — frames go to the Python sidecar over a local WebSocket. The renderer never
   talks to the sidecar directly; main broadcasts events to every window over IPC.
3. **Speech to text** — a rolling VAD finds speech windows and an STT engine transcribes them:
   `faster-whisper` locally, or an OpenAI-compatible API (OpenRouter, custom endpoint).
4. **Translation** — `NLLB-200-distilled-600M` locally, or a remote engine (Ollama, OpenRouter,
   or any OpenAI-compatible endpoint). Engines are swappable in Settings; the pipeline stays the
   same.
5. **Text to speech** — Kokoro-82M or a cloned Qwen3-TTS voice synthesises a WAV in the sidecar;
   Electron plays it to the speaker, or to a virtual audio device so it can be heard in the call.
6. **Display** — the island renders subtitles, the live waveform, and the session state. The
   SQLite database keeps notes, settings, and transcript history.

**Why a separate sidecar?** Python owns the audio models, so the Electron process stays light
and the AI stack can be upgraded or replaced without touching the UI. The sidecar is started on
demand and released when idle, which keeps RAM flat when fispeak is not being used.

### Local or API engines

fispeak ships with local engines and also speaks the OpenAI-compatible API, so you can pick the
trade-off that fits your machine:

| Task              | Local                 | API / remote                 | Notes                                  |
| ----------------- | --------------------- | ---------------------------- | -------------------------------------- |
| Speech to text    | `faster-whisper`      | OpenRouter, custom endpoint  | Remote STT sends audio to the provider |
| Translation       | NLLB-200              | Ollama, OpenRouter, custom   | Remote MT is much lighter on CPU/RAM   |
| Text to speech    | Kokoro-82M, Qwen3-TTS | —                            | TTS is local today                     |
| Prompt AI upgrade | Off                   | OVHcloud, OpenRouter, Ollama | OVH works anonymously (rate-limited)   |
| Meeting summary   | Planned               | Ollama, OpenRouter           | Phase 4                                |

Local engines keep audio and transcripts on the machine and need no account or API key. Remote
engines are a good fit when the machine cannot carry multi-GB models, or when CPU/GPU headroom is
needed for the meeting itself. Nothing leaves the machine unless you explicitly select a remote
provider; there is no telemetry and no analytics.

---

## Tech stack

| Layer          | Technology                                              |
| -------------- | ------------------------------------------------------- |
| Desktop shell  | Electron 45, electron-vite, electron-builder            |
| Renderer       | React 18, TypeScript (strict), Tailwind CSS v4, Zustand |
| Database       | better-sqlite3 (WAL, local file)                        |
| Sidecar        | Python 3.11, FastAPI/uvicorn, WebSocket                 |
| Speech to text | faster-whisper (CTranslate2, int8, CPU) or remote API   |
| Translation    | NLLB-200-distilled-600M (CT2 int8) or remote LLM        |
| Text to speech | Kokoro-82M ONNX, Qwen3-TTS 0.6B (MLX)                   |
| Remote engines | OpenAI-compatible: OpenRouter, OVHcloud, Ollama, custom |
| Tests          | Vitest + Testing Library, pytest                        |
| Tooling        | pnpm 10, ESLint 9, Prettier                             |

---

## Requirements

**Supported platforms**

| Platform    | System audio capture              | Status      |
| ----------- | --------------------------------- | ----------- |
| macOS 13+   | ScreenCaptureKit (bundled helper) | Verified    |
| Windows 10+ | WASAPI loopback (native addon)    | In progress |
| Linux       | PulseAudio / PipeWire monitor     | In progress |

The app is cross-platform by design; the macOS capture path is the one verified on real hardware
today. Windows and Linux capture are tracked in the roadmap and are not macOS-only by intent.

**Toolchain**

- **Node.js 20+** and **pnpm 10**
- **Python 3.11** (the sidecar does not support 3.14 yet)
- **ffmpeg** — used when saving a voice sample
- **macOS:** Screen Recording and Accessibility permissions (system audio and auto-paste)
- Optional: **Ollama** for a local or self-hosted LLM
- Optional: **BlackHole** (macOS) or an equivalent virtual audio device to route spoken
  translations into a meeting
- Voice cloning needs **Apple Silicon** (MLX); other platforms can use Kokoro

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

On Windows the venv lives in `.venv\Scripts\` — use `.venv\Scripts\pip` instead.

The sidecar is started on demand by the app. To run it alone while debugging:

```bash
pnpm dev:sidecar
```

### Models

If you use **local engines**, models are downloaded on demand into
`~/Library/Application Support/fispeak/models` (`%APPDATA%\fispeak\models` on Windows,
`~/.config/fispeak/models` on Linux):

- Open the panel → **Download** tab → install the essential pack (Whisper + NLLB), or
- install only the models you need from the same tab.

If you only use **remote engines**, you do not need to download any model.

For a quick development setup you can also fetch the two core models directly:

```bash
pnpm sidecar:models
```

On Apple Silicon, the voice-clone model (`mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16`) is
downloaded separately; the Voice page explains what is missing if it is not installed yet.

### Useful commands

| Command             | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Run Electron + sidecar in development                               |
| `pnpm dev:sidecar`  | Run the Python sidecar alone                                        |
| `pnpm typecheck`    | TypeScript check (main + renderer)                                  |
| `pnpm lint`         | ESLint                                                              |
| `pnpm test`         | Vitest (renderer + main)                                            |
| `pnpm test:sidecar` | pytest (Python sidecar)                                             |
| `pnpm build`        | Type-check and build the app                                        |
| `pnpm dist`         | Build an installer for the current OS (DMG / NSIS / AppImage + deb) |
| `pnpm dist:all`     | Build macOS, Windows, and Linux installers                          |

### Keyboard shortcuts

| Shortcut                 | Action                                  |
| ------------------------ | --------------------------------------- |
| `⌘ ⇧ F` / `Ctrl Shift F` | Show / hide the live translation island |
| `⌘ ⇧ H` / `Ctrl Shift H` | Show / hide the idle pill               |

---

## Project structure

```
electron/            Electron main process
  audio/             per-OS capture, resampling, native helper bridge
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
native/              native capture helpers (ScreenCaptureKit today)
scripts/             dev tooling
```

---

## Roadmap

- [x] Dynamic island UI, feature rail, hover labels
- [x] On-demand sidecar lifecycle (RAM stays flat when idle)
- [x] Local STT + MT pipeline (verified on macOS)
- [x] Remote OpenAI-compatible engines (OpenRouter, Ollama, custom)
- [x] TTS: Kokoro-82M and Qwen3-TTS voice cloning
- [x] Prompt page with optional AI prompt upgrade
- [ ] Windows (WASAPI) and Linux (Pulse/PipeWire) audio capture
- [ ] Meeting summary (local Ollama or remote)
- [ ] Transcript export
- [ ] Signed installers and auto-update

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
