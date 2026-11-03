"""LocalStreamingProvider — LocalAgreement sliding window for realtime STT (M3.5).

Contract (15-revisi-listen-speak-realtime M-A):
- Audio frames are float32, 16 kHz, mono, 200 ms (3200 samples).
- The provider re-transcribes a growing buffer every `retranscribe_ms` and emits a
  *partial* hypothesis that the UI may replace until it commits.
- Commit (final) when one of: end punctuation, `commit_min_words` words, trailing
  silence >= `commit_silence_ms`, or the buffer reached `max_buffer_ms`.
- After a commit an `overlap_ms` tail is kept so the first word of the next phrase is
  not lost (Whisper needs context and the VAD overlap exists for the same reason).
- Real-time factor is measured from the wall-clock time of the transcribe call. When the
  machine cannot keep up (EWMA > 1.0) `fallback_requested` is set and ws.py switches the
  session back to the batch VAD pipeline instead of drifting further behind.
"""

from __future__ import annotations

import time
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from sidecar import config
from sidecar.engine.stt import SttEngine

log = logging.getLogger("streaming")


@dataclass
class StreamPartial:
    """Partial transcript (streaming, not yet committed)."""

    window_id: str
    text: str
    started_ms: float
    ended_ms: float
    confidence: float = 0.0
    tag: str = ""


@dataclass
class StreamFinal:
    """Final committed transcript (no more changes)."""

    window_id: str
    text: str
    started_ms: float
    ended_ms: float
    confidence: float = 0.0
    tag: str = ""
    lang: str = ""
    chunk_id: Optional[str] = None  # assigned by ws.py


class LocalAgreement:
    """Compare consecutive hypotheses (kept for tests / future partial stabilisation)."""

    def __init__(self, min_common_words: int = 2, min_words: int = 12):
        self.min_common_words = min_common_words
        self.min_words = min_words
        self.history: List[str] = []

    def compare(self, h1: str, h2: str) -> Tuple[bool, int]:
        if not h1 or not h2:
            return False, 0
        words1 = h1.split()
        words2 = h2.split()
        common = 0
        for w1, w2 in zip(words1, words2):
            if w1 == w2:
                common += 1
            else:
                break
        return common >= self.min_common_words, common

    def should_commit(self, hyp: str) -> bool:
        if not self.history:
            return False
        agreed, _ = self.compare(self.history[-1], hyp)
        return agreed


def _as_float32(samples: object) -> np.ndarray:
    """Accept an ndarray from ws.py or raw little-endian float32 bytes (tests/CLI)."""
    if isinstance(samples, (bytes, bytearray, memoryview)):
        return np.frombuffer(bytes(samples), dtype="<f4").astype(np.float32, copy=False)
    return np.asarray(samples, dtype=np.float32).reshape(-1)


def _rms(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio))))


def _strip_committed(hyp: str, committed: str) -> str:
    """Drop the words already committed (they reappear because the buffer keeps an overlap).

    Compares the longest suffix of the committed text with the prefix of the new hypothesis,
    so "Hi everyone." + "Hi everyone, thanks for joining" becomes ", thanks for joining".
    Punctuation/case are ignored while comparing, but the original words are kept.
    """
    if not committed:
        return hyp
    hyp_words = hyp.split()
    committed_words = committed.split()

    def key(word: str) -> str:
        return word.strip(".,!?;:\"'()[]").lower()

    committed_keys = [key(word) for word in committed_words]
    hyp_keys = [key(word) for word in hyp_words]
    for count in range(min(len(committed_keys), len(hyp_keys)), 0, -1):
        if committed_keys[-count:] == hyp_keys[:count]:
            return " ".join(hyp_words[count:]).lstrip(" ,.;:-")
    return hyp


