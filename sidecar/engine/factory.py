"""Engine factory: turns the owner's Settings choice into a concrete engine instance.

`provider` is one of `local` (bundled faster-whisper + NLLB), `groq`, `openrouter`, `custom`
(any OpenAI-compatible server) or `ollama`; speech recognition additionally accepts
`deepgram`. The pipeline only depends on the Protocols below, so adding a provider never
touches `ws.py`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sidecar.engine.mt import get_engine as get_local_mt
from sidecar.engine.remote import (
    REMOTE_PROVIDERS,
    STT_PROVIDERS,
    TTS_PROVIDERS,
    DeepgramSttEngine,
    RemoteConfig,
    RemoteMtEngine,
    RemoteSttEngine,
    RemoteTtsEngine,
)
from sidecar.engine.stt import SttEngine

LOCAL = "local"


def provider_of(cfg: dict[str, Any] | None) -> str:
    """Translation provider (the value used by `build_mt` and the Settings switch)."""
    provider = str((cfg or {}).get("provider") or LOCAL).strip().lower()
    return provider if provider in REMOTE_PROVIDERS else LOCAL


def stt_provider_of(cfg: dict[str, Any] | None) -> str:
    """Speech-recognition provider; `deepgram` is valid here and nowhere else."""
    provider = str((cfg or {}).get("provider") or LOCAL).strip().lower()
    return provider if provider in STT_PROVIDERS else LOCAL


def describe(cfg: dict[str, Any] | None) -> str:
    provider = stt_provider_of(cfg)
    if provider in STT_PROVIDERS:
        return RemoteConfig.from_dict(cfg).describe()
    return "local"


def build_stt(
    cfg: dict[str, Any] | None,
    *,
    models_dir: Path | None = None,
    model_name: str = "small",
) -> Any:
    provider = stt_provider_of(cfg)
    if provider == "deepgram":
        remote = RemoteConfig.from_dict(cfg)
        if not (remote.base_url and remote.model and remote.api_key):
            raise ValueError("deepgram: base URL, model and API key are required")
        return DeepgramSttEngine(remote)
    if provider in REMOTE_PROVIDERS:
        remote = RemoteConfig.from_dict(cfg)
        if not remote.ready:
            raise ValueError(f"{provider}: base URL and model are required")
        return RemoteSttEngine(remote)
    return SttEngine(models_dir, model_name=model_name)


def build_mt(cfg: dict[str, Any] | None, *, models_dir: Path | None = None) -> Any:
    raw = str((cfg or {}).get("provider") or LOCAL).strip().lower()
    if raw == "deepgram":
        raise ValueError("deepgram is a speech-recognition provider only")
    provider = provider_of(cfg)
    if provider in REMOTE_PROVIDERS:
        remote = RemoteConfig.from_dict(cfg)
        if not remote.ready:
            raise ValueError(f"{provider}: base URL and model are required")
        return RemoteMtEngine(remote)
    # The local NLLB singleton keeps its models warm across engine switches.
    return get_local_mt("nllb", models_dir)


def tts_provider_of(cfg: dict[str, Any] | None) -> str:
    provider = str((cfg or {}).get("provider") or LOCAL).strip().lower()
    return provider if provider in TTS_PROVIDERS else LOCAL


def build_tts(
    cfg: dict[str, Any] | None,
    *,
    output_dir: Path | None = None,
    voice_sample: Path | None = None,
    voice_source: str = "preset",
) -> Any:
    """Remote speech output for the provider that owns Speak; local TTS is handled by ws.py."""
    provider = tts_provider_of(cfg)
    if provider == LOCAL:
        return None
    remote = RemoteConfig.from_dict(cfg)
    if not (remote.base_url and remote.model):
        raise ValueError(f"{provider}: base URL and model are required for speech")
    return RemoteTtsEngine(
        remote,
        output_dir=output_dir,
        voice_sample=voice_sample,
        voice_source=voice_source,
    )
