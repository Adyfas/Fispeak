"""Kokoro local TTS (Phase 3.3c). Skips when the model files are not installed."""

from __future__ import annotations

from pathlib import Path

import pytest

from sidecar.engine.tts import (
    KokoroEngine,
    TtsModelMissingError,
    TtsUnsupportedLanguageError,
    model_status,
)


def _models_available() -> bool:
    return bool(model_status()["ok"])


requires_tts = pytest.mark.skipif(
    not _models_available(), reason="kokoro model missing - download from the Download tab"
)


@requires_tts
def test_synthesize_english():
    engine = KokoroEngine()
    path, sample_rate, duration_ms = engine.synthesize(
        "Hello. This is the local Kokoro voice.", lang="en", voice="af_heart"
    )
    assert Path(path).is_file()
    assert Path(path).stat().st_size > 1_000
    assert sample_rate == 24_000
    assert duration_ms > 500


def test_unsupported_language_raises():
    engine = KokoroEngine()
    with pytest.raises(TtsUnsupportedLanguageError):
        engine.synthesize("Halo dunia", lang="id")


def test_missing_model_raises(tmp_path: Path):
    engine = KokoroEngine(tmp_path)
    with pytest.raises(TtsModelMissingError):
        engine.synthesize("Hello", lang="en")
