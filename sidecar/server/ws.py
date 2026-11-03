"""WebSocket endpoint: audio in -> STT worker -> MT worker -> events out (09-sidecar-spec §3).

Electron sends binary audio frames (`0x01` you / `0x02` remote) and JSON control frames
(`hello`, `state`, `config`, `ping`). The sidecar answers with JSON events (`hello_ack`,
`engine_ready`, `transcript`, `translation`, `audio_level`, `notice`, `pong`).
"""

from __future__ import annotations

import asyncio
import json
import logging
import queue
import re
import threading
import time
from dataclasses import replace

from fastapi import WebSocket

from sidecar import config
from sidecar.engine import factory, languages
from sidecar.engine.audio_router import TAG_REMOTE, TAG_YOU, AudioRouter
from sidecar.engine.remote import RemoteConfig, RemoteError, RemoteRateLimitError
from sidecar.engine.mt import ModelMissingError as MtModelMissing
from sidecar.engine.stt import ModelMissingError as SttModelMissing
from sidecar.engine.tts import (
    KokoroEngine,
    QwenCloneEngine,
    TtsModelMissingError,
    TtsUnsupportedLanguageError,
)
from sidecar.engine.vad import AudioWindow, frame_from_bytes, rms_of
from sidecar.engine.streaming import (
    LocalStreamingProvider,
    StreamFinal,
    StreamPartial,
    build_streaming_provider,
)
from sidecar.server.state import SidecarState

log = logging.getLogger("ws")

AUDIO_LEVEL_INTERVAL = 0.2  # 5 events per second per tag (09-sidecar-spec §3.2)

# STT and MT run as a pipeline (two threads, two queues). Each queue is deliberately short: when
# the machine cannot keep up, the oldest window is dropped so the shown subtitle stays close to
# the audio instead of drifting minutes behind (measured 16 s median delay before this).
STT_QUEUE_SIZE = 3
MT_QUEUE_SIZE = 3
# Streaming commits are translated per clause; the queue is short so a slow MT never becomes a
# backlog (the newest clause matters, not the oldest).
TEXT_MT_QUEUE_SIZE = 4

_WORD = re.compile(r"[\w']+", re.UNICODE)


def _words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _strip_overlap(text: str, previous: tuple[str, int] | None, started_ms: int) -> str:
    """Drop the tail of the previous window that Whisper transcribed a second time.

    Every window keeps 0.8 s of overlap so the first word is not clipped. Whisper then often
    repeats the last words of the previous sentence at the start of the new one ("...looks
    noticeably better." / "noticeably better. One thing..."). Repeating that in the subtitle
    looks broken, so the shared prefix is removed when the segment starts inside audio that was
    already transcribed.
    """
    if not previous:
        return text
    previous_text, previous_end = previous
    if started_ms >= previous_end:
        return text
    previous_words = _words(previous_text)
    new_words = _words(text)
    limit = min(6, len(previous_words), len(new_words))
    for count in range(limit, 1, -1):
        if new_words[:count] == previous_words[-count:]:
            parts = text.split()
            if len(parts) <= count:
                return ""
            return " ".join(parts[count:]).lstrip(" ,.;:-")
    return text


