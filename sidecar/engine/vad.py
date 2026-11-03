"""Rolling energy VAD buffer (06-stt-engine §4.1).

The sidecar receives fixed 200 ms frames per stream ("you" / "remote"). This buffer turns the
frame stream into speech windows:

* dynamic RMS threshold = max(floor, 25% of the p95 of the last 10 s)
* 4 s of trailing silence closes a window
* windows shorter than 3 s of speech are dropped (greetings, coughs)
* a window never grows past 15 s (CORRECTION 2026-10-22 in 06-stt-engine.md: 30 s made the
  first transcript of a continuous speaker arrive after half a minute)
* the next window keeps 0.8 s of overlap so the first word is not clipped

Whisper's own Silero `vad_filter` still runs inside `stt.py`; this is the cheap pre-filter that
decides *when* to call it.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np

from sidecar import config


@dataclass(frozen=True)
class AudioWindow:
    tag: str
    samples: np.ndarray  # float32, mono
    started_ms: int
    ended_ms: int
    rms: float


class RollingVadBuffer:
    def __init__(
        self,
        tag: str,
        *,
        sample_rate: int = config.SAMPLE_RATE,
        frame_ms: int = config.FRAME_MS,
        silence_frames: int = config.VAD_SILENCE_FRAMES,
        min_speech_frames: int = config.VAD_MIN_SPEECH_FRAMES,
        max_window_ms: int = config.VAD_MAX_WINDOW_MS,
        overlap_ms: int = config.VAD_OVERLAP_MS,
        rms_floor: float = config.VAD_RMS_FLOOR,
    ) -> None:
        self.tag = tag
        self.frame_samples = sample_rate * frame_ms // 1000
        self.frame_ms = frame_ms
        self.silence_frames = silence_frames
        self.min_speech_frames = min_speech_frames
        self.max_frames = max(1, max_window_ms // frame_ms)
        self.overlap_frames = max(0, overlap_ms // frame_ms)
        self.rms_floor = rms_floor

        self._frames: deque[np.ndarray] = deque()
        self._next_index = 0  # absolute index of the next frame
        self._history: deque[float] = deque(maxlen=50)  # last 10 s of frame RMS
        self._pre_roll = 2  # keep 400 ms of lead-in while idle
        self._speech_frames = 0
        self._silence_run = 0
        self._peak_rms = 0.0
        self._active = False

    # -- introspection (used by tests and diagnostics) -------------------------------------
    @property
    def active(self) -> bool:
        return self._active

    @property
    def buffered_frames(self) -> int:
        return len(self._frames)

    @property
    def threshold(self) -> float:
        if not self._history:
            return self.rms_floor
        return max(self.rms_floor, 0.25 * float(np.percentile(self._history, 95)))

    def configure(
        self,
        *,
        silence_ms: int | None = None,
        min_speech_ms: int | None = None,
        max_window_ms: int | None = None,
    ) -> None:
        """Live-tune the window limits (Electron sends the quality preset per session)."""
        if silence_ms is not None:
            self.silence_frames = max(2, int(silence_ms) // self.frame_ms)
        if min_speech_ms is not None:
            self.min_speech_frames = max(1, int(min_speech_ms) // self.frame_ms)
        if max_window_ms is not None:
            self.max_frames = max(1, int(max_window_ms) // self.frame_ms)

    # -- public API ------------------------------------------------------------------------
    def push(self, frame: np.ndarray) -> list[AudioWindow]:
        samples = np.asarray(frame, dtype=np.float32).reshape(-1)
        if samples.size != self.frame_samples:
            samples = _fit_length(samples, self.frame_samples)

        rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
        self._history.append(rms)
        is_speech = rms >= self.threshold

        if not self._active:
            self._frames.append(samples)
            self._next_index += 1
            if is_speech:
                self._active = True
                self._speech_frames = 1
                self._silence_run = 0
                self._peak_rms = rms
            else:
                while len(self._frames) > self._pre_roll:
                    self._frames.popleft()
            return []

        self._frames.append(samples)
        self._next_index += 1
        self._peak_rms = max(self._peak_rms, rms)

        if is_speech:
            self._speech_frames += 1
            self._silence_run = 0
        else:
            self._silence_run += 1

        if len(self._frames) >= self.max_frames:
            return [self._emit(trim_tail=0)]

        if self._silence_run >= self.silence_frames:
            if self._speech_frames >= self.min_speech_frames:
                # keep two trailing frames so the last syllable is not clipped
                trim = max(0, self._silence_run - 2)
                return [self._emit(trim_tail=trim)]
            self._reset_soft()
        return []

    def flush(self) -> list[AudioWindow]:
        """Emit whatever is buffered (session stop / translate off)."""
        if not self._active or self._speech_frames < self.min_speech_frames:
            self._reset_soft()
            return []
        return [self._emit(trim_tail=0)]

    # -- internals -------------------------------------------------------------------------
    def _emit(self, trim_tail: int) -> AudioWindow:
        frames = list(self._frames)
        kept = frames[: len(frames) - trim_tail] if trim_tail > 0 else frames
        if not kept:  # defensive: trim can never eat the whole window
            kept = frames
        samples = np.concatenate(kept) if kept else np.zeros(0, dtype=np.float32)
        start_frame = self._next_index - len(frames)
        window = AudioWindow(
            tag=self.tag,
            samples=samples,
            started_ms=start_frame * self.frame_ms,
            ended_ms=(start_frame + len(kept)) * self.frame_ms,
            rms=self._peak_rms,
        )

        overlap = min(self.overlap_frames, len(kept))
        self._frames = deque(kept[len(kept) - overlap :]) if overlap else deque()
        self._active = False
        self._speech_frames = 0
        self._silence_run = 0
        self._peak_rms = 0.0
        return window

    def _reset_soft(self) -> None:
        """Drop the current candidate but keep the trailing frames as lead-in."""
        keep = min(self._pre_roll, len(self._frames))
        self._frames = deque(list(self._frames)[len(self._frames) - keep :]) if keep else deque()
        self._active = False
        self._speech_frames = 0
        self._silence_run = 0
        self._peak_rms = 0.0


def _fit_length(samples: np.ndarray, length: int) -> np.ndarray:
    if samples.size == length:
        return samples
    if samples.size > length:
        return samples[:length]
    return np.pad(samples, (0, length - samples.size))


def frame_from_bytes(payload: bytes) -> np.ndarray:
    """Decode a raw little-endian Float32 audio payload (no header, 09-sidecar-spec §3.1)."""
    samples = np.frombuffer(payload, dtype="<f4")
    return np.asarray(samples, dtype=np.float32)


def rms_of(frame: np.ndarray) -> float:
    if frame.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(frame))))
