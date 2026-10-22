"""NLLB translation quality and latency (07-translation-engine §9, 11-roadmap acceptance)."""

from __future__ import annotations

import time

import pytest

from conftest import requires_mt

ID_SENTENCE = "Mari kita jadwalkan rapat besok pagi di kantor."
EN_SENTENCE = "Let us schedule the meeting for tomorrow morning."


@requires_mt
def test_indonesian_to_english_mentions_the_meeting(mt_engine) -> None:
    translated, quality = mt_engine.translate_with_meta(ID_SENTENCE, "ind_Latn", "eng_Latn")
    assert "meeting" in translated.lower(), translated
    assert quality == "ok"


@requires_mt
def test_english_to_indonesian_mentions_the_meeting(mt_engine) -> None:
    translated, quality = mt_engine.translate_with_meta(EN_SENTENCE, "eng_Latn", "ind_Latn")
    lowered = translated.lower()
    assert "rapat" in lowered or "pertemuan" in lowered, translated
    assert quality == "ok"


@requires_mt
def test_language_codes_are_interchangeable(mt_engine) -> None:
    by_flores, _ = mt_engine.translate_with_meta(ID_SENTENCE, "ind_Latn", "eng_Latn")
    by_iso, _ = mt_engine.translate_with_meta(ID_SENTENCE, "id", "en")
    assert by_flores == by_iso


@requires_mt
def test_translation_latency_is_under_two_and_a_half_seconds(mt_engine) -> None:
    # warm the cache/model first, then measure a fresh 20 word sentence
    mt_engine.translate_with_meta("Warm up the translation engine.", "eng_Latn", "ind_Latn")
    started = time.monotonic()
    translated, _quality = mt_engine.translate_with_meta(
        "We need to schedule a meeting with the whole team next week to review the new release.",
        "eng_Latn",
        "ind_Latn",
    )
    elapsed = time.monotonic() - started
    assert translated
    assert elapsed < 2.5, f"translation took {elapsed:.2f}s"


@requires_mt
def test_cache_returns_the_same_translation(mt_engine) -> None:
    sentence = "The transcript is cached between meetings."
    first, _ = mt_engine.translate_with_meta(sentence, "eng_Latn", "ind_Latn")
    hits_before = mt_engine.cache_stats["hits"]
    second, _ = mt_engine.translate_with_meta(sentence, "eng_Latn", "ind_Latn")
    assert first == second
    assert mt_engine.cache_stats["hits"] == hits_before + 1


@requires_mt
def test_same_language_is_a_no_op(mt_engine) -> None:
    translated, quality = mt_engine.translate_with_meta(EN_SENTENCE, "eng_Latn", "eng_Latn")
    assert translated == EN_SENTENCE
    assert quality == "ok"


def test_unsupported_language_is_rejected(mt_engine) -> None:
    with pytest.raises(ValueError):
        mt_engine.translate_with_meta("hello", "xx", "en")
