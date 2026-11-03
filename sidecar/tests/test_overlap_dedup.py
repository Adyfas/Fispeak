"""The 0.8 s VAD overlap must not repeat words in the subtitle (quality pass)."""

from __future__ import annotations

from sidecar.server.ws import _strip_overlap


def test_strips_the_repeated_tail_of_the_previous_window() -> None:
    previous = ("The transcript quality on English meetings looks noticeably better.", 10_000)
    # The next window starts 800 ms before the previous one ended.
    text = "noticeably better. One thing we still need to fix is language detection."
    assert _strip_overlap(text, previous, started_ms=9_200) == (
        "One thing we still need to fix is language detection."
    )


def test_keeps_a_fresh_sentence_untouched() -> None:
    previous = ("The release runs twenty percent faster.", 6_000)
    text = "I suggest we schedule a separate session next Tuesday."
    assert _strip_overlap(text, previous, started_ms=6_000) == text


def test_ignores_short_matches() -> None:
    previous = ("We should ship it.", 4_000)
    text = "It works on the laptop."
    assert _strip_overlap(text, previous, started_ms=3_500) == text


def test_returns_empty_when_the_whole_segment_is_an_echo() -> None:
    previous = ("The results look good on English meetings today.", 8_000)
    assert _strip_overlap("English meetings today.", previous, started_ms=7_400) == ""
