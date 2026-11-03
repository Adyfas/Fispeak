"""Paths and constants shared by the sidecar modules.

Every large artifact (models, logs, port file) lives under the Electron `userData` directory,
never next to the source tree. `FISPEAK_DATA_DIR` / `FISPEAK_MODELS_DIR` override the paths for
tests and for the Electron dev launcher.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "fispeak"
VERSION = "0.1.0"

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
PORT_SCAN_STOP = 8770

# Audio contract (09-sidecar-spec §3.1): Float32, 16 kHz, mono, 200 ms frames.
SAMPLE_RATE = 16_000
FRAME_MS = 200
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # 3200
FRAME_BYTES = FRAME_SAMPLES * 4  # 12_800


def _default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
        return Path(base) / APP_NAME
    base = os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config")
    return Path(base) / APP_NAME


def data_dir() -> Path:
    override = os.environ.get("FISPEAK_DATA_DIR")
    return Path(override).expanduser() if override else _default_data_dir()


def models_dir() -> Path:
    override = os.environ.get("FISPEAK_MODELS_DIR")
    return Path(override).expanduser() if override else data_dir() / "models"


def logs_dir() -> Path:
    return data_dir() / "logs"


def port_file() -> Path:
    return data_dir() / "sidecar.port"


# Model folder names inside `models_dir()`; also the names used by the Electron ModelManager.
STT_MODEL_DIR = "faster-whisper-small"
MT_MODEL_DIR = "nllb-200-distilled-600M-ct2-int8"

# Files that must exist before an engine may lazy-load (CORRECTION 2026-10-22 in 06/07 docs).
STT_MODEL_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
MT_MODEL_FILES = ("config.json", "model.bin", "shared_vocabulary.json", "tokenizer.json")

# Rolling VAD defaults (06-stt-engine §4.1).
VAD_SILENCE_FRAMES = 20  # 20 x 200 ms = 4 s of silence closes a window
VAD_MIN_SPEECH_FRAMES = 15  # 3 s minimum; see CORRECTION note (do not lower without A/B data)
# Max window before the speech is cut and processed. 06-stt-engine §4.1 said 30 s, but with
# continuous speech (a meeting, a video) the first line then only arrives after 30 s - see the
# CORRECTION section in 06-stt-engine.md (2026-10-22). Lowered again to 6 s so live subtitles
# of a continuous video arrive every few seconds instead of every 15 s.
VAD_MAX_WINDOW_MS = 6_000
VAD_OVERLAP_MS = 800
VAD_RMS_FLOOR = 0.004
