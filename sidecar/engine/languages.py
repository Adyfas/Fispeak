"""Single source of truth for Whisper (ISO-639-1) <-> NLLB (FLORES-200) language codes.

Served over `GET /languages`; the renderer must never keep a second copy of this mapping
(09-sidecar-spec §2, 07-translation-engine §4).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    code: str  # UI key and Whisper code ("en", "id", ...)
    label: str  # English label shown in pickers
    whisper: str  # what faster-whisper expects
    flores: str  # what NLLB / CTranslate2 expects


LANGUAGES: tuple[Language, ...] = (
    Language("en", "English", "en", "eng_Latn"),
    Language("id", "Indonesian", "id", "ind_Latn"),
    Language("ms", "Malay", "ms", "zsm_Latn"),
    Language("de", "German", "de", "deu_Latn"),
    Language("ja", "Japanese", "ja", "jpn_Jpan"),
    Language("fr", "French", "fr", "fra_Latn"),
    Language("es", "Spanish", "es", "spa_Latn"),
    Language("zh", "Chinese (Simplified)", "zh", "zho_Hans"),
    Language("ko", "Korean", "ko", "kor_Hang"),
    Language("pt", "Portuguese", "pt", "por_Latn"),
    Language("ar", "Arabic", "ar", "arb_Arab"),
    Language("hi", "Hindi", "hi", "hin_Deva"),
    Language("ru", "Russian", "ru", "rus_Cyrl"),
    Language("nl", "Dutch", "nl", "nld_Latn"),
    Language("vi", "Vietnamese", "vi", "vie_Latn"),
    Language("th", "Thai", "th", "tha_Thai"),
    Language("tr", "Turkish", "tr", "tur_Latn"),
)

_BY_WHISPER: dict[str, Language] = {lang.whisper: lang for lang in LANGUAGES}
_BY_FLORES: dict[str, Language] = {lang.flores.lower(): lang for lang in LANGUAGES}

AUTO = "auto"


def _clean(code: str | None) -> str:
    return (code or "").strip()


def by_whisper(code: str | None) -> Language | None:
    return _BY_WHISPER.get(_clean(code).lower())


def by_flores(code: str | None) -> Language | None:
    return _BY_FLORES.get(_clean(code).lower())


def to_flores(code: str | None) -> str | None:
    """Accept a UI/Whisper code ("id"), a FLORES code ("ind_Latn") or "auto" (-> None)."""
    cleaned = _clean(code)
    if not cleaned or cleaned.lower() == AUTO:
        return None
    lang = by_flores(cleaned) or by_whisper(cleaned)
    return lang.flores if lang else None


def to_whisper(code: str | None) -> str | None:
    """Inverse of `to_flores`; unknown/auto codes become None (Whisper detects on its own)."""
    cleaned = _clean(code)
    if not cleaned or cleaned.lower() == AUTO:
        return None
    lang = by_whisper(cleaned) or by_flores(cleaned)
    return lang.whisper if lang else None


def whisper_codes() -> list[str]:
    return [lang.whisper for lang in LANGUAGES]


def as_dict() -> dict[str, object]:
    """Payload for `GET /languages` (shape fixed by 09-sidecar-spec §2)."""
    return {
        "stt": whisper_codes(),
        "nllb": [
            {"ui": lang.code, "whisper": lang.whisper, "flores": lang.flores, "label": lang.label}
            for lang in LANGUAGES
        ],
    }
