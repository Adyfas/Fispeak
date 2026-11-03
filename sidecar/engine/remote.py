"""Remote STT/MT engines speaking the OpenAI-compatible HTTP API.

One implementation covers every provider the owner can pick in Settings:

| provider     | base URL example                      | notes                                  |
|--------------|---------------------------------------|----------------------------------------|
| `openrouter` | `https://openrouter.ai/api/v1`        | `whisper-1`, `gpt-4o-mini`, `gemini-*` |
| `groq`       | `https://api.groq.com/openai/v1`      | free tier; `whisper-large-v3-turbo`    |
| `deepgram`   | `https://api.deepgram.com`            | native listen API; language detection  |
| `custom`     | any OpenAI-compatible server          | vLLM, TGI, LiteLLM, LM Studio, ...     |
| `ollama`     | `http://localhost:11434`              | `/v1/chat/completions`, `/api/chat` fallback |

The sidecar still owns the VAD window and the pipeline; these engines only replace the model
call, so the WS event contract (`transcript`, `translation`, `notice`) does not change.
Audio never leaves the machine unless the owner explicitly picks a cloud provider.
"""

from __future__ import annotations

import base64
import io
import logging
import re
import threading
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import numpy as np

from sidecar import config
from sidecar.engine import languages
from sidecar.engine.stt import Segment, TranscriptResult

log = logging.getLogger("remote")

REMOTE_PROVIDERS = frozenset(
    {
        "openrouter",
        "groq",
        "mistral",
        "openai",
        "together",
        "huggingface",
        "cloudflare",
        "custom",
        "ollama",
    }
)
STT_PROVIDERS = REMOTE_PROVIDERS | {"deepgram"}
TTS_PROVIDERS = frozenset({"mistral", "openai", "together", "custom"})
DEFAULT_TIMEOUT = 30.0
CACHE_SIZE = 512
# Free tiers are strict about request rate. Mistral free mode returns 429 (code 1300) as soon as
# two calls overlap, so speech recognition and translation share one gate: one request at a time,
# at least 1.1 s apart. The gate is per provider+host, not per engine instance.
RATE_INTERVALS = {"mistral": 1.1}
MAX_ATTEMPTS = 3

# The model answers with numbered lines; parse them back into one translation per sentence.
NUMBERED_LINE = re.compile(r"^\s*(\d+)\s*[.)]\s*(.*)$")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?。！？])\s+")

MT_SYSTEM = (
    "You are a professional interpreter for live meetings. "
    "Translate every numbered line from {src} into {tgt}. "
    "Keep exactly the same numbering and the same number of lines. "
    "Keep names, numbers, product names and technical terms unchanged. "
    "Output only the translated lines - no notes, no explanations, no quotes."
)


class RemoteError(RuntimeError):
    """Any failure the UI should surface as a friendly notice."""


class RemoteAuthError(RemoteError):
    pass


class RemoteRateLimitError(RemoteError):
    pass


@dataclass
class RemoteConfig:
    provider: str = "openrouter"
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    timeout: float = DEFAULT_TIMEOUT
    headers: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: dict | None) -> "RemoteConfig":
        raw = raw or {}
        return cls(
            provider=str(raw.get("provider") or "custom"),
            base_url=str(raw.get("baseUrl") or raw.get("base_url") or "").strip().rstrip("/"),
            model=str(raw.get("model") or "").strip(),
            api_key=str(raw.get("apiKey") or raw.get("api_key") or "").strip(),
            timeout=float(raw.get("timeout") or DEFAULT_TIMEOUT),
        )

    @property
    def ready(self) -> bool:
        return bool(self.base_url and self.model)

    @property
    def missing(self) -> list[str]:
        missing: list[str] = []
        if not self.base_url:
            missing.append("baseUrl")
        if not self.model:
            missing.append("model")
        return missing

    def endpoint(self, path: str) -> str:
        """`/chat/completions` -> `https://host/v1/chat/completions` (or `/api/v1/...`)."""
        base = self.base_url
        if base.endswith("/v1") or re.search(r"/v\d+(?:beta)?(?:/openai)?$", base):
            return f"{base}{path}"
        return f"{base}/v1{path}"

    def describe(self) -> str:
        return f"{self.provider}:{self.model}" if self.model else self.provider


