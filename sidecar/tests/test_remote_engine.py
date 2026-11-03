"""Remote engine contract tests against a local fake OpenAI-compatible server.

The fake provider speaks the same HTTP surface as OpenRouter / vLLM / Ollama's `/v1`:
`POST /v1/chat/completions` and `POST /v1/audio/transcriptions`. No network, no API key.
"""

from __future__ import annotations

import base64
import io
import json
import re
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest

from sidecar.engine import factory
from sidecar.engine.remote import (
    DeepgramSttEngine,
    RemoteAuthError,
    RemoteConfig,
    RemoteError,
    RemoteMtEngine,
    RemoteSttEngine,
    RemoteTtsEngine,
)


class FakeProvider(BaseHTTPRequestHandler):
    mode = "numbered"  # numbered | plain | auth
    chat_requests: list[dict] = []
    transcription_requests: list[bytes] = []
    deepgram_requests: list[dict] = []
    speech_requests: list[dict] = []
    rate_limit_once = False
    rate_limited = 0

    def log_message(self, *args) -> None:  # keep pytest output clean
        pass

    def do_GET(self) -> None:  # noqa: N802 - http.server naming
        if self.path.rstrip("/").endswith("/models"):
            self._send(200, {"data": [{"id": "test-model", "name": "Test Model"}]})
            return
        if self.path.rstrip("/").endswith("/api/tags"):
            self._send(200, {"models": [{"name": "test-model", "model": "test-model"}]})
            return
        self._send(404, {"error": "not found"})

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802 - http.server naming
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)

        if self.path.endswith("/chat/completions"):
            if FakeProvider.mode == "auth":
                self._send(401, {"error": {"message": "invalid api key"}})
                return
            if FakeProvider.rate_limit_once:
                FakeProvider.rate_limit_once = False
                FakeProvider.rate_limited += 1
                self._send(
                    429,
                    {
                        "object": "error",
                        "message": "Rate limit exceeded",
                        "type": "rate_limited",
                        "code": "1300",
                    },
                )
                return
            payload = json.loads(raw)
            FakeProvider.chat_requests.append(payload)
            user = next((m["content"] for m in payload["messages"] if m["role"] == "user"), "")
            if FakeProvider.mode == "plain":
                content = "Halo semua, kita mulai sekarang."
            else:
                content = _numbered_reply(user)
            self._send(200, {"choices": [{"message": {"role": "assistant", "content": content}}]})
            return

        if self.path.endswith("/audio/transcriptions"):
            FakeProvider.transcription_requests.append(raw)
            self._send(200, {"text": "Halo semua. Kita mulai sekarang.", "language": "id"})
            return

        if self.path.endswith("/audio/speech"):
            payload = json.loads(raw)
            FakeProvider.speech_requests.append(payload)
            audio = _wav_payload()
            if "voice_id" in payload or "ref_audio" in payload:
                self._send(200, {"audio_data": base64.b64encode(audio).decode("ascii")})
            else:
                self._send_bytes(200, audio, "audio/wav")
            return

        parsed = urlparse(self.path)
        if parsed.path.endswith("/listen"):
            if FakeProvider.mode == "auth":
                self._send(401, {"err_msg": "invalid credentials"})
                return
            if self.headers.get("Authorization") != "Token test-key":
                self._send(401, {"err_msg": "missing token"})
                return
            FakeProvider.deepgram_requests.append(
                {"params": {k: v[0] for k, v in parse_qs(parsed.query).items()}, "bytes": raw}
            )
            self._send(
                200,
                {
                    "results": {
                        "channels": [
                            {
                                "detected_language": "id",
                                "language_confidence": 0.94,
                                "alternatives": [
                                    {
                                        "transcript": "Halo semua. Kita mulai sekarang.",
                                        "confidence": 0.97,
                                    }
                                ],
                            }
                        ]
                    }
                },
            )
            return

        self._send(404, {"error": "not found"})


def _wav_payload(seconds: float = 0.5, rate: int = 24000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x00\x00" * int(rate * seconds))
    return buffer.getvalue()


def _numbered_reply(user: str) -> str:

    out: list[str] = []
    for line in user.splitlines():
        match = re.match(r"^\s*(\d+)[.)]\s*(.*)$", line)
        if match:
            out.append(f"{match.group(1)}. [id] {match.group(2)}")
        elif line.strip():
            out.append(f"[id] {line}")
    return "\n".join(out)


@pytest.fixture()
def provider():
    FakeProvider.mode = "numbered"
    FakeProvider.chat_requests = []
    FakeProvider.transcription_requests = []
    FakeProvider.deepgram_requests = []
    FakeProvider.speech_requests = []
    FakeProvider.rate_limit_once = False
    FakeProvider.rate_limited = 0
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeProvider)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def _mt(base_url: str, **kwargs) -> RemoteMtEngine:
    return RemoteMtEngine(RemoteConfig(provider="custom", base_url=base_url, model="test-model", **kwargs))


