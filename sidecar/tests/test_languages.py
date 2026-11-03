"""Language mapping is the single source of truth (07-translation-engine §4)."""

from __future__ import annotations

from sidecar.engine import languages


def test_mapping_covers_the_documented_languages() -> None:
    assert "en" in languages.whisper_codes()
    assert "id" in languages.whisper_codes()
    assert languages.to_flores("en") == "eng_Latn"
    assert languages.to_flores("id") == "ind_Latn"
    assert languages.to_flores("ja") == "jpn_Jpan"
    assert languages.to_flores("zh") == "zho_Hans"
    assert languages.to_flores("ms") == "zsm_Latn"


def test_round_trip_whisper_and_flores() -> None:
    for language in languages.LANGUAGES:
        assert languages.to_flores(language.whisper) == language.flores
        assert languages.to_flores(language.flores) == language.flores
        assert languages.to_whisper(language.flores) == language.whisper
        assert languages.to_whisper(language.whisper) == language.whisper


def test_auto_and_unknown_codes() -> None:
    assert languages.to_flores("auto") is None
    assert languages.to_flores("") is None
    assert languages.to_flores(None) is None
    assert languages.to_whisper("auto") is None
    assert languages.to_flores("xx") is None
    assert languages.to_whisper("xx") is None


def test_provider_language_names_and_tags_are_normalised() -> None:
    """Cloud providers answer with BCP-47, FLORES or plain English names, not Whisper codes."""
    assert languages.normalize("id") == "id"
    assert languages.normalize("id-ID") == "id"
    assert languages.normalize("ID_id") == "id"
    assert languages.normalize("Indonesian") == "id"
    assert languages.normalize("Bahasa Indonesia") == "id"
    assert languages.normalize("eng_Latn") == "en"
    assert languages.normalize("en-US") == "en"
    assert languages.normalize("Mandarin") == "zh"
    assert languages.normalize("auto") is None
    assert languages.normalize("unknown") is None
    assert languages.normalize("") is None
    assert languages.normalize(None) is None
    assert languages.normalize("tlh") is None


def test_payload_shape_for_the_rest_endpoint() -> None:
    payload = languages.as_dict()
    assert payload["stt"] == languages.whisper_codes()
    assert len(payload["nllb"]) == len(languages.LANGUAGES)
    first = payload["nllb"][0]
    assert first["ui"] == "en"
    assert first["flores"] == "eng_Latn"
    assert first["whisper"] == "en"
