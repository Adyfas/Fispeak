"""NLLB-200 translation behind a swappable `TranslationEngine` interface (07-translation-engine).

CTranslate2 int8 runs on CPU, lazy-loads on the first request, caches repeated meeting phrases in
an LRU and reports `model_missing` instead of crashing when the files are absent.
NLLB is CC-BY-NC 4.0; `ArgosEngine` stays a stub so a commercial build can swap the engine
without touching the pipeline.
"""

from __future__ import annotations

import logging
import re
import threading
from collections import OrderedDict
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Protocol, runtime_checkable

from sidecar import config
from sidecar.engine import languages

log = logging.getLogger("mt")

MAX_TOKENS = 480
SENTENCE_SPLIT = re.compile(r"(?<=[.!?。！？])\s+")


class ModelMissingError(RuntimeError):
    """Raised when NLLB files are absent; the UI turns this into a download prompt."""


@runtime_checkable
class TranslationEngine(Protocol):
    def load(self, models_dir: Path) -> None: ...
    def translate(self, text: str, src: str, tgt: str) -> str: ...
    def translate_stream(self, text: str, src: str, tgt: str) -> AsyncIterator[str]: ...
    @property
    def supported_languages(self) -> list[str]: ...


def model_path(models_dir: Path | None = None) -> Path:
    return (models_dir or config.models_dir()) / config.MT_MODEL_DIR


def model_status(models_dir: Path | None = None) -> dict[str, object]:
    root = model_path(models_dir)
    missing = [name for name in config.MT_MODEL_FILES if not (root / name).exists()]
    return {"ok": not missing, "path": str(root), "missing": missing}


class _LRUCache:
    def __init__(self, size: int = 2000) -> None:
        self._size = size
        self._data: OrderedDict[tuple[str, str, str], str] = OrderedDict()
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: tuple[str, str, str]) -> str | None:
        with self._lock:
            value = self._data.get(key)
            if value is None:
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return value

    def put(self, key: tuple[str, str, str], value: str) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self._size:
                self._data.popitem(last=False)