def test_batch_translation_keeps_one_line_per_sentence(provider):
    engine = _mt(provider)
    outputs = engine.translate_many(["Hello everyone", "How are you?"], "eng_Latn", "ind_Latn")

    assert [text for text, _ in outputs] == ["[id] Hello everyone", "[id] How are you?"]
    assert len(FakeProvider.chat_requests) == 1, "one request per window, not per sentence"

    payload = FakeProvider.chat_requests[0]
    assert payload["model"] == "test-model"
    assert payload["temperature"] == 0
    system = payload["messages"][0]["content"]
    assert "English" in system and "Indonesian" in system


def test_unnumbered_reply_falls_back_to_sentence_requests(provider):
    FakeProvider.mode = "plain"
    engine = _mt(provider)
    outputs = engine.translate_many(["Hello", "Good morning"], "eng_Latn", "ind_Latn")

    assert [text for text, _ in outputs] == ["Halo semua, kita mulai sekarang."] * 2
    # one batch attempt, then one request per sentence
    assert len(FakeProvider.chat_requests) == 3


def test_repeated_sentence_is_served_from_cache(provider):
    engine = _mt(provider)
    engine.translate_many(["Same line"], "eng_Latn", "ind_Latn")
    engine.translate_many(["Same line"], "eng_Latn", "ind_Latn")

    assert len(FakeProvider.chat_requests) == 1


def test_auth_error_is_readable(provider):
    FakeProvider.mode = "auth"
    engine = _mt(provider, api_key="bad")
    with pytest.raises(RemoteAuthError):
        engine.translate_many(["Hello"], "eng_Latn", "ind_Latn")


def test_speech_upload_returns_sentences_with_timing(provider):
    engine = RemoteSttEngine(RemoteConfig(provider="custom", base_url=provider, model="whisper-1"))
    samples = np.zeros(16_000, dtype=np.float32)  # 1 s window

    result = engine.transcribe(samples, language="id", offset_ms=4_000)

    assert [segment.text for segment in result.segments] == ["Halo semua.", "Kita mulai sekarang."]
    assert result.language == "id"
    first, second = result.segments
    assert first.started_ms == 4_000
    assert second.ended_ms == 5_000
    assert first.started_ms < second.started_ms

    body = FakeProvider.transcription_requests[0]
    assert b"RIFF" in body and b"audio/wav" in body


def test_speech_without_hint_requests_language_detection(provider):
    """LISTEN must follow the meeting's language without the owner preselecting it."""
    engine = RemoteSttEngine(RemoteConfig(provider="groq", base_url=provider, model="whisper-large-v3-turbo"))
    samples = np.zeros(16_000, dtype=np.float32)

    result = engine.transcribe(samples)

    body = FakeProvider.transcription_requests[0]
    assert b'name="response_format"' in body
    assert b"verbose_json" in body
    assert b'name="language"' not in body, "a hint would defeat auto-detection"
    assert result.language == "id"
    assert result.language_probability > 0.9


def test_speech_with_hint_asks_for_plain_json(provider):
    engine = RemoteSttEngine(RemoteConfig(provider="custom", base_url=provider, model="whisper-1"))
    engine.transcribe(np.zeros(16_000, dtype=np.float32), language="id-ID")

    body = FakeProvider.transcription_requests[0]
    assert b"verbose_json" not in body
    assert b'name="language"' in body and b"\r\n\r\nid\r\n" in body


def test_deepgram_detects_language_with_its_own_auth_scheme(provider):
    engine = DeepgramSttEngine(
        RemoteConfig(
            provider="deepgram",
            base_url=provider,
            model="nova-3",
            api_key="test-key",
        )
    )

    result = engine.transcribe(np.zeros(16_000, dtype=np.float32))

    request = FakeProvider.deepgram_requests[0]
    assert request["params"]["model"] == "nova-3"
    assert request["params"]["detect_language"] == "true"
    assert request["params"]["smart_format"] == "true"
    assert request["bytes"][:4] == b"RIFF"
    assert result.language == "id"
    assert result.language_probability == pytest.approx(0.94)
    assert [segment.text for segment in result.segments] == ["Halo semua.", "Kita mulai sekarang."]


def test_deepgram_language_hint_skips_detection(provider):
    engine = DeepgramSttEngine(
        RemoteConfig(provider="deepgram", base_url=provider, model="nova-3", api_key="test-key")
    )
    engine.transcribe(np.zeros(16_000, dtype=np.float32), language="en")

    request = FakeProvider.deepgram_requests[0]
    assert request["params"]["language"] == "en"
    assert "detect_language" not in request["params"]


def test_deepgram_rejected_key_is_readable(provider):
    FakeProvider.mode = "auth"
    engine = DeepgramSttEngine(
        RemoteConfig(provider="deepgram", base_url=provider, model="nova-3", api_key="bad-key")
    )
    with pytest.raises(RemoteAuthError):
        engine.transcribe(np.zeros(16_000, dtype=np.float32))


