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
import threading
import time

from fastapi import WebSocket

from sidecar import config
from sidecar.engine import languages
from sidecar.engine.audio_router import TAG_REMOTE, TAG_YOU, AudioRouter
from sidecar.engine.mt import ModelMissingError as MtModelMissing
from sidecar.engine.stt import ModelMissingError as SttModelMissing
from sidecar.engine.vad import AudioWindow, frame_from_bytes, rms_of
from sidecar.server.state import SidecarState

log = logging.getLogger("ws")

AUDIO_LEVEL_INTERVAL = 0.2  # 5 events per second per tag (09-sidecar-spec §3.2)


class WsSession:
    """One Electron connection: receive loop, worker thread and an outgoing event queue."""

    def __init__(self, websocket: WebSocket, state: SidecarState) -> None:
        self.websocket = websocket
        self.state = state
        self.loop = asyncio.get_running_loop()
        self.out: asyncio.Queue[object] = asyncio.Queue()
        self.jobs: queue.Queue[AudioWindow | None] = queue.Queue()
        self.router = AudioRouter(state.stream)
        self._chunk_counter = 0
        self._last_level: dict[str, float] = {TAG_YOU: 0.0, TAG_REMOTE: 0.0}
        self._worker = threading.Thread(target=self._worker_loop, name="stt-worker", daemon=True)

    # -- lifecycle -------------------------------------------------------------------------
    async def run(self) -> None:
        self._worker.start()
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
            self.jobs.put(None)
            sender.cancel()
            try:
                await sender
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

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
        """Thread-safe emit (the STT worker thread calls this)."""
        self.loop.call_soon_threadsafe(self.out.put_nowait, payload)

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

        samples = frame_from_bytes(data[1:])
        now = time.monotonic()
        if now - self._last_level.get(tag, 0.0) >= AUDIO_LEVEL_INTERVAL:
            self._last_level[tag] = now
            self._emit({"t": "audio_level", "tag": tag, "rms": round(rms_of(samples), 4)})

        for window in self.router.push(tag, samples):
            self.jobs.put(window)

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
        elif kind == "config":
            self._apply_config(message)
        elif kind == "state":
            self._apply_state(message)
        else:
            self._emit(
                {
                    "t": "notice",
                    "level": "warn",
                    "code": "unknown_frame",
                    "message": f"unknown control frame: {kind!r}",
                }
            )

    def _apply_config(self, message: dict) -> None:
        cfg = self.router.config
        for key in ("my_lang", "remote_lang", "tts_enabled", "tts_voice", "beam_size", "whisper_model"):
            if key in message:
                setattr(cfg, key, message[key])
        if "session_id" in message:
            cfg.session_id = message["session_id"]
        log.info("config applied", extra={"fields": cfg.to_dict()})

    def _apply_state(self, message: dict) -> None:
        mode = str(message.get("mode") or "translate_on")
        if mode == "translate_off":
            for window in self.router.flush():
                self.jobs.put(window)
            self.router.reset()
        self.router.config.mode = mode
        log.info("state applied", extra={"fields": {"mode": mode}})

    # -- worker ---------------------------------------------------------------------------
    def _worker_loop(self) -> None:
        while True:
            job = self.jobs.get()
            if job is None:
                break
            try:
                self._process(job)
            except Exception as exc:  # pragma: no cover - defensive
                log.error("worker failed", extra={"fields": {"error": str(exc)}})
                self._emit(
                    {"t": "notice", "level": "error", "code": "engine_load_failed", "message": str(exc)}
                )

    def _process(self, window: AudioWindow) -> None:
        cfg = self.router.config
        source_language = self.router.source_language(window.tag)

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
            return
        except Exception as exc:
            self._emit(
                {"t": "notice", "level": "error", "code": "engine_load_failed", "message": f"stt: {exc}"}
            )
            return

        if not result.segments:
            return

        target_code = self.router.target_language_code(window.tag)
        target_flores = self.router.target_language(window.tag)

        for segment in result.segments:
            self._chunk_counter += 1
            chunk_id = f"c-{self._chunk_counter:03d}"
            lang = segment.lang or result.language or "en"
            self._emit(
                {
                    "t": "transcript",
                    "tag": window.tag,
                    "lang": lang,
                    "text": segment.text,
                    "conf": round(segment.confidence, 3),
                    "started_ms": segment.started_ms,
                    "end_ms": segment.ended_ms,
                    "session_id": cfg.session_id,
                    "chunk_id": chunk_id,
                }
            )

            if not target_code or not target_flores:
                continue
            src_flores = languages.to_flores(lang)
            if not src_flores or src_flores == target_flores:
                continue
            try:
                translated, quality = self.state.mt.translate_with_meta(segment.text, src_flores, target_flores)
            except MtModelMissing:
                self._emit(
                    {"t": "notice", "level": "warn", "code": "model_missing", "message": "nllb model not installed"}
                )
                return
            except Exception as exc:
                self._emit(
                    {"t": "notice", "level": "error", "code": "engine_load_failed", "message": f"mt: {exc}"}
                )
                return
            self._emit(
                {
                    "t": "translation",
                    "tag": window.tag,
                    "chunk_id": chunk_id,
                    "src_lang": lang,
                    "tgt_lang": target_code,
                    "text_src": segment.text,
                    "text_tgt": translated,
                    "quality": quality,
                }
            )
