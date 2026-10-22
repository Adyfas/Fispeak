"""Tagged audio streams -> VAD windows (12-project-structure `engine/audio_router.py`).

The sidecar keeps one buffer per tag: `you` (mic) and `remote` (system/loopback). The router also
owns the translation direction:

* `remote` speech is translated into `my_lang` (the language the user understands)
* `you` speech is translated into `remote_lang` (the other party); with `auto` there is no
  translation for the user side
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from sidecar.engine import languages
from sidecar.engine.vad import AudioWindow, RollingVadBuffer

TAG_YOU = "you"
TAG_REMOTE = "remote"


@dataclass
class StreamConfig:
    my_lang: str = "id"
    remote_lang: str = "auto"
    session_id: str | None = None
    tts_enabled: bool = False
    tts_voice: str = "af_heart"
    beam_size: int = 2
    whisper_model: str = "small"
    mode: str = "translate_on"

    def to_dict(self) -> dict[str, object]:
        return {
            "my_lang": self.my_lang,
            "remote_lang": self.remote_lang,
            "session_id": self.session_id,
            "tts_enabled": self.tts_enabled,
            "tts_voice": self.tts_voice,
            "beam_size": self.beam_size,
            "whisper_model": self.whisper_model,
            "mode": self.mode,
        }


@dataclass
class AudioRouter:
    config: StreamConfig = field(default_factory=StreamConfig)
    _buffers: dict[str, RollingVadBuffer] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._buffers = {
            TAG_YOU: RollingVadBuffer(TAG_YOU),
            TAG_REMOTE: RollingVadBuffer(TAG_REMOTE),
        }

    def push(self, tag: str, samples: np.ndarray) -> list[AudioWindow]:
        buffer = self._buffers.get(tag)
        if buffer is None:
            return []
        return buffer.push(samples)

    def flush(self) -> list[AudioWindow]:
        windows: list[AudioWindow] = []
        for buffer in self._buffers.values():
            windows.extend(buffer.flush())
        return windows

    def reset(self) -> None:
        self._buffers = {
            TAG_YOU: RollingVadBuffer(TAG_YOU),
            TAG_REMOTE: RollingVadBuffer(TAG_REMOTE),
        }

    def target_language(self, tag: str) -> str | None:
        """FLORES code the given stream should be translated into (None = no translation)."""
        code = self.target_language_code(tag)
        if not code:
            return None
        return languages.to_flores(code)

    def target_language_code(self, tag: str) -> str | None:
        """UI language code the given stream should be translated into (None = no translation)."""
        if tag == TAG_REMOTE:
            code = self.config.my_lang
        elif tag == TAG_YOU:
            code = self.config.remote_lang
        else:
            return None
        if not code or code.lower() == languages.AUTO:
            return None
        return code

    def source_language(self, tag: str) -> str | None:
        """Whisper language hint for the given stream (None = let Whisper detect it)."""
        if tag == TAG_YOU:
            code = self.config.my_lang
        elif tag == TAG_REMOTE:
            code = self.config.remote_lang
        else:
            return None
        if not code or code.lower() == languages.AUTO:
            return None
        return languages.to_whisper(code)