class NLLBCT2Engine:
    """`CTranslate2` NLLB-200-distilled-600M int8. Thread-safe, lazy-loaded."""

    name = "nllb"

    def __init__(
        self,
        models_dir: Path | None = None,
        *,
        beam_size: int = 2,
        cache_size: int = 2000,
    ) -> None:
        self._models_dir = models_dir
        self._beam_size = beam_size
        self._cache = _LRUCache(cache_size)
        self._lock = threading.Lock()
        self._translator = None
        self._tokenizer = None

    # -- lifecycle -------------------------------------------------------------------------
    @property
    def status(self) -> dict[str, object]:
        return model_status(self._models_dir)

    @property
    def loaded(self) -> bool:
        return self._translator is not None and self._tokenizer is not None

    @property
    def supported_languages(self) -> list[str]:
        return [lang.flores for lang in languages.LANGUAGES]

    @property
    def beam_size(self) -> int:
        return self._beam_size

    @beam_size.setter
    def beam_size(self, value: int) -> None:
        self._beam_size = max(1, int(value))

    @property
    def cache_stats(self) -> dict[str, int]:
        return {"hits": self._cache.hits, "misses": self._cache.misses}

    def load(self, models_dir: Path | None = None) -> None:
        if self.loaded:
            return
        if models_dir is not None:
            self._models_dir = models_dir
        status = self.status
        if not status["ok"]:
            raise ModelMissingError(f"nllb model missing: {status['path']} ({', '.join(status['missing'])})")

        import ctranslate2
        from transformers import AutoTokenizer

        root = model_path(self._models_dir)
        log.info("loading nllb", extra={"fields": {"path": str(root), "beam": self._beam_size}})
        self._tokenizer = AutoTokenizer.from_pretrained(str(root), local_files_only=True)
        self._translator = ctranslate2.Translator(str(root), device="cpu", compute_type="int8", inter_threads=2)

    def unload(self) -> None:
        with self._lock:
            self._translator = None
            self._tokenizer = None

    # -- translation -----------------------------------------------------------------------
    def translate(self, text: str, src: str, tgt: str) -> str:
        translated, _quality = self.translate_with_meta(text, src, tgt)
        return translated

    def translate_with_meta(self, text: str, src: str, tgt: str) -> tuple[str, str]:
        source = text.strip()
        if not source:
            return "", "ok"

        src_flores = languages.to_flores(src)
        tgt_flores = languages.to_flores(tgt)
        if not src_flores:
            raise ValueError(f"unsupported source language: {src!r}")
        if not tgt_flores:
            raise ValueError(f"unsupported target language: {tgt!r}")
        if src_flores == tgt_flores:
            return source, "ok"

        key = (source, src_flores, tgt_flores)
        cached = self._cache.get(key)
        if cached is not None:
            return cached, "ok"

        self.load()
        result = self._translate_uncached(source, src_flores, tgt_flores)
        self._cache.put(key, result)
        quality = "warn" if _looks_untranslated(source, result) else "ok"
        return result, quality

    def translate_stream(self, text: str, src: str, tgt: str) -> AsyncIterator[str]:
        raise NotImplementedError("streaming MT is Phase 4; the WS pipeline emits one event per sentence")

    def _translate_uncached(self, text: str, src_flores: str, tgt_flores: str) -> str:
        assert self._tokenizer is not None and self._translator is not None
        with self._lock:
            self._tokenizer.src_lang = src_flores
            token_count = len(self._tokenizer.encode(text))
            if token_count <= MAX_TOKENS:
                return self._batch([text], tgt_flores)[0]
            sentences = [part for part in SENTENCE_SPLIT.split(text) if part.strip()]
            return " ".join(self._batch(sentences, tgt_flores)).strip()

    def _batch(self, texts: list[str], tgt_flores: str) -> list[str]:
        assert self._tokenizer is not None and self._translator is not None
        batch = [self._tokenizer.convert_ids_to_tokens(self._tokenizer.encode(text)) for text in texts]
        results = self._translator.translate_batch(
            batch,
            target_prefix=[[tgt_flores]] * len(batch),
            beam_size=self._beam_size,
            max_batch_size=1024,
            return_scores=False,
        )
        outputs: list[str] = []
        for result in results:
            tokens = [token for token in result.hypotheses[0] if token != tgt_flores]
            ids = self._tokenizer.convert_tokens_to_ids(tokens)
            outputs.append(self._tokenizer.decode(ids, skip_special_tokens=True).strip())
        return outputs


class ArgosEngine:
    """Placeholder for the Apache-2.0 fallback; only exists so the abstraction is real."""

    name = "argos"

    @property
    def supported_languages(self) -> list[str]:
        return []

    def load(self, models_dir: Path) -> None:
        raise NotImplementedError("Argos Translate is not part of the MVP (NLLB is CC-BY-NC)")

    def translate(self, text: str, src: str, tgt: str) -> str:
        raise NotImplementedError("Argos Translate is not part of the MVP (NLLB is CC-BY-NC)")

    def translate_stream(self, text: str, src: str, tgt: str) -> AsyncIterator[str]:
        raise NotImplementedError("Argos Translate is not part of the MVP (NLLB is CC-BY-NC)")


_engine: TranslationEngine | None = None
_engine_lock = threading.Lock()


def get_engine(kind: str = "nllb", models_dir: Path | None = None) -> TranslationEngine:
    """Factory used by every caller; never import NLLBCT2Engine directly in the pipeline."""
    global _engine
    with _engine_lock:
        if _engine is None:
            if kind == "argos":
                _engine = ArgosEngine()
            else:
                _engine = NLLBCT2Engine(models_dir)
        return _engine


def reset_engine() -> None:
    global _engine
    with _engine_lock:
        _engine = None


def _looks_untranslated(source: str, output: str) -> bool:
    """Guards against a misdetected source language (07-translation-engine §7)."""
    if not output:
        return True
    return re.sub(r"\s+", " ", source.strip().lower()) == re.sub(r"\s+", " ", output.strip().lower())