def _language_label(flores_or_code: str | None) -> str:
    """FLORES ("ind_Latn") or UI code ("id") -> English label ("Indonesian")."""
    if (flores_or_code or "").strip().lower() in ("", languages.AUTO):
        return "the source language (detect it automatically)"
    language = languages.by_flores(flores_or_code) or languages.by_whisper(flores_or_code)
    return language.label if language else (flores_or_code or "the source language")


def _whisper_code(flores_or_code: str | None) -> str | None:
    return languages.normalize(flores_or_code)


def _wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    """16-bit PCM WAV, what every transcription endpoint expects."""
    pcm = np.clip(np.asarray(samples, dtype=np.float32).reshape(-1), -1.0, 1.0)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes((pcm * 32767.0).astype("<i2").tobytes())
    return buffer.getvalue()


class _ProviderGate:
    """Serialise requests to one provider and enforce a minimum spacing between starts.

    Free modes (Mistral in particular) count concurrent calls against a tiny RPS budget.
    Without a gate, LISTEN's STT call and the previous window's MT call overlap and one of them
    is answered with 429. With the gate both still run, just one after the other.
    """

    def __init__(self, min_interval: float) -> None:
        self._semaphore = threading.Semaphore(1)
        self._lock = threading.Lock()
        self._next_at = 0.0
        self._min_interval = max(0.0, min_interval)

    def __enter__(self) -> "_ProviderGate":
        self._semaphore.acquire()
        with self._lock:
            now = time.monotonic()
            wait = self._next_at - now
            self._next_at = max(now, self._next_at) + self._min_interval
        if wait > 0:
            time.sleep(wait)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self._semaphore.release()


_GATES: dict[tuple[str, str], _ProviderGate] = {}
_GATES_LOCK = threading.Lock()


def provider_gate(provider: str, base_url: str) -> _ProviderGate:
    key = (provider, base_url)
    with _GATES_LOCK:
        gate = _GATES.get(key)
        if gate is None:
            gate = _ProviderGate(RATE_INTERVALS.get(provider, 0.0))
            _GATES[key] = gate
        return gate


class _RemoteBase:
    def __init__(self, cfg: RemoteConfig) -> None:
        self.cfg = cfg
        self._client = httpx.Client(
            timeout=httpx.Timeout(cfg.timeout, connect=min(8.0, cfg.timeout)),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
        )
        self._gate = provider_gate(cfg.provider, cfg.base_url)

    @property
    def status(self) -> dict[str, object]:
        return {"ok": self.cfg.ready, "path": self.cfg.base_url, "missing": self.cfg.missing}

    def unload(self) -> None:
        """Remote engines keep no model in memory; closing the pool is enough."""
        try:
            self._client.close()
        except Exception:
            pass

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.cfg.api_key:
            headers["Authorization"] = f"Bearer {self.cfg.api_key}"
        if self.cfg.provider == "openrouter":
            headers.setdefault("HTTP-Referer", "https://fispeak.app")
            headers.setdefault("X-Title", "fispeak")
        headers.update(self.cfg.headers)
        return headers

    def _fail(self, response: httpx.Response) -> None:
        detail = ""
        try:
            detail = response.text[:240].replace("\n", " ")
        except Exception:
            detail = ""
        if response.status_code in (401, 403):
            raise RemoteAuthError(f"{self.cfg.provider}: API key rejected ({response.status_code}) {detail}".strip())
        if response.status_code == 429:
            raise RemoteRateLimitError(f"{self.cfg.provider}: rate limited (429) {detail}".strip())
        raise RemoteError(f"{self.cfg.provider}: HTTP {response.status_code} {detail}".strip())

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        url = self.cfg.endpoint(path)
        response: httpx.Response | None = None
        for attempt in range(MAX_ATTEMPTS):
            try:
                with self._gate:
                    response = self._client.request(method, url, headers=self._headers(), **kwargs)
            except httpx.HTTPError as exc:
                raise RemoteError(
                    f"{self.cfg.provider}: cannot reach {self.cfg.base_url} ({exc})"
                ) from exc
            if response.status_code != 429 or attempt == MAX_ATTEMPTS - 1:
                break
            # Free tiers answer 429 for overlapping calls. Wait for the server's hint, otherwise
            # back off 1.5 s / 3 s. The request is retried so the subtitle is delayed, not lost.
            retry_after = response.headers.get("retry-after")
            try:
                delay = float(retry_after) if retry_after else 1.5 * (attempt + 1)
            except ValueError:
                delay = 1.5 * (attempt + 1)
            delay = min(max(delay, 1.0), 10.0)
            log.warning(
                "rate limited, retrying",
                extra={
                    "fields": {
                        "provider": self.cfg.provider,
                        "attempt": attempt + 1,
                        "delay_s": delay,
                    }
                },
            )
            time.sleep(delay)
        assert response is not None
        if response.status_code >= 400:
            self._fail(response)
        return response


