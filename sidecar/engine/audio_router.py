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

from sidecar import config
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
    # The application sends "auto" (resolved per provider in ws.py). A bare client that never
    # sends stt_mode keeps the historical batch behaviour.
    stt_mode: str = "batch"
    retranscribe_ms: int = 900
    commit_min_words: int = 12
    commit_silence_ms: int = 400
    # listen = system audio only, speak = microphone only, both = accept every frame.
    capture_mode: str = "both"
    # Window limits; Electron overrides them with the "quality" preset before audio starts.
    vad_max_window_ms: int = config.VAD_MAX_WINDOW_MS
    vad_silence_ms: int = config.VAD_SILENCE_FRAMES * config.FRAME_MS
    vad_min_speech_ms: int = config.VAD_MIN_SPEECH_FRAMES * config.FRAME_MS

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
            "stt_mode": self.stt_mode,
            "capture_mode": self.capture_mode,
            "retranscribe_ms": self.retranscribe_ms,
            "commit_min_words": self.commit_min_words,
            "commit_silence_ms": self.commit_silence_ms,
            "vad_max_window_ms": self.vad_max_window_ms,
            "vad_silence_ms": self.vad_silence_ms,
            "vad_min_speech_ms": self.vad_min_speech_ms,
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
        self.apply_config()

    def apply_config(self) -> None:
        """Push the current window limits into both buffers (called on every config frame)."""
        for buffer in self._buffers.values():
            buffer.configure(
                silence_ms=self.config.vad_silence_ms,
                min_speech_ms=self.config.vad_min_speech_ms,
                max_window_ms=self.config.vad_max_window_ms,
            )

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
        self.__post_init__()

    def reset_tag(self, tag: str) -> None:
        """Drop buffered audio for one stream (used when switching LISTEN <-> SPEAK)."""
        if tag in self._buffers:
            self._buffers[tag] = RollingVadBuffer(tag)
            self._buffers[tag].configure(
                silence_ms=self.config.vad_silence_ms,
                min_speech_ms=self.config.vad_min_speech_ms,
                max_window_ms=self.config.vad_max_window_ms,
            )

    def target_language(self, tag: str) -> str | None:
        """FLORES code the given stream should be translated into (None = no translation)."""
        code = self.target_language_code(tag)
        if not code:
            return None
        return languages.to_flores(code)

    def target_language_code(self, tag: str) -> str | None:
        """UI language code the given stream should be translated into (None = no translation)."""
        # Prompt dictation: transcribe only, never translate (and never load MT).
        if self.config.mode == "stt_only":
            return None
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