class LocalStreamingProvider:
    """LocalAgreement sliding-window streaming STT provider."""

    def __init__(
        self,
        stt_engine: SttEngine,
        retranscribe_ms: int = 400,
        commit_min_words: int = 12,
        commit_silence_ms: int = 400,
        max_buffer_ms: int = 9_000,
        overlap_ms: int = 800,
        min_partial_ms: int = 600,
        commit_hold_words: int = 2,
        voice_rms: float = 0.004,
        rate_per_second: float = 3.0,
        rtf_threshold: float = 1.15,
        rtf_min_audio_ms: int = 2_500,
    ):
        self.stt_engine = stt_engine
        self.retranscribe_ms = retranscribe_ms
        self.commit_min_words = commit_min_words
        self.commit_silence_ms = commit_silence_ms
        self.max_buffer_ms = max_buffer_ms
        self.overlap_ms = overlap_ms
        self.min_partial_ms = min_partial_ms
        self.commit_hold_words = max(0, commit_hold_words)
        self.voice_rms = voice_rms
        self.rate_interval_s = 1.0 / max(0.5, rate_per_second)
        self.rtf_threshold = rtf_threshold
        self.rtf_min_audio_ms = rtf_min_audio_ms

        self.tags: Dict[str, dict] = {}
        # Track committed texts per tag for SPEAK merge-on-finish.
        self._committed_texts: Dict[str, list[str]] = {}
        self._last_emit: Dict[str, float] = {}
        self._languages: Dict[str, Optional[str]] = {}

        # Real-time factor (transcribe wall time / audio duration), exponential moving average.
        self._rtf_ewma: float = 0.0
        self._rtf_alpha = 0.3
        self._rtf_samples = 0
        self.fallback_requested = False

    # -- configuration ------------------------------------------------------------------
    def set_language(self, tag: str, language: Optional[str]) -> None:
        """Whisper language hint for a stream (None = auto-detect)."""
        self._languages[tag] = language

    # -- public API (called by ws.py) ---------------------------------------------------
    def push(self, tag: str, samples: object, started_ms: float) -> None:
        """Append one frame to the tag's rolling buffer and track voice/silence."""
        audio = _as_float32(samples)
        state = self.tags.get(tag)
        if state is None:
            state = {
                "buffer": np.zeros(0, dtype=np.float32),
                "start_ms": float(started_ms),
                "last_transcribe_ms": 0.0,
                "last_voice_ms": float(started_ms),
                "window_id": 1,
                "committed_text": "",
                "partial_text": "",
            }
            self.tags[tag] = state

        state["buffer"] = np.concatenate((state["buffer"], audio))
        if _rms(audio) >= self.voice_rms:
            state["last_voice_ms"] = float(started_ms)

    def poll(self, tag: str) -> Optional[StreamPartial | StreamFinal]:
        """Re-transcribe the buffer and return a partial/final event, if one is due."""
        state = self.tags.get(tag)
        if state is None:
            return None

        now = time.monotonic() * 1000.0
        audio: np.ndarray = state["buffer"]
        # Hard cap: a stalled commit must never let the buffer grow without bound. Keep the
        # most recent window so Whisper still sees the live speech (this was the 1:45 buffer
        # bug: a repeated/empty hypothesis kept `should_commit` true but never trimmed).
        max_samples = int(config.SAMPLE_RATE * (self.max_buffer_ms / 1000.0))
        if audio.size > max_samples:
            audio = np.asarray(audio[-max_samples:], dtype=np.float32)
            state["buffer"] = audio
            state["start_ms"] = now - self.max_buffer_ms
        audio_ms = audio.size / config.SAMPLE_RATE * 1000.0
        if audio_ms < self.min_partial_ms:
            return None

        # At most ~3 events per second per tag.
        if (now - self._last_emit.get(tag, 0.0)) / 1000.0 < self.rate_interval_s:
            return None
        if (now - state["last_transcribe_ms"]) < self.retranscribe_ms:
            return None

        force_commit = audio_ms >= self.max_buffer_ms
        started_at = time.monotonic()
        try:
            result = self.stt_engine.transcribe(
                audio,
                language=self._languages.get(tag),
                beam_size=1,
                offset_ms=int(state["start_ms"]),
                # The provider already owns the energy/commit gate; Silero inside Whisper was
                # removing the whole 9 s microphone buffer on quieter speech.
                vad_filter=False,
            )
        except Exception:
            # A model that is still loading or a provider hiccup: try again on the next poll.
            state["last_transcribe_ms"] = now
            return None
        elapsed = time.monotonic() - started_at
        state["last_transcribe_ms"] = now

        # Real RTF: how long the transcribe call took compared to the audio it covered. Short
        # buffers are ignored: Whisper's cost is ~1.1 s regardless of length (30 s padding), so
        # a 0.6 s buffer would always look "slower than real time" even on a healthy pipeline.
        audio_s = max(audio_ms / 1000.0, 0.2)
        if audio_ms >= self.rtf_min_audio_ms:
            rtf = elapsed / audio_s
            self._rtf_ewma = self._rtf_ewma * (1 - self._rtf_alpha) + rtf * self._rtf_alpha
            self._rtf_samples += 1
            if self._rtf_samples >= 3 and self._rtf_ewma > self.rtf_threshold:
                # ws.py reacts to this flag: stop paying for streaming, go back to VAD windows.
                self.fallback_requested = True
                return None

        hyp = " ".join(segment.text.strip() for segment in result.segments).strip()
        # Remove the overlap that was already committed; the UI must never show it twice.
        hyp = _strip_committed(hyp, state["committed_text"])
        if not hyp:
            return None

        silence_ms = max(0.0, now - state["last_voice_ms"])
        words = len(hyp.split())
        stripped = hyp.rstrip()
        # Whisper appends "..." to audio it could not finish; that is not a sentence boundary.
        ends_sentence = stripped.endswith((".", "!", "?")) and not stripped.endswith("...")
        should_commit = (
            force_commit
            or (ends_sentence and (words >= 8 or silence_ms >= 250))
            or words >= self.commit_min_words
            or silence_ms >= self.commit_silence_ms
        )

        window_id = f"{tag}-{state['window_id']}"
        if should_commit:
            # Hold the last N words unless the sentence is punctuated: ASR often revises the
            # tail, so committing it immediately would freeze a wrong word.
            hold = 0 if ends_sentence else min(self.commit_hold_words, max(0, words - 2))
            commit_words = hyp.split()[:-hold] if hold > 0 else hyp.split()
            commit_text = " ".join(commit_words).strip()
            if not commit_text or commit_text == state["committed_text"]:
                # Nothing new to commit. Keep only a short tail so a repeated/empty
                # hypothesis cannot keep re-transcribing the same growing buffer.
                keep = int(config.SAMPLE_RATE * (self.overlap_ms / 1000.0))
                tail = audio[-keep:] if audio.size > keep else audio
                state["buffer"] = np.asarray(tail, dtype=np.float32)
                state["start_ms"] = now - self.overlap_ms
                state["partial_text"] = ""
                return None
            final = StreamFinal(
                window_id=window_id,
                text=commit_text,
                started_ms=state["start_ms"],
                ended_ms=now,
                confidence=0.9,
                tag=tag,
                lang=str(getattr(result, "language", "") or self._languages.get(tag) or ""),
            )
            state["window_id"] += 1
            state["committed_text"] = commit_text
            state["partial_text"] = ""
            # Track committed text for SPEAK merge-on-finish.
            self._committed_texts.setdefault(tag, []).append(commit_text)
            # Keep the tail so the held words and the next phrase are re-transcribed with
            # context. A held tail needs a slightly longer overlap than a plain commit.
            keep_ms = max(self.overlap_ms, 1_200) if hold > 0 else self.overlap_ms
            keep = int(config.SAMPLE_RATE * (keep_ms / 1000.0))
            tail = audio[-keep:] if audio.size > keep else audio
            state["buffer"] = np.asarray(tail, dtype=np.float32)
            state["start_ms"] = now - keep_ms
            self._last_emit[tag] = now
            log.debug(
                "streaming commit",
                extra={
                    "fields": {
                        "tag": tag,
                        "audio_ms": int(audio_ms),
                        "words": len(commit_text.split()),
                        "hold": hold,
                        "text": commit_text[:120],
                    }
                },
            )
            return final

        if hyp != state["partial_text"]:
            state["partial_text"] = hyp
            self._last_emit[tag] = now
            log.debug(
                "streaming hypothesis",
                extra={
                    "fields": {
                        "tag": tag,
                        "audio_ms": int(audio_ms),
                        "words": len(hyp.split()),
                        "commit": bool(should_commit),
                        "text": hyp[:120],
                    }
                },
            )
            return StreamPartial(
                window_id=window_id,
                text=hyp,
                started_ms=state["start_ms"],
                ended_ms=now,
                confidence=0.5,
                tag=tag,
            )
        return None

    def flush(self, tag: str) -> Optional[StreamPartial | StreamFinal]:
        """Stop/translate_off: drop the partial, never emit a final after stop."""
        state = self.tags.get(tag)
        if state is not None:
            state["buffer"] = np.zeros(0, dtype=np.float32)
            state["partial_text"] = ""
            state["last_transcribe_ms"] = 0.0
        self._last_emit.pop(tag, None)
        return None

    def reset(self, tag: Optional[str] = None) -> None:
        if tag is None:
            self.tags.clear()
            self._last_emit.clear()
            self._rtf_ewma = 0.0
            self._rtf_samples = 0
            self.fallback_requested = False
        else:
            self.tags.pop(tag, None)
            self._last_emit.pop(tag, None)

    def get_status(self) -> dict:
        return {
            "rtf_ewma": round(self._rtf_ewma, 3),
            "rtf_samples": self._rtf_samples,
            "fallback": self.fallback_requested,
            "tags": list(self.tags.keys()),
        }


def build_streaming_provider(stt_engine: SttEngine) -> LocalStreamingProvider:
    return LocalStreamingProvider(stt_engine=stt_engine)