def test_factory_routes_deepgram_to_speech_only(provider):
    speech = factory.build_stt(
        {"provider": "deepgram", "baseUrl": provider, "model": "nova-3", "apiKey": "test-key"}
    )
    assert isinstance(speech, DeepgramSttEngine)
    assert factory.stt_provider_of({"provider": "deepgram"}) == "deepgram"

    with pytest.raises(ValueError, match="speech-recognition"):
        factory.build_mt({"provider": "deepgram", "model": "nova-3"})
    with pytest.raises(ValueError):
        factory.build_stt({"provider": "deepgram", "baseUrl": provider, "model": "nova-3"})


def test_missing_config_is_reported_not_crashed(provider):
    engine = _mt("")
    with pytest.raises(RemoteError):
        engine.load()
    assert engine.status["ok"] is False
    assert "baseUrl" in engine.status["missing"]


def test_factory_defaults_unknown_provider_to_local():
    assert factory.provider_of({"provider": "nope"}) == "local"
    assert factory.provider_of(None) == "local"
    assert factory.describe({"provider": "ollama", "model": "qwen2.5:7b"}) == "ollama:qwen2.5:7b"
    assert factory.describe({"provider": "deepgram", "model": "nova-3"}) == "deepgram:nova-3"


def test_factory_rejects_incomplete_remote_config():
    with pytest.raises(ValueError):
        factory.build_mt({"provider": "openrouter", "model": "x"})


def test_mistral_requests_language_detection_with_return_language(provider):
    engine = RemoteSttEngine(
        RemoteConfig(provider="mistral", base_url=provider, model="voxtral-mini-transcribe-3-0")
    )

    result = engine.transcribe(np.zeros(16_000, dtype=np.float32))

    body = FakeProvider.transcription_requests[0]
    assert b'name="return_language"' in body
    assert b"verbose_json" not in body, "Mistral rejects response_format"
    assert b'name="language"' not in body
    assert result.language == "id"


def test_remote_tts_mistral_parses_base64_audio(provider, tmp_path):
    engine = RemoteTtsEngine(
        RemoteConfig(
            provider="mistral",
            base_url=provider,
            model="voxtral-mini-tts-3-0",
            api_key="test-key",
        ),
        output_dir=tmp_path,
    )

    path, rate, duration_ms = engine.synthesize("Halo semua", voice="voice_478")

    request = FakeProvider.speech_requests[0]
    assert request["voice_id"] == "voice_478"
    assert request["response_format"] == "wav"
    assert path.is_file() and path.stat().st_size > 44
    assert rate == 24000
    assert duration_ms == pytest.approx(500, abs=5)


def test_remote_tts_openai_reads_binary_audio(provider, tmp_path):
    engine = RemoteTtsEngine(
        RemoteConfig(provider="openai", base_url=provider, model="gpt-4o-mini-tts"),
        output_dir=tmp_path,
    )

    path, rate, duration_ms = engine.synthesize("Hello", voice="alloy")

    assert FakeProvider.speech_requests[0]["voice"] == "alloy"
    assert path.is_file()
    assert rate == 24000 and duration_ms == pytest.approx(500, abs=5)


def test_remote_tts_sends_cloned_sample_for_mistral(provider, tmp_path):
    sample = tmp_path / "voice.wav"
    sample.write_bytes(_wav_payload(seconds=1.0))
    output = tmp_path / "out"
    engine = RemoteTtsEngine(
        RemoteConfig(provider="mistral", base_url=provider, model="voxtral-mini-tts-3-0"),
        output_dir=output,
        voice_sample=sample,
        voice_source="clone",
    )

    engine.synthesize("Halo semua")

    request = FakeProvider.speech_requests[0]
    assert "ref_audio" in request
    assert base64.b64decode(request["ref_audio"]) == sample.read_bytes()


def test_factory_builds_tts_only_for_speech_providers(provider):
    engine = factory.build_tts(
        {"provider": "mistral", "baseUrl": provider, "model": "voxtral-mini-tts-3-0"}
    )
    assert isinstance(engine, RemoteTtsEngine)
    assert factory.tts_provider_of({"provider": "mistral"}) == "mistral"
    assert factory.build_tts({"provider": "local"}) is None
    assert factory.build_tts({"provider": "deepgram", "model": "nova-3"}) is None
    with pytest.raises(ValueError):
        factory.build_tts({"provider": "mistral", "model": "voxtral-mini-tts-3-0"})


def test_mistral_429_is_retried_instead_of_losing_the_subtitle(provider):
    FakeProvider.rate_limit_once = True
    engine = RemoteMtEngine(
        RemoteConfig(provider="mistral", base_url=provider, model="mistral-small-2603")
    )

    outputs = engine.translate_many(["Hello everyone"], "eng_Latn", "ind_Latn")

    assert outputs[0][0] == "[id] Hello everyone"
    assert FakeProvider.rate_limited == 1, "the 429 response was retried"
    assert len(FakeProvider.chat_requests) == 1
