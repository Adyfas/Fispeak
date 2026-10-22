"""Shared state of the running sidecar (engines, stream config, shutdown flag)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path

from sidecar import config
from sidecar.engine.audio_router import StreamConfig
from sidecar.engine.mt import TranslationEngine, get_engine
from sidecar.engine.stt import SttEngine


@dataclass
class SidecarState:
    models_dir: Path | None = None
    port: int = config.DEFAULT_PORT
    stream: StreamConfig = field(default_factory=StreamConfig)
    stt: SttEngine = field(default_factory=SttEngine)
    mt: TranslationEngine = field(default_factory=lambda: get_engine("nllb"))
    shutdown_requested: asyncio.Event = field(default_factory=asyncio.Event)

    def models_report(self) -> dict[str, object]:
        return {"stt": self.stt.status, "mt": self.mt.status}