class RemoteMtEngine(_RemoteBase):
    """Chat-completion translator. One request per VAD window, numbered lines in/out."""

    name = "remote"

    def __init__(self, cfg: RemoteConfig) -> None:
        super().__init__(cfg)
        self._lock = threading.Lock()
        self._cache: dict[tuple[str, str, str], str] = {}

    # -- lifecycle -------------------------------------------------------------------------
    @property
    def supported_languages(self) -> list[str]:
        return [language.flores for language in languages.LANGUAGES]

    @property
    def loaded(self) -> bool:
        return self.cfg.ready

    def load(self, models_dir=None) -> None:
        if not self.cfg.ready:
            raise RemoteError(f"{self.cfg.provider}: base URL and model are required")
        # Ollama loads the model on the first request (~7 s for llama3.1:8b). Do it during the
        # explicit warmup so the first real subtitle is not delayed by the cold start.
        if self.cfg.provider == "ollama":
            try:
                self.translate("Hello", "eng_Latn", "ind_Latn")
            except Exception:
                pass

    @property
    def beam_size(self) -> int:
        return 1

    @beam_size.setter
    def beam_size(self, value: int) -> None:
        pass

    # -- translation -----------------------------------------------------------------------
    def translate(self, text: str, src: str, tgt: str) -> str:
        return self.translate_with_meta(text, src, tgt)[0]

    def translate_with_meta(self, text: str, src: str, tgt: str) -> tuple[str, str]:
        results = self.translate_many([text], src, tgt)
        return results[0] if results else ("", "ok")

    def translate_many(self, texts: list[str], src: str, tgt: str) -> list[tuple[str, str]]:
        if not texts:
            return []

        pending: list[tuple[int, str]] = []
        results: list[tuple[str, str] | None] = [None] * len(texts)
        for index, text in enumerate(texts):
            source = text.strip()
            if not source:
                results[index] = ("", "ok")
                continue
            cached = self._cache_get(source, src, tgt)
            if cached is not None:
                results[index] = (cached, "ok")
                continue
            pending.append((index, source))

        if pending:
            translated = self._translate_batch([text for _, text in pending], src, tgt)
            for (index, source), output in zip(pending, translated, strict=True):
                self._cache_put(source, src, tgt, output)
                results[index] = (output, "warn" if _looks_untranslated(source, output) else "ok")

        return [item if item is not None else ("", "ok") for item in results]

    # -- helpers ---------------------------------------------------------------------------
    def _translate_batch(self, texts: list[str], src: str, tgt: str) -> list[str]:
        if len(texts) == 1:
            return [self._translate_one(texts[0], src, tgt)]

        system = MT_SYSTEM.format(src=_language_label(src), tgt=_language_label(tgt))
        user = "\n".join(f"{index + 1}. {text}" for index, text in enumerate(texts))
        started = time.monotonic()
        content = self._chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}]
        )
        parsed = _parse_numbered(content, len(texts))
        if parsed is not None:
            log.info(
                "translated batch",
                extra={
                    "fields": {
                        "engine": self.cfg.describe(),
                        "lines": len(texts),
                        "ms": int((time.monotonic() - started) * 1000),
                    }
                },
            )
            return parsed

        # Some models refuse to number the lines; fall back to one request per sentence.
        log.warning(
            "batch reply was not numbered, retrying sentence by sentence",
            extra={"fields": {"engine": self.cfg.describe(), "reply": content[:80]}},
        )
        return [self._translate_one(text, src, tgt) for text in texts]

    def _translate_one(self, text: str, src: str, tgt: str) -> str:
        system = MT_SYSTEM.format(src=_language_label(src), tgt=_language_label(tgt))
        started = time.monotonic()
        content = self._chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": f"1. {text}"},
            ]
        )
        parsed = _parse_numbered(content, 1)
        output = (parsed[0] if parsed else content).strip().strip('"').strip()
        log.info(
            "translated",
            extra={
                "fields": {
                    "engine": self.cfg.describe(),
                    "ms": int((time.monotonic() - started) * 1000),
                    "chars": len(text),
                }
            },
        )
        return output

    def _chat(self, messages: list[dict[str, str]]) -> str:
        payload = {
            "model": self.cfg.model,
            "messages": messages,
            "temperature": 0,
            "stream": False,
        }
        response = self._request("POST", "/chat/completions", json=payload)
        if response.status_code == 404 and self.cfg.provider == "ollama":
            return self._chat_ollama_native(messages)

        try:
            data = response.json()
            return str(data["choices"][0]["message"]["content"] or "")
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise RemoteError(f"{self.cfg.provider}: unexpected reply {response.text[:200]}") from exc

    def _chat_ollama_native(self, messages: list[dict[str, str]]) -> str:
        """Ollama before 0.1.24 has no `/v1`; its native endpoint returns `message.content`."""
        url = f"{self.cfg.base_url}/api/chat"
        payload = {"model": self.cfg.model, "messages": messages, "stream": False}
        try:
            with self._gate:
                response = self._client.post(url, json=payload, headers=self._headers())
        except httpx.HTTPError as exc:
            raise RemoteError(f"ollama: cannot reach {self.cfg.base_url} ({exc})") from exc
        if response.status_code >= 400:
            self._fail(response)
        try:
            return str(response.json()["message"]["content"] or "")
        except (KeyError, TypeError, ValueError) as exc:
            raise RemoteError(f"ollama: unexpected reply {response.text[:200]}") from exc

    def _cache_get(self, text: str, src: str, tgt: str) -> str | None:
        with self._lock:
            return self._cache.get((text, src, tgt))

    def _cache_put(self, text: str, src: str, tgt: str, value: str) -> None:
        with self._lock:
            if len(self._cache) >= CACHE_SIZE:
                self._cache.clear()
            self._cache[(text, src, tgt)] = value


