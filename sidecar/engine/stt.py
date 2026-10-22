"""faster-whisper STT engine with the mandatory anti-hallucination filter.

Contract highlights (06-stt-engine):
* model `small`, CPU, int8, one instance only (never clone per stream)
* `condition_on_previous_text=False`
* drop segments with `no_speech_prob > 0.6` or `avg_logprob < -1.0`
* blacklist the classic Whisper silence phrases, drop <3 chars, collapse repeats after silence
* sticky language: 5 windows in a row with the same code lock detection until confidence drops
"""

from __future__ import annotations

import logging
import math
import os
import re
import threading
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from sidecar import config

log = logging.getLogger("stt")

NO_SPEECH_MAX = 0.6
AVG_LOGPROB_MIN = -1.0
MIN_MEANINGFUL_CHARS = 3
REPEAT_SILENCE_MS = 1200
STICKY_WINDOWS = 5
STICKY_MIN_CONFIDENCE = 0.45

# Classic Whisper silence hallucinations (06-stt-engine §4.3). Keep entries specific enough
# that real meeting sentences still pass.
BLACKLIST_PATTERNS: tuple[str, ...] = (
    r"^thank you for watching[.!]?$",
    r"^thanks for watching[.!]?$",
    r"^please subscribe.*$",
    r"^like and subscribe.*$",
    r"^don'?t forget to subscribe.*$",
    r"^subtitles? by .*$",
    r"^transcri(bed|ption) by .*$",
    r"^amara\.org.*$",
    r"^i'?m sorry,? but i cannot.*$",
    r"^i cannot fulfill (that|this) request.*$",
    r"^as an ai language model.*$",
    r"^important!? read carefully!?$",
    r"^please (read|watch) (the|this) (description|video).*$",
    r"^see you (in the )?next (video|time).*$",
    r"^bye[.!]?$",
    r"^you$",
    r"^\.+$",
    r"^\[?(music|applause|laughter|silence)\]?[.!]?$",
    r"^\(?(music|applause|laughter|silence)\)?[.!]?$",
    r"^approximately[.!]?$",
    r"^okay[.!]?$",
    r"^ok[.!]?$",
    r"^uh[.!]?$",
    r"^um[.!]?$",
    r"^hmm+[.!]?$",
)

# Only applies when the detected language is Arabic-script; otherwise "الله" is legitimate speech.
ARABIC_BLACKLIST: tuple[str, ...] = (r"^الله$", r"^بسم الله.*$")

_BLACKLIST = tuple(re.compile(pattern, re.IGNORECASE) for pattern in BLACKLIST_PATTERNS)
_ARABIC_BLACKLIST = tuple(re.compile(pattern, re.IGNORECASE) for pattern in ARABIC_BLACKLIST)
ARABIC_LANGS = {"ar", "fa", "ur"}


class ModelMissingError(RuntimeError):
    """Raised when the Whisper model files are not on disk (Electron shows the downloader)."""


@dataclass(frozen=True)
class Segment:
    text: str
    lang: str | None
    confidence: float
    started_ms: int
    ended_ms: int


@dataclass(frozen=True)
class TranscriptResult:
    segments: tuple[Segment, ...]
    language: str | None
    language_probability: float

    @property
    def text(self) -> str:
        return " ".join(segment.text for segment in self.segments).strip()


def model_path(models_dir: Path | None = None) -> Path:
    return (models_dir or config.models_dir()) / config.STT_MODEL_DIR


def model_status(models_dir: Path | None = None) -> dict[str, object]:
    root = model_path(models_dir)
    missing = [name for name in config.STT_MODEL_FILES if not (root / name).exists()]
    return {"ok": not missing, "path": str(root), "missing": missing}


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def is_hallucination(
    text: str,
    *,
    lang: str | None = None,
    no_speech_prob: float = 0.0,
    avg_logprob: float = 0.0,
) -> bool:
    cleaned = text.strip()
    if len(cleaned) < MIN_MEANINGFUL_CHARS:
        return True
    if no_speech_prob > NO_SPEECH_MAX:
        return True
    if avg_logprob < AVG_LOGPROB_MIN:
        return True

    normalized = normalize(cleaned)
    for pattern in _BLACKLIST:
        if pattern.match(normalized):
            return True
    if (lang or "").lower() in ARABIC_LANGS:
        return False
    for pattern in _ARABIC_BLACKLIST:
        if pattern.match(normalized):
            return True
    return False


