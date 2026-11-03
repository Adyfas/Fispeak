"""Console logging for the sidecar.

Two formats share one pipeline:
* **human** (default): `[13:02:11.482] 🎤 INFO  stt: transcribed | lang=en ms=1180 segs=2`
  - this is what the owner sees in the terminal while listening/speaking;
* **json** (`FISPEAK_LOG_JSON=1`): the machine-readable one-line format from 09-sidecar-spec §6.

Every line carries the module icon so a long pipeline scroll is still easy to follow.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone

ICONS: dict[str, str] = {
    "sidecar": "🟣",
    "ws": "📦",
    "stt": "🎤",
    "mt": "🌐",
    "remote": "☁️",
    "vad": "🎙️",
    "audio_router": "🔀",
    "uvicorn.error": "🔌",
    "uvicorn.access": "🔌",
    "faster_whisper": "🎤",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
            + f"{datetime.now().microsecond // 1000:03d}Z",
            "lvl": record.levelname,
            "mod": record.name,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


class HumanFormatter(logging.Formatter):
    """One readable line per event: time, icon, level, module, message, key=value fields."""

    def format(self, record: logging.LogRecord) -> str:
        now = datetime.now()
        stamp = now.strftime("%H:%M:%S.") + f"{now.microsecond // 1000:03d}"
        icon = ICONS.get(record.name, "•")
        message = record.getMessage()
        extra = getattr(record, "fields", None)
        suffix = ""
        if isinstance(extra, dict) and extra:
            suffix = " | " + " ".join(f"{key}={_short(value)}" for key, value in extra.items())
        line = f"[{stamp}] {icon} {record.levelname:<5} {record.name}: {message}{suffix}"
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def _short(value: object) -> str:
    text = str(value)
    return text if len(text) <= 120 else text[:117] + "..."


NOISY_LOGGERS: dict[str, int] = {
    # Per-request HTTP chatter: the engine logs its own one-line summary instead.
    "httpx": logging.WARNING,
    "httpcore": logging.WARNING,
    "urllib3": logging.WARNING,
    # Uvicorn dumps every WS frame at DEBUG (`< BINARY 02 ...`); the pipeline logs its own steps.
    "uvicorn.error": logging.INFO,
    "uvicorn.access": logging.WARNING,
    "asyncio": logging.WARNING,
    "multipart": logging.WARNING,
}


def setup_logging(debug: bool = False) -> None:
    if debug:
        os.environ.setdefault("FISPEAK_DEBUG", "1")
    level = logging.DEBUG if debug else logging.INFO
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if os.environ.get("FISPEAK_LOG_JSON") == "1" else HumanFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    # uvicorn installs its own colourising handlers; route them through ours so the terminal
    # keeps a single, grep-able shape.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        log = logging.getLogger(name)
        log.handlers.clear()
        log.propagate = True
    for name, noisy_level in NOISY_LOGGERS.items():
        logging.getLogger(name).setLevel(noisy_level)


def log(mod: str, msg: str, level: int = logging.INFO, **fields: object) -> None:
    logging.getLogger(mod).log(level, msg, extra={"fields": fields} if fields else None)
