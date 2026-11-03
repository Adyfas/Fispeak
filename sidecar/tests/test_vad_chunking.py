"""Rolling VAD chunking rules (06-stt-engine §4.1)."""

from __future__ import annotations

import numpy as np

from sidecar import config
from sidecar.engine.vad import RollingVadBuffer, frame_from_bytes


def _frame(value: float, samples: int = config.FRAME_SAMPLES) -> np.ndarray:
    return np.full(samples, value, dtype=np.float32)


def test_speech_then_silence_emits_one_window() -> None:
    # Long max window on purpose: this test is about silence closing a window, not about the
    # (tuned, currently 6 s) default maximum.
    buffer = RollingVadBuffer("remote", max_window_ms=15_000)
    windows = []
    for _ in range(20):  # 4 s of speech
        windows.extend(buffer.push(_frame(0.2)))
    assert windows == []

    for _ in range(config.VAD_SILENCE_FRAMES):
        windows.extend(buffer.push(_frame(0.0)))

    assert len(windows) == 1
    window = windows[0]
    assert window.tag == "remote"
    # 20 speech frames plus the two kept silence frames
    assert window.samples.size == 22 * config.FRAME_SAMPLES
    assert window.started_ms == 0
    assert window.ended_ms == 22 * config.FRAME_MS


def test_short_burst_is_dropped() -> None:
    buffer = RollingVadBuffer("remote")
    windows = []
    for _ in range(5):  # 1 s of speech, below the 3 s minimum
        windows.extend(buffer.push(_frame(0.2)))
    for _ in range(config.VAD_SILENCE_FRAMES + 2):
        windows.extend(buffer.push(_frame(0.0)))
    assert windows == []


def test_window_is_cut_at_the_maximum_length() -> None:
    buffer = RollingVadBuffer("remote")
    windows = []
    for _ in range(config.VAD_MAX_WINDOW_MS // config.FRAME_MS + 5):
        windows.extend(buffer.push(_frame(0.2)))
    assert len(windows) == 1
    assert windows[0].samples.size == config.VAD_MAX_WINDOW_MS // config.FRAME_MS * config.FRAME_SAMPLES


def test_overlap_is_kept_for_the_next_window() -> None:
    buffer = RollingVadBuffer("remote", max_window_ms=15_000)
    for _ in range(20):
        buffer.push(_frame(0.2))
    windows = []
    for _ in range(config.VAD_SILENCE_FRAMES):
        windows.extend(buffer.push(_frame(0.0)))
    assert len(windows) == 1

    # the next window starts with the 0.8 s overlap of the previous one
    buffer.push(_frame(0.2))
    assert buffer.buffered_frames == config.VAD_OVERLAP_MS // config.FRAME_MS + 1


def test_default_max_window_is_short_enough_for_live_subtitles() -> None:
    # A continuous speaker (a video) must produce lines every few seconds, not every 15-30 s.
    assert config.VAD_MAX_WINDOW_MS <= 8_000


def test_configure_applies_the_quality_preset() -> None:
    # Electron sends the preset on every config frame: a longer window and a shorter silence
    # gate must take effect without rebuilding the buffer.
    buffer = RollingVadBuffer("remote")
    buffer.configure(silence_ms=600, min_speech_ms=400, max_window_ms=2_000)

    windows = []
    for _ in range(5):  # 1 s of speech is enough once min_speech_ms is lowered
        windows.extend(buffer.push(_frame(0.2)))
    for _ in range(3):  # 600 ms of silence closes it
        windows.extend(buffer.push(_frame(0.0)))
    assert len(windows) == 1

    windows = []
    for _ in range(9):  # continuous speech is cut at the new 2 s maximum
        windows.extend(buffer.push(_frame(0.2)))
    assert len(windows) == 1
    assert windows[0].samples.size == 10 * config.FRAME_SAMPLES


def test_frame_bytes_round_trip() -> None:
    samples = np.linspace(-1.0, 1.0, config.FRAME_SAMPLES, dtype=np.float32)
    decoded = frame_from_bytes(samples.astype("<f4").tobytes())
    assert decoded.size == config.FRAME_SAMPLES
    assert np.allclose(decoded, samples, atol=1e-6)