class RemoteSttEngine(_RemoteBase):
    """OpenAI-compatible `/audio/transcriptions` (OpenRouter, OpenAI, Groq, whisper.cpp server)."""

    name = "remote"

    def ensure_loaded(self) -> None:
        if not self.cfg.ready:
            raise RemoteError(f"{self.cfg.provider}: base URL and model are required")

    @property
    def loaded(self) -> bool:
        return self.cfg.ready

    def reset_language(self) -> None:
        """Remote providers keep no sticky state; the pipeline still calls this on restart."""

    def transcribe(
        self,
        samples: np.ndarray,
        *,
        language: str | None = None,
        beam_size: int = 2,
        offset_ms: int = 0,
    ) -> TranscriptResult:
        audio = np.asarray(samples, dtype=np.float32).reshape(-1)
        if audio.size == 0:
            return TranscriptResult(
                segments=(), language=_whisper_code(language), language_probability=0.0
            )

        # Without a hint, ask the provider to report the language it detected: that is what
        # lets LISTEN follow the meeting's language without preselection. OpenAI-compatible
        # Whisper servers use `verbose_json`; Mistral rejects that field and exposes the
        # detection through `return_language=true` instead.
        whisper_code = _whisper_code(language)
        data: dict[str, str] = {
            "model": self.cfg.model,
        }
        if self.cfg.provider == "mistral":
            if whisper_code:
                data["language"] = whisper_code
            else:
                data["return_language"] = "true"
        else:
            data["response_format"] = "json" if whisper_code else "verbose_json"
            if whisper_code:
                data["language"] = whisper_code

        started = time.monotonic()
        response = self._request(
            "POST",
            "/audio/transcriptions",
            data=data,
            files={"file": ("window.wav", _wav_bytes(audio, config.SAMPLE_RATE), "audio/wav")},
        )
        try:
            body = response.json()
        except ValueError as exc:
            raise RemoteError(f"{self.cfg.provider}: unexpected reply {response.text[:200]}") from exc

        text = str(body.get("text") or "").strip()
        detected = (
            languages.normalize(
                str(body.get("language") or body.get("detected_language") or "")
            )
            or whisper_code
            or None
        )
        duration_ms = int(round(audio.size / config.SAMPLE_RATE * 1000))
        segments = _split_segments(text, offset_ms, duration_ms, detected or None)

        log.info(
            "transcribed",
            extra={
                "fields": {
                    "engine": self.cfg.describe(),
                    "ms": int((time.monotonic() - started) * 1000),
                    "segments": len(segments),
                    "chars": len(text),
                }
            },
        )
        return TranscriptResult(
            segments=tuple(segments),
            language=detected or None,
            language_probability=0.95 if text else 0.0,
        )


