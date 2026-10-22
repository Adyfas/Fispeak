"""English transcription of the meeting fixture (06-stt-engine §8, 11-roadmap acceptance)."""

from __future__ import annotations

import pytest

from conftest import requires_stt


@requires_stt
def test_fixture_transcript_mentions_the_meeting(stt_engine, en_meeting_wav, wav_loader) -> None:
    audio = wav_loader(en_meeting_wav)
    result = stt_engine.transcribe(audio)

    assert result.language == "en"
    text = result.text.lower()
    assert "meeting" in text or "schedule" in text, text
    assert result.segments, "the fixture must produce at least one segment"


@requires_stt
def test_transcription_is_stable_across_runs(stt_engine, en_meeting_wav, wav_loader) -> None:
    """The VAD/whisper pipeline must be deterministic enough for repeated runs."""
    audio = wav_loader(en_meeting_wav)
    first = stt_engine.transcribe(audio).text.lower()
    second = stt_engine.transcribe(audio).text.lower()
    assert first == second


@requires_stt
def test_indonesian_fixture_is_detected_as_indonesian(stt_engine, id_meeting_wav, wav_loader) -> None:
    audio = wav_loader(id_meeting_wav)
    result = stt_engine.transcribe(audio)
    assert result.language == "id"
    assert result.segments


@requires_stt
def test_explicit_language_overrides_detection(stt_engine, en_meeting_wav, wav_loader) -> None:
    audio = wav_loader(en_meeting_wav)
    result = stt_engine.transcribe(audio, language="en")
    assert result.language == "en"