class SttEngine:
    """Lazy Whisper wrapper. One model instance, serialized calls (num_workers is a queue)."""

    def __init__(
        self,
        models_dir: Path | None = None,
        *,
        model_name: str = "small",
        cpu_threads: int | None = None,
    ) -> None:
        self._models_dir = models_dir
        self._model_name = model_name
        self._cpu_threads = cpu_threads
        self._model = None
        self._lock = threading.Lock()
        self._recent_langs: deque[str] = deque(maxlen=STICKY_WINDOWS)
        self._locked_lang: str | None = None
        self._last_text: str | None = None
        self._last_end_ms: int | None = None

    # -- lifecycle -------------------------------------------------------------------------
    @property
    def status(self) -> dict[str, object]:
        return model_status(self._models_dir)

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def ensure_loaded(self) -> None:
        if self._model is not None:
            return
        status = self.status
        if not status["ok"]:
            raise ModelMissingError(f"whisper model missing: {status['path']} ({', '.join(status['missing'])})")

        from faster_whisper import WhisperModel  # heavy import, only when needed

        threads = self._cpu_threads or max(1, (os.cpu_count() or 2) // 2)
        log.info("loading whisper model", extra={"fields": {"model": self._model_name, "threads": threads}})
        self._model = WhisperModel(
            str(model_path(self._models_dir)),
            device="cpu",
            compute_type="int8",
            cpu_threads=threads,
            num_workers=2,  # two stream queues, one model instance (06-stt-engine §2)
        )

    def unload(self) -> None:
        with self._lock:
            self._model = None

    # -- language stickiness ----------------------------------------------------------------
    def _language_for_call(self, explicit: str | None) -> str | None:
        if explicit:
            return explicit
        return self._locked_lang

    def _update_language(self, detected: str | None, confidence: float) -> None:
        if not detected:
            return
        if confidence < STICKY_MIN_CONFIDENCE:
            self._recent_langs.clear()
            self._locked_lang = None
            return
        if self._locked_lang == detected:
            return
        self._recent_langs.append(detected)
        if len(self._recent_langs) == STICKY_WINDOWS and len(set(self._recent_langs)) == 1:
            self._locked_lang = detected
            log.info("language locked", extra={"fields": {"lang": detected}})

    def reset_language(self) -> None:
        self._recent_langs.clear()
        self._locked_lang = None
        self._last_text = None
        self._last_end_ms = None

    # -- inference ---------------------------------------------------------------------------
    def transcribe(
        self,
        samples: np.ndarray,
        *,
        language: str | None = None,
        beam_size: int = 2,
        offset_ms: int = 0,
    ) -> TranscriptResult:
        self.ensure_loaded()
        audio = np.asarray(samples, dtype=np.float32).reshape(-1)
        if audio.size == 0:
            return TranscriptResult(segments=(), language=language, language_probability=0.0)

        with self._lock:
            segments, info = self._model.transcribe(
                audio,
                language=self._language_for_call(language),
                beam_size=beam_size,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 450},
                condition_on_previous_text=False,
            )
            raw = list(segments)

        detected = getattr(info, "language", None) or language
        probability = float(getattr(info, "language_probability", 0.0) or 0.0)
        self._update_language(detected, probability)

        kept: list[Segment] = []
        for segment in raw:
            text = segment.text.strip()
            no_speech = float(getattr(segment, "no_speech_prob", 0.0) or 0.0)
            avg_logprob = float(getattr(segment, "avg_logprob", 0.0) or 0.0)
            if is_hallucination(text, lang=detected, no_speech_prob=no_speech, avg_logprob=avg_logprob):
                log.debug("dropped segment", extra={"fields": {"text": text[:80], "no_speech": round(no_speech, 3)}})
                continue

            started = offset_ms + int(round(float(getattr(segment, "start", 0.0)) * 1000))
            ended = offset_ms + int(round(float(getattr(segment, "end", 0.0)) * 1000))

            normalized = normalize(text)
            gap = started - self._last_end_ms if self._last_end_ms is not None else 0
            if normalized == self._last_text and gap >= REPEAT_SILENCE_MS:
                log.debug("dropped repeated segment", extra={"fields": {"text": text[:80], "gap_ms": gap}})
                continue

            self._last_text = normalized
            self._last_end_ms = ended
            kept.append(
                Segment(
                    text=text,
                    lang=detected,
                    confidence=max(0.0, min(1.0, math.exp(avg_logprob))) if avg_logprob else 0.0,
                    started_ms=started,
                    ended_ms=ended,
                )
            )

        return TranscriptResult(segments=tuple(kept), language=detected, language_probability=probability)


def transcribe_file(path: Path, *, models_dir: Path | None = None, language: str | None = None) -> TranscriptResult:
    """CLI/test helper: 16 kHz mono wav in, transcript out."""
    import soundfile as sf

    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sample_rate != config.SAMPLE_RATE:
        raise ValueError(f"expected {config.SAMPLE_RATE} Hz wav, got {sample_rate} Hz ({path})")
    engine = SttEngine(models_dir)
    result = engine.transcribe(audio, language=language)
    engine.unload()
    return result