class DeepgramSttEngine(_RemoteBase):
    """Deepgram `/v1/listen` with `detect_language`.

    Deepgram's native API is not OpenAI-compatible, but it is the one that returns an explicit
    `detected_language` plus `language_confidence` for pre-recorded windows. That makes it the
    best fit when the meeting language is unknown and the owner does not want to preselect it.
    """

    name = "deepgram"

    def __init__(self, cfg: RemoteConfig) -> None:
        super().__init__(cfg)

    @property
    def ready(self) -> bool:
        return bool(self.cfg.base_url and self.cfg.model and self.cfg.api_key)

    @property
    def loaded(self) -> bool:
        return self.ready

    def ensure_loaded(self) -> None:
        if not self.ready:
            raise RemoteError("deepgram: base URL, model and API key are required")

    def reset_language(self) -> None:
        """No sticky state: every window carries its own detection."""

    def transcribe(
        self,
        samples: np.ndarray,
        *,
        language: str | None = None,
        beam_size: int = 2,
        offset_ms: int = 0,
    ) -> TranscriptResult:
        audio = np.asarray(samples, dtype=np.float32).reshape(-1)
        if audio.size == 0:
            return TranscriptResult(segments=(), language=_whisper_code(language), language_probability=0.0)

        hint = _whisper_code(language)
        params: dict[str, str] = {
            "model": self.cfg.model,
            "smart_format": "true",
            "punctuate": "true",
        }
        if hint:
            params["language"] = hint
        else:
            params["detect_language"] = "true"

        started = time.monotonic()
        try:
            with self._gate:
                response = self._client.post(
                    self.cfg.endpoint("/listen"),
                    params=params,
                    content=_wav_bytes(audio, config.SAMPLE_RATE),
                    headers={
                        "Authorization": f"Token {self.cfg.api_key}",
                        "Content-Type": "audio/wav",
                        "Accept": "application/json",
                    },
                )
        except httpx.HTTPError as exc:
            raise RemoteError(f"deepgram: cannot reach {self.cfg.base_url} ({exc})") from exc

        if response.status_code >= 400:
            self._fail(response)

        try:
            body = response.json()
            channel = body["results"]["channels"][0]
            alternative = channel["alternatives"][0]
            text = str(alternative.get("transcript") or "").strip()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise RemoteError(f"deepgram: unexpected reply {response.text[:200]}") from exc

        detected = languages.normalize(str(channel.get("detected_language") or "")) or hint
        try:
            confidence = float(
                channel.get("language_confidence") or alternative.get("confidence") or 0.0
            )
        except (TypeError, ValueError):
            confidence = 0.0

        duration_ms = int(round(audio.size / config.SAMPLE_RATE * 1000))
        segments = _split_segments(text, offset_ms, duration_ms, detected)

        log.info(
            "transcribed",
            extra={
                "fields": {
                    "engine": self.cfg.describe(),
                    "ms": int((time.monotonic() - started) * 1000),
                    "segments": len(segments),
                    "lang": detected or "unknown",
                    "confidence": round(confidence, 3),
                }
            },
        )
        return TranscriptResult(
            segments=tuple(segments),
            language=detected,
            language_probability=confidence if text else 0.0,
        )


