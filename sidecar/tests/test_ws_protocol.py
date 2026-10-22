"""WebSocket protocol round trip (09-sidecar-spec §3, 11-roadmap acceptance)."""

from __future__ import annotations

import json
import threading
import time

import numpy as np
import pytest

from sidecar import config
from sidecar.server.app import create_app
from sidecar.server.state import SidecarState


@pytest.fixture(scope="module")
def ws_url(stt_engine, mt_engine):
    import uvicorn

    state = SidecarState(port=0)
    state.stt = stt_engine
    state.mt = mt_engine
    app = create_app(state)

    # port 0 lets the OS pick a free port - no bind/close race with other test runs
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
    assert server.started, "the sidecar server did not start"

    port = int(server.servers[0].sockets[0].getsockname()[1])
    yield f"ws://{config.HOST}:{port}/ws"

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


def test_handshake_and_engine_status(ws_url) -> None:
    from websockets.sync.client import connect

    with connect(ws_url, open_timeout=10) as ws:
        ws.send(json.dumps({"t": "hello", "proto": 1, "client": "electron"}))
        events = []
        for _ in range(4):
            events.append(json.loads(ws.recv(timeout=10)))

    kinds = [event["t"] for event in events]
    assert "hello_ack" in kinds
    assert "engine_ready" in kinds
    hello = next(event for event in events if event["t"] == "hello_ack")
    assert hello["version"] == config.VERSION
    engines = {event["engine"]: event for event in events if event["t"] == "engine_ready"}
    assert engines["stt"]["ok"] is True
    assert engines["mt"]["ok"] is True


def test_ping_is_answered_with_pong(ws_url) -> None:
    from websockets.sync.client import connect

    with connect(ws_url, open_timeout=10) as ws:
        ws.send(json.dumps({"t": "ping"}))
        deadline = time.time() + 10
        while time.time() < deadline:
            event = json.loads(ws.recv(timeout=10))
            if event["t"] == "pong":
                break
        else:
            pytest.fail("no pong received")


def test_audio_produces_transcript_and_translation(ws_url, en_meeting_wav, wav_loader) -> None:
    from websockets.sync.client import connect

    audio = wav_loader(en_meeting_wav)[: 10 * config.SAMPLE_RATE]
    silence = np.zeros(4 * config.SAMPLE_RATE, dtype=np.float32)
    payload = np.concatenate([audio, silence])

    transcript = None
    translation = None
    with connect(ws_url, open_timeout=10, max_size=None) as ws:
        ws.send(
            json.dumps(
                {
                    "t": "config",
                    "my_lang": "id",
                    "remote_lang": "auto",
                    "session_id": "test-session",
                    "tts_enabled": False,
                    "beam_size": 2,
                    "whisper_model": "small",
                }
            )
        )
        for frame in _frames(payload):
            ws.send(bytes([0x02]) + frame)

        deadline = time.time() + 120
        while time.time() < deadline and (transcript is None or translation is None):
            remaining = max(1.0, deadline - time.time())
            event = json.loads(ws.recv(timeout=remaining))
            if event["t"] == "transcript" and transcript is None:
                transcript = event
            elif event["t"] == "translation" and translation is None:
                translation = event

    assert transcript is not None, "no transcript event was emitted"
    assert transcript["tag"] == "remote"
    assert transcript["session_id"] == "test-session"
    assert transcript["chunk_id"].startswith("c-")
    lowered = transcript["text"].lower()
    assert "meeting" in lowered or "schedule" in lowered, transcript["text"]

    assert translation is not None, "no translation event was emitted"
    assert translation["tgt_lang"] == "id"
    assert translation["text_src"] == transcript["text"]
    assert translation["text_tgt"]
