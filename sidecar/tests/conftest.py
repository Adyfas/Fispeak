"""Shared pytest fixtures for the sidecar test suite."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sidecar import config  # noqa: E402
from sidecar.engine.mt import get_engine, model_status as mt_model_status  # noqa: E402
from sidecar.engine.stt import SttEngine, model_status as stt_model_status  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _models_available() -> bool:
    return bool(stt_model_status()["ok"]) and bool(mt_model_status()["ok"])


def stt_model_available() -> bool:
    return bool(stt_model_status()["ok"])


requires_stt = pytest.mark.skipif(
    not stt_model_available(), reason="whisper model missing - run scripts/fetch_dev_models.py"
)
requires_mt = pytest.mark.skipif(
    not mt_model_status()["ok"], reason="nllb model missing - run scripts/fetch_dev_models.py"
)


@pytest.fixture(scope="session")
def models_dir() -> Path:
    return config.models_dir()


@pytest.fixture(scope="session")
def stt_engine(models_dir: Path) -> SttEngine:
    engine = SttEngine(models_dir)
    engine.ensure_loaded()
    return engine


@pytest.fixture(scope="session")
def mt_engine(models_dir: Path):
    engine = get_engine("nllb", models_dir)
    engine.load(models_dir)
    return engine


@pytest.fixture(scope="session")
def en_meeting_wav() -> Path:
    return FIXTURES / "en_meeting_30s.wav"


@pytest.fixture(scope="session")
def id_meeting_wav() -> Path:
    return FIXTURES / "id_meeting_20s.wav"


@pytest.fixture(scope="session")
def silence_wav() -> Path:
    return FIXTURES / "silence_5s.wav"


@pytest.fixture(scope="session")
def wav_loader():
    """Return the `read_wav` helper so tests do not import from conftest directly."""
    return read_wav


def read_wav(path: Path) -> np.ndarray:
    import soundfile as sf

    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    assert sample_rate == config.SAMPLE_RATE, f"{path} must be {config.SAMPLE_RATE} Hz mono"
    return np.asarray(audio, dtype=np.float32)