class WsSession:
    """One Electron connection: receive loop, worker thread and an outgoing event queue."""

    def __init__(self, websocket: WebSocket, state: SidecarState) -> None:
        self.websocket = websocket
        self.state = state
        self.loop = asyncio.get_running_loop()
        self.out: asyncio.Queue[object] = asyncio.Queue()
        # Jobs carry the generation they were created in, so everything queued before the user
        # pressed stop is discarded instead of showing up as a late subtitle.
        self.jobs: queue.Queue[tuple[int, AudioWindow] | None] = queue.Queue(maxsize=STT_QUEUE_SIZE)
        self.mt_jobs: queue.Queue[tuple[int, AudioWindow, list[tuple[str, object]]] | None] = queue.Queue(
            maxsize=MT_QUEUE_SIZE
        )
        # Streaming finals go straight to MT here (they never pass through the VAD/STT workers).
        self.text_jobs: queue.Queue[tuple[int, str, str, str, str, int, int] | None] = queue.Queue(
            maxsize=TEXT_MT_QUEUE_SIZE
        )
        self._generation = 0
        self.router = AudioRouter(state.stream)
        self._chunk_counter = 0
        self._last_level: dict[str, float] = {TAG_YOU: 0.0, TAG_REMOTE: 0.0}
        self._stt_thread = threading.Thread(target=self._stt_loop, name="stt-worker", daemon=True)
        self._mt_thread = threading.Thread(target=self._mt_loop, name="mt-worker", daemon=True)
        self._text_mt_thread = threading.Thread(target=self._text_mt_loop, name="mt-text-worker", daemon=True)
        self._frames = {TAG_YOU: 0, TAG_REMOTE: 0}
        self._dropped_windows = 0
        self._warmup_started = False
        self._warmup_stt_only = False
        # Last emitted segment per stream, used to strip the 0.8 s overlap echo.
        self._last_segment: dict[str, tuple[str, int]] = {}
        # True while a provider switch is building engines; the switch warms them itself.
        self._switching = False
        # Streaming provider (only active when stt_mode=stream). Transcription runs on its own
        # thread: one 1.1 s Whisper call on the event loop would stall the audio frames.
        self.streaming: LocalStreamingProvider | None = None
        self.streaming_mode = False
        self._stream_wake = threading.Event()
        self._stream_stop = threading.Event()
        self._fallback_pending = False
        self._stream_thread = threading.Thread(target=self._stream_loop, name="stt-stream", daemon=True)
        # TTS is synthesized here and played by Electron (keeps the model out of the renderer).
        self.tts = KokoroEngine(state.models_dir)
        self.qwen_tts = QwenCloneEngine(state.models_dir)

    # -- lifecycle -------------------------------------------------------------------------
    async def run(self) -> None:
        self._stt_thread.start()
        self._mt_thread.start()
        self._text_mt_thread.start()
        self._stream_thread.start()
        sender = asyncio.create_task(self._sender_loop())
        try:
            await self._emit_async({"t": "hello_ack", "port": self.state.port, "version": config.VERSION})
            await self._emit_engine_status()
            while True:
                message = await self.websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                payload = message.get("bytes")
                if payload is not None:
                    self._on_binary(payload)
                    continue
                text = message.get("text")
                if text is not None:
                    self._on_text(text)
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("ws session error", exc_info=True, extra={"fields": {"error": str(exc)}})
        finally:
            self._shutdown_workers()
            sender.cancel()
            try:
                await sender
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

    def _emit_streaming_event(self, event: StreamPartial | StreamFinal) -> None:
        """Emit streaming partial/final events from the provider."""
        if not self.streaming_mode:
            return
        # A transcribe already in flight when the user switched modes must not surface as a
        # line for the inactive source.
        capture_mode = self.router.config.capture_mode
        if capture_mode == "listen" and event.tag != TAG_REMOTE:
            return
        if capture_mode == "speak" and event.tag != TAG_YOU:
            return
        if event.text and event.text.strip():
            log.debug(
                "streaming event",
                extra={
                    "fields": {
                        "kind": "partial" if isinstance(event, StreamPartial) else "final",
                        "tag": event.tag,
                        "chars": len(event.text),
                    }
                },
            )
            if isinstance(event, StreamPartial):
                self._emit({
                    "t": "partial",
                    "tag": event.tag,
                    "window_id": event.window_id,
                    "text": event.text,
                    "started_ms": event.started_ms,
                    "end_ms": event.ended_ms,
                    "conf": event.confidence,
                    "session_id": self.router.config.session_id,
                })
            elif isinstance(event, StreamFinal):
                self._chunk_counter += 1
                chunk_id = event.chunk_id or f"c-{self._chunk_counter:03d}"
                self._emit({
                    "t": "transcript",
                    "tag": event.tag,
                    "window_id": event.window_id,
                    "lang": event.lang or "",
                    "text": event.text,
                    "started_ms": event.started_ms,
                    "end_ms": event.ended_ms,
                    "conf": event.confidence,
                    "session_id": self.router.config.session_id,
                    "chunk_id": chunk_id,
                })
                # Translation is the primary output in LISTEN: hand the committed clause to the
                # text-MT worker immediately (the batch MT worker never sees streaming windows).
                self._enqueue_text_translation(
                    chunk_id,
                    event.tag,
                    event.text,
                    event.lang or self.router.source_language(event.tag) or "en",
                    int(event.started_ms),
                    int(event.ended_ms),
                )

    # -- outgoing --------------------------------------------------------------------------
    async def _sender_loop(self) -> None:
        while True:
            item = await self.out.get()
            if item is None:
                break
            if isinstance(item, tuple) and item and item[0] == "bin":
                await self.websocket.send_bytes(item[1])
            else:
                await self.websocket.send_json(item)

    def _emit(self, payload: dict) -> None:
        """Thread-safe emit (the worker threads call this)."""
        try:
            self.loop.call_soon_threadsafe(self.out.put_nowait, payload)
        except RuntimeError:
            # The session closed while a worker was still finishing a window; nothing to deliver.
            pass

    async def _emit_async(self, payload: dict) -> None:
        """Emit from inside the event loop."""
        self.out.put_nowait(payload)

    async def _emit_engine_status(self) -> None:
        for engine, status in (("stt", self.state.stt.status), ("mt", self.state.mt.status)):
            await self.out.put(
                {
                    "t": "engine_ready",
                    "engine": engine,
                    "ok": bool(status.get("ok")),
                    "reason": None if status.get("ok") else "model_missing",
                    "provider": self._describe(engine),
                }
            )
        await self.out.put({"t": "engine_ready", "engine": "vad", "ok": True, "reason": None})

    # -- incoming --------------------------------------------------------------------------
    def _on_binary(self, data: bytes) -> None:
        if len(data) < 1:
            return
        tag_byte = data[0]
        if tag_byte == 0x01:
            tag = TAG_YOU
        elif tag_byte == 0x02:
            tag = TAG_REMOTE
        else:
            log.debug("ignored frame", extra={"fields": {"tag": tag_byte}})
            return

        self._frames[tag] = self._frames.get(tag, 0) + 1
        if self._frames[tag] % 25 == 1:
            log.debug("audio frames", extra={"fields": {"tag": tag, "count": self._frames[tag]}})

        # Mode guard (owner request 2026-10-26): only the active source may cost CPU. Even if a
        # stale helper keeps sending, LISTEN drops `you` frames and SPEAK drops `remote` frames.
        capture_mode = self.router.config.capture_mode
        if capture_mode == "listen" and tag != TAG_REMOTE:
            return
        if capture_mode == "speak" and tag != TAG_YOU:
            return

        samples = frame_from_bytes(data[1:])
        now = time.monotonic()
        if now - self._last_level.get(tag, 0.0) >= AUDIO_LEVEL_INTERVAL:
            self._last_level[tag] = now
            self._emit({"t": "audio_level", "tag": tag, "rms": round(rms_of(samples), 4)})

        # Streaming mode: bypass VAD router, feed audio directly to LocalStreamingProvider.
        # The transcription itself runs on _stream_thread; this path only buffers the frame.
        if self.streaming_mode and self.streaming is not None:
            if self._fallback_pending:
                self._disable_streaming("streaming could not keep up")
            else:
                self.streaming.push(tag, samples, time.monotonic() * 1000)
                self._stream_wake.set()
        else:
            for window in self.router.push(tag, samples):
                self._enqueue_window(window)

    def _on_text(self, text: str) -> None:
        try:
            message = json.loads(text)
        except json.JSONDecodeError:
            self._emit({"t": "notice", "level": "warn", "code": "bad_frame", "message": "invalid JSON frame"})
            return
        if not isinstance(message, dict):
            return

        kind = message.get("t")
        if kind == "hello":
            self._emit({"t": "hello_ack", "port": self.state.port, "version": config.VERSION})
        elif kind == "ping":
            self._emit({"t": "pong"})
        elif kind == "warmup":
            self._start_warmup(stt_only=bool(message.get("stt_only")))
        elif kind == "config":
            self._apply_config(message)
        elif kind == "state":
            if message.get("mode") == "speak_finish":
                self._handle_speak_finish()
            else:
                self._apply_state(message)
        elif kind == "translate_text":
            self._handle_translate_text(message)
        elif kind == "tts":
            self._handle_tts(message)
        else:
            self._emit(
                {
                    "t": "notice",
                    "level": "warn",
                    "code": "unknown_frame",
                    "message": f"unknown control frame: {kind!r}",
                }
            )

    def _start_warmup(self, stt_only: bool = False) -> None:
        """Load both models ahead of the first window (cold start is ~10 s on this machine).

        `stt_only` is used by the Prompt page: it transcribes without translating, so loading
        NLLB/Ollama would only cost RAM and a few seconds.
        """
        if self._warmup_started or self._switching:
            # A pending engine switch already loads the models it needs; warming the old pair
            # here would load whisper twice (measured: +0.6 s before the first subtitle).
            return
        self._warmup_started = True
        self._warmup_stt_only = stt_only
        threading.Thread(target=self._warmup, name="engine-warmup", daemon=True).start()

    def _warmup(self) -> None:
        started = time.monotonic()
        try:
            self.state.stt.ensure_loaded()
            self._emit({"t": "engine_ready", "engine": "stt", "ok": True, "reason": None})
        except SttModelMissing:
            self._emit({"t": "engine_ready", "engine": "stt", "ok": False, "reason": "model_missing"})
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("stt warmup failed", extra={"fields": {"error": str(exc)}})
            self._emit({"t": "engine_ready", "engine": "stt", "ok": False, "reason": str(exc)})

        if self._warmup_stt_only:
            # Prompt page: transcribe only. Never load NLLB/Ollama here.
            self._warmup_stt_only = False
            log.info(
                "stt warmed up (mt skipped)",
                extra={"fields": {"ms": int((time.monotonic() - started) * 1000)}},
            )
            return

        try:
            self.state.mt.load()
            self._emit({"t": "engine_ready", "engine": "mt", "ok": True, "reason": None})
        except MtModelMissing:
            self._emit({"t": "engine_ready", "engine": "mt", "ok": False, "reason": "model_missing"})
        except Exception as exc:  # pragma: no cover - defensive
            log.warning("mt warmup failed", extra={"fields": {"error": str(exc)}})
            self._emit({"t": "engine_ready", "engine": "mt", "ok": False, "reason": str(exc)})

        log.info("engines warmed up", extra={"fields": {"ms": int((time.monotonic() - started) * 1000)}})

    def _apply_config(self, message: dict) -> None:
        cfg = self.router.config
        for key in (
            "my_lang",
            "remote_lang",
            "tts_enabled",
            "tts_voice",
            "beam_size",
            "whisper_model",
            "vad_max_window_ms",
            "vad_silence_ms",
            "vad_min_speech_ms",
        ):
            if key in message:
                setattr(cfg, key, message[key])
        # `stt_only` (Prompt page) makes the router return no target language, so the MT
        # worker is never asked to translate. Anything else is a normal translating session.
        requested_mode = str(message.get("mode") or cfg.mode or "translate_on").lower()
        cfg.mode = "stt_only" if requested_mode == "stt_only" else "translate_on"
        # Streaming config (M3.5). `auto` resolves per provider: local = stream, remote = batch.
        engine_msg = message.get("engine") if isinstance(message.get("engine"), dict) else {}
        stt_provider = (
            (engine_msg.get("stt") or {}).get("provider")
            or (self.state.engine_cfg.get("stt") or {}).get("provider")
            or "local"
        )
        requested = str(message.get("stt_mode") or getattr(cfg, "stt_mode", "batch") or "batch").strip().lower()
        if requested == "auto":
            mode = "stream" if stt_provider == "local" else "batch"
        else:
            mode = requested if requested in ("stream", "batch") else "batch"
        if stt_provider != "local":
            mode = "batch"
        cfg.stt_mode = mode
        for key in ("retranscribe_ms", "commit_min_words", "commit_silence_ms"):
            if key in message and hasattr(cfg, key):
                setattr(cfg, key, message[key])

        self.router.apply_config()
        # Mode guard: keep only the active capture source busy (LISTEN = remote, SPEAK = you).
        capture_mode = str(message.get("capture_mode") or getattr(cfg, "capture_mode", "both")).lower()
        if capture_mode not in ("listen", "speak", "both"):
            capture_mode = "both"
        if capture_mode != cfg.capture_mode:
            cfg.capture_mode = capture_mode
            inactive = TAG_YOU if capture_mode == "listen" else TAG_REMOTE if capture_mode == "speak" else None
            if inactive is not None:
                if self.streaming is not None:
                    self.streaming.reset(inactive)
                self.router.reset_tag(inactive)
        if mode == "stream" and not self.streaming_mode and self.state.stt is not None:
            try:
                self.streaming = build_streaming_provider(self.state.stt)
                self.streaming_mode = True
                self._fallback_pending = False
                self._apply_streaming_languages()
                log.info("streaming mode enabled", extra={"fields": {"stt_mode": "stream"}})
            except Exception as exc:
                self.streaming = None
                self.streaming_mode = False
                log.warning("streaming init failed", extra={"fields": {"error": str(exc)}})
        elif mode == "batch" and self.streaming_mode:
            self._disable_streaming("batch mode requested")
        if self.streaming_mode and self.streaming is not None:
            self._apply_streaming_languages()

        if "session_id" in message:
            cfg.session_id = message["session_id"]
        log.info("config applied", extra={"fields": cfg.to_dict()})
        engine = message.get("engine")
        if isinstance(engine, dict):
            self._apply_engine(engine)

    def _apply_streaming_languages(self) -> None:
        """Give the streaming provider the per-stream Whisper language hint."""
        if self.streaming is None:
            return
        for tag in (TAG_YOU, TAG_REMOTE):
            self.streaming.set_language(tag, self.router.source_language(tag))

    def _disable_streaming(self, reason: str) -> None:
        """Fall back to the batch VAD pipeline (slow machine or remote provider)."""
        if not self.streaming_mode:
            return
        self.streaming_mode = False
        self._fallback_pending = False
        if self.streaming is not None:
            self.streaming.reset()
            self.streaming = None
        self.router.config.stt_mode = "batch"
        self.router.reset()
        self._emit(
            {
                "t": "notice",
                "level": "warn",
                "code": "stream_fallback",
                "message": f"{reason} - switched to batch mode",
            }
        )
        self._emit({"t": "stt_mode", "mode": "batch"})
        log.warning("streaming disabled", extra={"fields": {"reason": reason}})

    def _handle_speak_finish(self) -> None:
        """Flush the last streaming partial as a final and emit the merged SPEAK text."""
        merged_parts: list[str] = []
        # Collect already-committed texts for `you`.
        if self.streaming is not None:
            committed = self.streaming._committed_texts.get(TAG_YOU, [])
            merged_parts.extend(committed)
            # Flush the current partial as a final if it has text.
            state = self.streaming.tags.get(TAG_YOU)
            if state is not None and state.get("partial_text", "").strip():
                merged_parts.append(state["partial_text"].strip())
            # Reset the buffer and committed texts for the next take.
            self.streaming.reset(TAG_YOU)
            self.streaming._committed_texts.pop(TAG_YOU, None)
        merged = " ".join(merged_parts).strip()
        if merged:
            self._emit({
                "t": "speak_final",
                "text": merged,
                "session_id": self.router.config.session_id,
            })
        log.info("speak finished", extra={"fields": {"merged_chars": len(merged)}})

    def _handle_tts(self, message: dict) -> None:
        """Synthesize a translated sentence with the provider that owns Speak."""
        request_id = message.get("request_id")
        text = str(message.get("text") or "").strip()
        lang = str(message.get("lang") or "en").strip().lower()
        model = str(message.get("model") or "kokoro-onnx").strip().lower()
        voice = message.get("voice") or None
        provider = str(message.get("provider") or "local").strip().lower()
        try:
            speed = float(message.get("speed") or 1.0)
        except (TypeError, ValueError):
            speed = 1.0
        if not text:
            self._emit(
                {
                    "t": "tts_error",
                    "request_id": request_id,
                    "code": "empty_text",
                    "message": "nothing to speak",
                }
            )
            return
        threading.Thread(
            target=self._tts_job,
            args=(request_id, text, lang, model, voice, speed, message),
            name="tts-job",
            daemon=True,
        ).start()

    def _tts_job(
        self,
        request_id: object,
        text: str,
        lang: str,
        model: str,
        voice: str | None,
        speed: float,
        message: dict,
    ) -> None:
        clone = model in ("cloned", "qwen3-tts")
        provider = str(message.get("provider") or "local").strip().lower()
        remote_tts = None
        try:
            if provider != "local":
                remote_tts = factory.build_tts(
                    message,
                    output_dir=config.data_dir() / "tts",
                    voice_sample=config.data_dir() / "voices" / "voice.wav",
                    voice_source=str(message.get("voice_source") or "preset"),
                )
                path, sample_rate, duration_ms = remote_tts.synthesize(
                    text, lang=lang, voice=voice, speed=speed
                )
            elif clone:
                path, sample_rate, duration_ms = self.qwen_tts.synthesize(text, lang=lang)
            else:
                path, sample_rate, duration_ms = self.tts.synthesize(
                    text, lang=lang, voice=voice, speed=speed
                )
        except TtsModelMissingError:
            if remote_tts is not None:
                remote_tts.unload()
            self._emit(
                {
                    "t": "tts_error",
                    "request_id": request_id,
                    "code": "model_missing",
                    "message": "voice clone sample/model not installed",
                }
            )
            return
        except TtsUnsupportedLanguageError as exc:
            if remote_tts is not None:
                remote_tts.unload()
            self._emit(
                {
                    "t": "tts_error",
                    "request_id": request_id,
                    "code": "unsupported_language",
                    "message": str(exc),
                }
            )
            return
        except Exception as exc:  # pragma: no cover - defensive
            if remote_tts is not None:
                remote_tts.unload()
            self._emit(
                {
                    "t": "tts_error",
                    "request_id": request_id,
                    "code": "tts_failed",
                    "message": str(exc),
                }
            )
            return
        if remote_tts is not None:
            remote_tts.unload()
        self._emit(
            {
                "t": "tts_ready",
                "request_id": request_id,
                "path": str(path),
                "sample_rate": sample_rate,
                "duration_ms": duration_ms,
            }
        )

    def _handle_translate_text(self, message: dict) -> None:
        """On-demand translation for SPEAK (`Putar`), off the event loop."""
        request_id = message.get("request_id")
        text = str(message.get("text") or "").strip()
        src = str(message.get("src") or self.router.config.my_lang or "")
        tgt = str(message.get("tgt") or self.router.config.remote_lang or "")
        if not text:
            self._emit(
                {
                    "t": "translated_text",
                    "request_id": request_id,
                    "text_src": "",
                    "text_tgt": "",
                    "src_lang": src,
                    "tgt_lang": tgt,
                    "quality": "warn",
                }
            )
            return
        threading.Thread(
            target=self._translate_text_job,
            args=(request_id, text, src, tgt),
            name="mt-on-demand",
            daemon=True,
        ).start()

    def _translate_text_job(self, request_id: object, text: str, src: str, tgt: str) -> None:
        src_flores = languages.to_flores(src)
        tgt_flores = languages.to_flores(tgt)
        try:
            if not src_flores or not tgt_flores:
                raise ValueError(f"unsupported language pair {src!r} -> {tgt!r}")
            if src_flores == tgt_flores:
                # SPEAK with an "auto"/same partner language: do NOT synthesise the source text
                # in the wrong voice. The UI keeps the Putar button disabled for this case.
                self._emit(
                    {
                        "t": "notice",
                        "level": "warn",
                        "code": "same_language",
                        "message": "The partner language is the same as yours",
                    }
                )
                self._emit(
                    {
                        "t": "translated_text",
                        "request_id": request_id,
                        "text_src": text,
                        "text_tgt": "",
                        "src_lang": src,
                        "tgt_lang": tgt,
                        "quality": "warn",
                    }
                )
                return
            engine = self.state.mt
            translate_with_meta = getattr(engine, "translate_with_meta", None)
            if callable(translate_with_meta):
                translated, quality = translate_with_meta(text, src_flores, tgt_flores)
            else:
                translated, quality = engine.translate(text, src_flores, tgt_flores), "ok"
        except MtModelMissing:
            self._emit(
                {"t": "notice", "level": "warn", "code": "model_missing", "message": "nllb model not installed"}
            )
            return
        except RemoteError as exc:
            self._emit({"t": "notice", "level": "error", "code": "remote_error", "message": str(exc)})
            return
        except Exception as exc:
            self._emit(
                {"t": "notice", "level": "error", "code": "engine_load_failed", "message": f"mt: {exc}"}
            )
            return
        self._emit(
            {
                "t": "translated_text",
                "request_id": request_id,
                "text_src": text,
                "text_tgt": translated,
                "src_lang": src,
                "tgt_lang": tgt,
                "quality": quality,
            }
        )

    def _describe(self, kind: str) -> str:
        return factory.describe(self.state.engine_cfg.get(kind))

    def _apply_engine(self, engine: dict) -> None:
        """Settings -> sidecar: rebuild the pipeline engines when the owner switches provider."""
        cfg = {
            "stt": engine.get("stt") if isinstance(engine.get("stt"), dict) else {"provider": "local"},
            "mt": engine.get("mt") if isinstance(engine.get("mt"), dict) else {"provider": "local"},
        }
        if cfg == self.state.engine_cfg:
            return
        # Windows produced with the old engine must not surface under the new one.
        self._generation += 1
        self._discard_jobs()
        self._switching = True
        threading.Thread(target=self._switch_engines, args=(cfg,), name="engine-switch", daemon=True).start()

    @staticmethod
    def _reusable(kind: str, old_cfg: dict, new_cfg: dict, current, model_name: str) -> bool:
        """Keep the warm engine when the owner did not actually change anything.

        Rebuilding the local whisper on every config frame would throw away the loaded model
        (~0.5-2 s) and delay the first subtitle, so only a real change triggers a rebuild.
        """
        if current is None:
            return False
        old_provider = (
            factory.stt_provider_of(old_cfg.get(kind))
            if kind == "stt"
            else factory.provider_of(old_cfg.get(kind))
        )
        new_provider = (
            factory.stt_provider_of(new_cfg.get(kind))
            if kind == "stt"
            else factory.provider_of(new_cfg.get(kind))
        )
        if old_provider != new_provider:
            return False
        if new_provider == "local":
            return kind != "stt" or getattr(current, "model_name", None) == model_name
        old_remote = RemoteConfig.from_dict(old_cfg.get(kind))
        new_remote = RemoteConfig.from_dict(new_cfg.get(kind))
        return (old_remote.base_url, old_remote.model, old_remote.api_key) == (
            new_remote.base_url,
            new_remote.model,
            new_remote.api_key,
        )

    def _switch_engines(self, cfg: dict) -> None:
        started = time.monotonic()
        log.info(
            "switching engines",
            extra={"fields": {"stt": factory.describe(cfg["stt"]), "mt": factory.describe(cfg["mt"])}},
        )
        old_cfg = self.state.engine_cfg or {}
        model_name = str(self.router.config.whisper_model or "small")
        try:
            reuse_stt = self._reusable("stt", old_cfg, cfg, self.state.stt, model_name)
            reuse_mt = self._reusable("mt", old_cfg, cfg, self.state.mt, model_name)
            stt = (
                self.state.stt
                if reuse_stt
                else factory.build_stt(cfg["stt"], models_dir=self.state.models_dir, model_name=model_name)
            )
            mt = (
                self.state.mt
                if reuse_mt
                else factory.build_mt(cfg["mt"], models_dir=self.state.models_dir)
            )
        except Exception as exc:
            self._switching = False
            log.warning("engine switch failed", extra={"fields": {"error": str(exc)}})
            self._emit({"t": "notice", "level": "error", "code": "engine_switch_failed", "message": str(exc)})
            self._emit(
                {
                    "t": "engine_ready",
                    "engine": "stt",
                    "ok": False,
                    "reason": str(exc),
                    "provider": factory.describe(cfg["stt"]),
                }
            )
            return

        old_stt, old_mt = self.state.stt, self.state.mt
        self.state.set_engines(stt, mt, cfg)
        # The streaming provider holds the old STT engine; rebuild it (or leave streaming
        # entirely when the new provider is remote, per the 2026-10-25 owner decision).
        if factory.stt_provider_of(cfg["stt"]) == "local":
            if self.streaming_mode:
                self.streaming = build_streaming_provider(stt)
                self._apply_streaming_languages()
        else:
            self._disable_streaming("remote provider uses batch mode")
        for engine in (old_stt, old_mt):
            # The local NLLB/Whisper instances stay warm across switches; only remote pools close.
            if engine is not stt and engine is not mt and getattr(engine, "name", "") in (
                "remote",
                "deepgram",
            ):
                engine.unload()
        self._warmup_started = False
        # Load the local models now (in this thread) instead of waiting for the next window:
        # otherwise the first subtitle pays the cold start after every settings change.
        for kind, engine in (("stt", stt), ("mt", mt)):
            provider = (
                factory.stt_provider_of(cfg[kind])
                if kind == "stt"
                else factory.provider_of(cfg[kind])
            )
            if provider != "local":
                continue
            try:
                if kind == "stt":
                    engine.ensure_loaded()
                else:
                    engine.load(self.state.models_dir)
            except Exception as exc:  # model_missing etc. - the UI shows it via engine_ready
                log.warning("warmup failed", extra={"fields": {"engine": kind, "error": str(exc)}})
        self._emit(
            {"t": "engine_ready", "engine": "stt", "ok": True, "reason": None, "provider": factory.describe(cfg["stt"])}
        )
        self._emit(
            {"t": "engine_ready", "engine": "mt", "ok": True, "reason": None, "provider": factory.describe(cfg["mt"])}
        )
        self._switching = False
        log.info("engines switched", extra={"fields": {"ms": int((time.monotonic() - started) * 1000)}})

    def _apply_state(self, message: dict) -> None:
        mode = str(message.get("mode") or "translate_on")
        if mode == "translate_off":
            # Stop means stop: drop the backlog and invalidate in-flight windows so no subtitle
            # arrives after the user closed the card.
            self._generation += 1
            self._discard_jobs()
            self.router.reset()
            self._last_segment.clear()
            # Streaming: reset provider and drop partial events
            if self.streaming is not None:
                self.streaming.reset()
                self.streaming_mode = False
                self.streaming = None
        self.router.config.mode = mode
        log.info("state applied", extra={"fields": {"mode": mode}})

    # -- workers --------------------------------------------------------------------------
    def _stream_loop(self) -> None:
        """Re-transcribe the streaming buffers off the event loop."""
        while not self._stream_stop.is_set():
            self._stream_wake.wait(0.2)
            self._stream_wake.clear()
            if not self.streaming_mode or self.streaming is None:
                continue
            for tag in (TAG_YOU, TAG_REMOTE):
                provider = self.streaming
                if provider is None:
                    break
                try:
                    event = provider.poll(tag)
                except Exception as exc:  # pragma: no cover - defensive
                    log.warning("streaming poll failed", extra={"fields": {"tag": tag, "error": str(exc)}})
                    continue
                if event is not None:
                    self._emit_streaming_event(event)
                if provider.fallback_requested:
                    # Let the receive loop do the switch (it owns the router mutex-free state).
                    self._fallback_pending = True
                    self._stream_wake.set()
                    break

    def _enqueue_window(self, window: AudioWindow) -> None:
        """Queue a finished VAD window, dropping the oldest one if the pipeline is behind."""
        self._put_drop_oldest(self.jobs, (self._generation, window))
        log.debug(
            "window queued",
            extra={"fields": {"tag": window.tag, "stt_q": self.jobs.qsize(), "mt_q": self.mt_jobs.qsize()}},
        )

    def _enqueue_text_translation(
        self, chunk_id: str, tag: str, text: str, src_lang: str, started_ms: int, ended_ms: int
    ) -> None:
        self._put_drop_oldest(
            self.text_jobs,
            (self._generation, chunk_id, tag, text, src_lang, started_ms, ended_ms),
        )

    def _text_mt_loop(self) -> None:
        """Translate committed streaming clauses (latency first: beam 1)."""
        while True:
            item = self.text_jobs.get()
            if item is None:
                break
            generation, chunk_id, tag, text, src_lang, started_ms, ended_ms = item
            if generation != self._generation:
                continue
            cfg = self.router.config
            tgt_code = self.router.target_language_code(tag)
            tgt_flores = self.router.target_language(tag)
            src_flores = languages.to_flores(src_lang)
            if not tgt_code or not tgt_flores or not src_flores or src_flores == tgt_flores:
                continue
            engine = self.state.mt
            if hasattr(engine, "beam_size"):
                # The default quality preset (beam 5) is for the batch path; a streaming clause
                # must land on screen as soon as possible.
                engine.beam_size = 1
            started_at = time.monotonic()
            try:
                translate_with_meta = getattr(engine, "translate_with_meta", None)
                if callable(translate_with_meta):
                    translated, quality = translate_with_meta(text, src_flores, tgt_flores)
                else:
                    translated, quality = engine.translate(text, src_flores, tgt_flores), "ok"
            except MtModelMissing:
                self._emit(
                    {"t": "notice", "level": "warn", "code": "model_missing", "message": "nllb model not installed"}
                )
                continue
            except RemoteError as exc:
                self._emit({"t": "notice", "level": "error", "code": "remote_error", "message": str(exc)})
                continue
            except Exception as exc:  # pragma: no cover - defensive
                self._emit(
                    {"t": "notice", "level": "error", "code": "engine_load_failed", "message": f"mt: {exc}"}
                )
                continue
            log.info(
                "translated",
                extra={
                    "fields": {
                        "engine": self._describe("mt"),
                        "ms": int((time.monotonic() - started_at) * 1000),
                        "lines": 1,
                        "pair": f"{src_flores}->{tgt_flores}",
                        "stream": True,
                    }
                },
            )
            if generation != self._generation:
                continue
            self._emit(
                {
                    "t": "translation",
                    "tag": tag,
                    "chunk_id": chunk_id,
                    "src_lang": src_lang,
                    "tgt_lang": tgt_code,
                    "text_src": text,
                    "text_tgt": translated,
                    "quality": quality,
                    "session_id": cfg.session_id,
                }
            )

    def _discard_jobs(self) -> None:
        """Drop every window that is still waiting (used when translate stops)."""
        for jobs in (self.jobs, self.mt_jobs, self.text_jobs):
            while True:
                try:
                    jobs.get_nowait()
                except queue.Empty:
                    break

    def _put_drop_oldest(self, jobs: queue.Queue, item: object) -> None:
        try:
            jobs.put_nowait(item)
            return
        except queue.Full:
            pass

        # A stale subtitle is worse than a missing one: keep the newest audio instead of letting
        # the delay grow while a long video keeps producing windows faster than we can process.
        try:
            jobs.get_nowait()
            self._dropped_windows += 1
            if self._dropped_windows % 10 == 1:
                log.warning(
                    "pipeline behind, dropped a stale window",
                    extra={"fields": {"dropped": self._dropped_windows}},
                )
        except queue.Empty:
            pass
        try:
            jobs.put_nowait(item)
        except queue.Full:
            pass

    def _shutdown_workers(self) -> None:
        self._stream_stop.set()
        self._stream_wake.set()
        for jobs in (self.jobs, self.mt_jobs, self.text_jobs):
            try:
                jobs.put_nowait(None)
            except queue.Full:
                try:
                    jobs.get_nowait()
                except queue.Empty:
                    pass
                try:
                    jobs.put_nowait(None)
                except queue.Full:
                    pass

    def _stt_loop(self) -> None:
        while True:
            item = self.jobs.get()
            if item is None:
                break
            generation, job = item
            if generation != self._generation:
                continue
            try:
                segments = self._transcribe(generation, job)
            except Exception as exc:  # pragma: no cover - defensive
                log.error("stt worker failed", extra={"fields": {"error": str(exc)}})
                self._emit(
                    {"t": "notice", "level": "error", "code": "engine_load_failed", "message": f"stt: {exc}"}
                )
                continue
            if not segments:
                continue
            try:
                self.mt_jobs.put_nowait((generation, job, segments))
            except queue.Full:
                try:
                    self.mt_jobs.get_nowait()
                except queue.Empty:
                    pass
                try:
                    self.mt_jobs.put_nowait((generation, job, segments))
                except queue.Full:
                    pass

    def _mt_loop(self) -> None:
        while True:
            item = self.mt_jobs.get()
            if item is None:
                break
            generation, window, segments = item
            if generation != self._generation:
                continue
            try:
                self._translate_and_emit(generation, window, segments)
            except Exception as exc:  # pragma: no cover - defensive
                log.error("mt worker failed", extra={"fields": {"error": str(exc)}})
                self._emit(
                    {"t": "notice", "level": "error", "code": "engine_load_failed", "message": f"mt: {exc}"}
                )

    # -- pipeline stages ------------------------------------------------------------------
    def _transcribe(self, generation: int, window: AudioWindow) -> list[tuple[str, object]]:
        """Whisper stage: emit every transcript immediately, return the pairs MT still needs.

        Emitting English right after STT means the user sees text before NLLB finishes; the
        translation then fills in on the same card a second later.
        """
        cfg = self.router.config
        source_language = self.router.source_language(window.tag)
        started_at = time.monotonic()

        try:
            result = self.state.stt.transcribe(
                window.samples,
                language=source_language,
                beam_size=int(cfg.beam_size),
                offset_ms=window.started_ms,
            )
        except SttModelMissing:
            self._emit(
                {"t": "notice", "level": "warn", "code": "model_missing", "message": "whisper model not installed"}
            )
            return []
        except RemoteRateLimitError as exc:
            self._emit(
                {
                    "t": "notice",
                    "level": "warn",
                    "code": "rate_limited",
                    "message": f"{exc} - the free tier is busy; the next window will retry",
                }
            )
            return []
        except RemoteError as exc:
            self._emit({"t": "notice", "level": "error", "code": "remote_error", "message": str(exc)})
            return []
        except Exception as exc:
            self._emit(
                {"t": "notice", "level": "error", "code": "engine_load_failed", "message": f"stt: {exc}"}
            )
            return []

        log.info(
            "transcribed",
            extra={
                "fields": {
                    "engine": self._describe("stt"),
                    "ms": int((time.monotonic() - started_at) * 1000),
                    "segments": len(result.segments),
                    "lang": result.language or source_language or "auto",
                    "window_ms": window.ended_ms - window.started_ms,
                }
            },
        )
        if not result.segments:
            return []

        # Whisper cannot be interrupted mid-call, but a window that finished after the user
        # pressed stop must never surface as a late subtitle.
        if generation != self._generation:
            return []

        pairs: list[tuple[str, object]] = []
        for segment in result.segments:
            text = _strip_overlap(
                segment.text, self._last_segment.get(window.tag), segment.started_ms
            )
            if not text.strip():
                continue
            trimmed = replace(segment, text=text)
            self._chunk_counter += 1
            chunk_id = f"c-{self._chunk_counter:03d}"
            lang = trimmed.lang or result.language or "en"
            self._emit(
                {
                    "t": "transcript",
                    "tag": window.tag,
                    "lang": lang,
                    "text": trimmed.text,
                    "conf": round(trimmed.confidence, 3),
                    "started_ms": trimmed.started_ms,
                    "end_ms": trimmed.ended_ms,
                    "session_id": cfg.session_id,
                    "chunk_id": chunk_id,
                }
            )
            pairs.append((chunk_id, trimmed))
            self._last_segment[window.tag] = (trimmed.text, trimmed.ended_ms)
        return pairs

    def _translate_and_emit(
        self, generation: int, window: AudioWindow, pairs: list[tuple[str, object]]
    ) -> None:
        """MT stage: one batched translate call per window, then one event per sentence."""
        cfg = self.router.config
        target_code = self.router.target_language_code(window.tag)
        target_flores = self.router.target_language(window.tag)
        if not target_code or not target_flores:
            return

        pending: list[tuple[str, object, str]] = []
        # A remote LLM can translate without knowing the source language; local NLLB cannot,
        # so an undetected window is skipped only for the local engine.
        remote_mt = getattr(self.state.mt, "name", "") == "remote"
        for chunk_id, segment in pairs:
            lang = getattr(segment, "lang", None)
            src_flores = languages.to_flores(lang) if lang else None
            if src_flores == target_flores:
                continue
            if not src_flores:
                if not remote_mt:
                    continue
                src_flores = languages.AUTO
            pending.append((chunk_id, segment, src_flores))
        if not pending:
            return

        # A window may hold segments in more than one detected language; group per source.
        by_source: dict[str, list[tuple[str, object]]] = {}
        for chunk_id, segment, src_flores in pending:
            by_source.setdefault(src_flores, []).append((chunk_id, segment))

        translate_many = getattr(self.state.mt, "translate_many", None)
        beam = int(getattr(cfg, "beam_size", 2) or 2)
        if hasattr(self.state.mt, "beam_size"):
            # NLLB follows the same quality preset as Whisper (5 = best, 1 = fastest).
            self.state.mt.beam_size = beam
        for src_flores, items in by_source.items():
            texts = [getattr(segment, "text", "") for _, segment in items]
            started_at = time.monotonic()
            try:
                if callable(translate_many):
                    outputs = translate_many(texts, src_flores, target_flores)
                else:  # engines that only implement the single-sentence API
                    outputs = [
                        self.state.mt.translate_with_meta(text, src_flores, target_flores) for text in texts
                    ]
            except MtModelMissing:
                self._emit(
                    {"t": "notice", "level": "warn", "code": "model_missing", "message": "nllb model not installed"}
                )
                return
            except RemoteRateLimitError as exc:
                self._emit(
                    {
                        "t": "notice",
                        "level": "warn",
                        "code": "rate_limited",
                        "message": f"{exc} - the free tier is busy; retrying the next window",
                    }
                )
                return
            except RemoteError as exc:
                self._emit({"t": "notice", "level": "error", "code": "remote_error", "message": str(exc)})
                return
            except Exception as exc:
                self._emit(
                    {"t": "notice", "level": "error", "code": "engine_load_failed", "message": f"mt: {exc}"}
                )
                return

            log.info(
                "translated",
                extra={
                    "fields": {
                        "engine": self._describe("mt"),
                        "ms": int((time.monotonic() - started_at) * 1000),
                        "lines": len(texts),
                        "pair": f"{src_flores}->{target_flores}",
                    }
                },
            )
            if generation != self._generation:
                return

            for (chunk_id, segment), (translated, quality) in zip(items, outputs):
                self._emit(
                    {
                        "t": "translation",
                        "tag": window.tag,
                        "chunk_id": chunk_id,
                        "src_lang": getattr(segment, "lang", None)
                        or ("auto" if src_flores == languages.AUTO else "en"),
                        "tgt_lang": target_code,
                        "text_src": getattr(segment, "text", ""),
                        "text_tgt": translated,
                        "quality": quality,
                        "session_id": cfg.session_id,
                    }
                )
