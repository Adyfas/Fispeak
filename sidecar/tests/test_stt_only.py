"""Prompt page (dictation) contract: transcribe only, never translate."""

from __future__ import annotations

from sidecar.engine.audio_router import AudioRouter, StreamConfig


def test_stt_only_never_requests_a_translation() -> None:
    router = AudioRouter(StreamConfig(my_lang="id", remote_lang="en", mode="stt_only"))
    assert router.target_language("you") is None
    assert router.target_language("remote") is None
    assert router.target_language_code("you") is None


def test_translate_on_keeps_the_direction() -> None:
    router = AudioRouter(StreamConfig(my_lang="id", remote_lang="en", mode="translate_on"))
    assert router.target_language_code("you") == "en"
    assert router.target_language_code("remote") == "id"


def test_config_accepts_the_stt_only_mode() -> None:
    config = StreamConfig(mode="translate_on")
    config.mode = "stt_only"
    assert AudioRouter(config).target_language("you") is None
