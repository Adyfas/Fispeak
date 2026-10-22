"""Whisper must stay silent on silence (06-stt-engine §4.3, 11-roadmap acceptance)."""

from __future__ import annotations

import numpy as np

from conftest import requires_stt
from sidecar.engine.stt import is_hallucination


@requires_stt
def test_five_seconds_of_silence_produce_no_segments(stt_engine, silence_wav, wav_loader) -> None:
    audio = wav_loader(silence_wav)
    result = stt_engine.transcribe(audio)
    assert result.segments == ()
    assert result.text == ""


@requires_stt
def test_silence_pushed_through_the_vad_produces_no_transcript(stt_engine, silence_wav, wav_loader) -> None:
    from sidecar.engine.vad import RollingVadBuffer

    audio = wav_loader(silence_wav)
    buffer = RollingVadBuffer("remote")
    windows = []
    for start in range(0, audio.size, 3200):
        windows.extend(buffer.push(audio[start : start + 3200]))
    windows.extend(buffer.flush())

    assert windows == [], "pure silence must not even open a VAD window"


def test_blacklist_rejects_the_classic_hallucinations() -> None:
    for phrase in (
        "Thank you for watching.",
        "Please subscribe",
        "I'm sorry, but I cannot fulfill that request.",
        "Subtitles by the Amara.org community",
        "Thanks for watching!",
    ):
        assert is_hallucination(phrase, lang="en"), phrase


def test_blacklist_keeps_real_sentences() -> None:
    for phrase in (
        "Let us schedule the meeting for tomorrow.",
        "The next release is about twenty percent faster.",
        "Okay, we can talk about the budget later.",
    ):
        assert not is_hallucination(phrase, lang="en"), phrase


def test_low_quality_segments_are_dropped() -> None:
    assert is_hallucination("a longer sentence here", no_speech_prob=0.75)
    assert is_hallucination("a longer sentence here", avg_logprob=-1.4)
    assert not is_hallucination("a longer sentence here", no_speech_prob=0.1, avg_logprob=-0.4)


def test_short_segments_are_dropped() -> None:
    assert is_hallucination("ok")
    assert is_hallucination("  ")


def test_arabic_script_words_are_not_blacklisted() -> None:
    assert not is_hallucination("الله", lang="ar")
    assert is_hallucination("الله", lang="en")


def test_zeros_do_not_open_a_window() -> None:
    from sidecar.engine.vad import RollingVadBuffer

    buffer = RollingVadBuffer("you")
    for _ in range(30):
        assert buffer.push(np.zeros(3200, dtype=np.float32)) == []
    assert not buffer.active