class RemoteTtsEngine(_RemoteBase):
    """Speech output through the selected provider.

    Mistral returns base64 inside `audio_data`, OpenAI/Together return raw audio bytes. Both are
    normalised to a WAV file on disk, so the Electron player does not care which provider spoke.
    A cloned voice is sent as `ref_audio` (Mistral) or as the provider's voice id.
    """

    name = "remote-tts"

    def __init__(
        self,
        cfg: RemoteConfig,
        *,
        output_dir: Path | None = None,
        voice_sample: Path | None = None,
        voice_source: str = "preset",
    ) -> None:
        super().__init__(cfg)
        self._output_dir = Path(output_dir) if output_dir else config.data_dir() / "tts"
        self._voice_sample = Path(voice_sample) if voice_sample else None
        self._voice_source = voice_source

    def synthesize(
        self,
        text: str,
        *,
        lang: str | None = None,
        voice: str | None = None,
        speed: float = 1.0,
    ) -> tuple[Path, int, int]:
        if not self.cfg.ready:
            raise RemoteError(f"{self.cfg.provider}: base URL and model are required")

        started = time.monotonic()
        payload: dict[str, object] = {
            "model": self.cfg.model,
            "input": text,
            "response_format": "wav",
        }
        if self.cfg.provider == "mistral":
            clone = (
                self._voice_source == "clone"
                and self._voice_sample is not None
                and self._voice_sample.is_file()
            )
            if clone:
                # `ref_audio` replaces `voice_id` for a one-off cloned voice.
                payload["ref_audio"] = base64.b64encode(self._voice_sample.read_bytes()).decode(
                    "ascii"
                )
            else:
                payload["voice_id"] = voice if voice and voice != "voice" else "voice_478"
            response = self._request("POST", "/audio/speech", json=payload)
            try:
                audio = base64.b64decode(str(response.json()["audio_data"]))
            except (KeyError, TypeError, ValueError) as exc:
                raise RemoteError(
                    f"mistral: unexpected speech reply {response.text[:200]}"
                ) from exc
        else:
            payload["voice"] = voice if voice and voice != "voice" else "alloy"
            payload["speed"] = speed
            response = self._request("POST", "/audio/speech", json=payload)
            audio = response.content

        if not audio:
            raise RemoteError(f"{self.cfg.provider}: empty speech reply")

        self._output_dir.mkdir(parents=True, exist_ok=True)
        path = self._output_dir / f"remote-{int(time.time() * 1000)}.wav"
        path.write_bytes(audio)
        sample_rate, duration_ms = _wav_info(path)
        log.info(
            "synthesized",
            extra={
                "fields": {
                    "engine": self.cfg.describe(),
                    "ms": int((time.monotonic() - started) * 1000),
                    "duration_ms": duration_ms,
                    "chars": len(text),
                }
            },
        )
        return path, sample_rate, duration_ms


def _wav_info(path: Path) -> tuple[int, int]:
    """Read a WAV header; providers that ignore `response_format` still usually send WAV."""
    try:
        with wave.open(str(path), "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate() or 24000
            return int(rate), int(round(frames / rate * 1000))
    except (wave.Error, EOFError):
        return 24000, 0


def _parse_numbered(content: str, count: int) -> list[str] | None:
    found: dict[int, str] = {}
    for line in content.splitlines():
        match = NUMBERED_LINE.match(line.strip())
        if not match:
            continue
        index = int(match.group(1))
        if 1 <= index <= count and match.group(2).strip():
            found[index] = match.group(2).strip()
    if len(found) != count:
        return None
    return [found[index + 1] for index in range(count)]


def _split_segments(text: str, offset_ms: int, duration_ms: int, lang: str | None) -> list[Segment]:
    """Split the provider's paragraph into sentences and spread the window time over them."""
    parts = [part.strip() for part in SENTENCE_SPLIT.split(text) if part.strip()]
    if not parts:
        return []

    total_chars = sum(len(part) for part in parts) or 1
    segments: list[Segment] = []
    cursor = offset_ms
    for part in parts:
        length = int(round(duration_ms * len(part) / total_chars))
        start = cursor
        end = min(offset_ms + duration_ms, cursor + max(1, length))
        cursor = end
        segments.append(
            Segment(text=part, lang=lang, confidence=0.9, started_ms=start, ended_ms=end)
        )
    return segments


def _looks_untranslated(source: str, output: str) -> bool:
    if not output:
        return True
    return re.sub(r"\s+", " ", source.strip().lower()) == re.sub(r"\s+", " ", output.strip().lower())
