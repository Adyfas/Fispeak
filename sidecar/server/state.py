"""Shared state of the running sidecar (engines, stream config, shutdown flag)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sidecar import config
from sidecar.engine.audio_router import StreamConfig
from sidecar.engine.mt import TranslationEngine, get_engine
from sidecar.engine.stt import SttEngine


@dataclass
class SidecarState:
    models_dir: Path | None = None
    port: int = config.DEFAULT_PORT
    stream: StreamConfig = field(default_factory=StreamConfig)
    stt: Any = field(default_factory=SttEngine)
    mt: Any = field(default_factory=lambda: get_engine("nllb"))
    # Which engine the owner picked in Settings (`local` / `openrouter` / `custom` / `ollama`).
    engine_cfg: dict[str, Any] = field(default_factory=dict)
    shutdown_requested: asyncio.Event = field(default_factory=asyncio.Event)

    def models_report(self) -> dict[str, Any]:
        return {"stt": self.stt.status, "mt": self.mt.status}

    def set_engines(self, stt: Any, mt: Any, cfg: dict[str, Any]) -> None:
        """Swap both engines at once; in-flight windows keep their old reference."""
        self.stt = stt
        self.mt = mt
        self.engine_cfg = cfg
