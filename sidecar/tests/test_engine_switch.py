"""Switching the pipeline to a remote engine over the WS `config` frame.

Uses a fake OpenAI-compatible provider so the test never needs an API key or network, while
still going through the real path: config frame -> `_apply_engine` -> factory -> MT engine.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import ThreadingHTTPServer

import numpy as np
import pytest

from sidecar import config
from sidecar.server.app import create_app
from sidecar.server.state import SidecarState
from sidecar.tests.test_remote_engine import FakeProvider


@pytest.fixture(scope="module")
def provider_url():
    FakeProvider.mode = "numbered"
    FakeProvider.chat_requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeProvider)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture(scope="module")
def ws_url(stt_engine, mt_engine):
    import uvicorn

    state = SidecarState(port=0)
    state.stt = stt_engine
    state.mt = mt_engine
    app = create_app(state)
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=config.HOST,
            port=0,
            log_config=None,
            access_log=False,
            lifespan="on",
            ws_ping_interval=None,
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 30
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started
    port = int(server.servers[0].sockets[0].getsockname()[1])
    try:
        yield f"ws://{config.HOST}:{port}/ws"
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def _frames(audio: np.ndarray, size: int = config.FRAME_SAMPLES) -> list[bytes]:
    frames = []
    for start in range(0, audio.size, size):
        chunk = audio[start : start + size]
        if chunk.size < size:
            chunk = np.pad(chunk, (0, size - chunk.size))
        frames.append(chunk.astype("<f4").tobytes())
    return frames


def test_remote_translation_engine_is_used_after_switch(ws_url, provider_url, en_meeting_wav, wav_loader):
    from websockets.sync.client import connect

    audio = wav_loader(en_meeting_wav)[: 10 * config.SAMPLE_RATE]
    silence = np.zeros(4 * config.SAMPLE_RATE, dtype=np.float32)
    payload = np.concatenate([audio, silence])

    translation = None
    providers: dict[str, str] = {}
    notices: list[str] = []

    with connect(ws_url, open_timeout=10, max_size=None) as ws:
        ws.send(json.dumps({"t": "hello", "proto": 1, "client": "electron"}))
        ws.send(
            json.dumps(
                {
                    "t": "config",
                    "my_lang": "id",
                    "remote_lang": "auto",
                    "session_id": "switch-session",
                    "tts_enabled": False,
                    "beam_size": 1,
                    "whisper_model": "small",
                    "engine": {
                        "stt": {"provider": "local"},
                        "mt": {"provider": "custom", "baseUrl": provider_url, "model": "test-model"},
                    },
                }
            )
        )

        # Wait for the engine swap to land before feeding audio, otherwise the window would be
        # translated by NLLB while the switch thread is still building the remote engine.
        deadline = time.time() + 20
        while time.time() < deadline and providers.get("mt") != "custom:test-model":
            event = json.loads(ws.recv(timeout=max(1.0, deadline - time.time())))
            if event["t"] == "engine_ready":
                providers[event["engine"]] = event.get("provider") or ""
            elif event["t"] == "notice":
                notices.append(event.get("message", ""))

        assert providers.get("mt") == "custom:test-model", providers

        for frame in _frames(payload):
            ws.send(bytes([0x02]) + frame)

        deadline = time.time() + 240
        while time.time() < deadline and translation is None:
            event = json.loads(ws.recv(timeout=max(1.0, deadline - time.time())))
            if event["t"] == "translation":
                translation = event
            elif event["t"] == "notice" and event.get("level") == "error":
                notices.append(event.get("message", ""))

    assert not notices, notices
    assert translation is not None, "no translation event was emitted"
    # The fake provider prefixes every line, so this proves the remote engine produced the text.
    assert translation["text_tgt"].startswith("[id] "), translation["text_tgt"]
    assert FakeProvider.chat_requests, "the remote engine was never called"
