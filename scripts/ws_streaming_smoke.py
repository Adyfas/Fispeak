#!/usr/bin/env python3
"""Streaming + SPEAK smoke test against a real sidecar (M3.5 / P3-2).

Runs the sidecar on a scratch data dir (so it does not touch the app's lock/port files),
streams a 16 kHz fixture as `remote` audio in real time with `stt_mode=auto`, then asks for
an id->en translation of typed text (the SPEAK `Putar` path) and prints what happened.

Usage:
  .venv/bin/python scripts/ws_streaming_smoke.py
  .venv/bin/python scripts/ws_streaming_smoke.py --fixture sidecar/tests/fixtures/en_meeting_30s.wav --seconds 12
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf
import websockets

REPO = Path(__file__).resolve().parent.parent
DEFAULT_MODELS = Path.home() / "Library/Application Support/fispeak/models"


async def run(args: argparse.Namespace) -> int:
    data = Path(args.data_dir)
    data.mkdir(parents=True, exist_ok=True)
    for name in ("sidecar.port", "sidecar.lock"):
        (data / name).unlink(missing_ok=True)
    env = {**os.environ, "FISPEAK_DATA_DIR": str(data), "FISPEAK_MODELS_DIR": str(Path(args.models))}

    proc = subprocess.Popen(
        [str(REPO / ".venv/bin/python"), "sidecar/main.py"],
        cwd=REPO,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    port = None
    for _ in range(150):
        port_file = data / "sidecar.port"
        if port_file.exists() and port_file.read_text().strip():
            port = int(port_file.read_text().strip())
            break
        await asyncio.sleep(0.2)
    if not port:
        print("FAIL: sidecar did not publish a port")
        proc.kill()
        return 1
    print(f"sidecar port={port}")

    audio, rate = sf.read(str(REPO / args.fixture), dtype="float32")
    if rate != 16_000:
        print(f"FAIL: expected 16 kHz fixture, got {rate}")
        proc.kill()
        return 1
    audio = audio[: 16_000 * args.seconds]
    frames = [audio[i : i + 3200] for i in range(0, len(audio), 3200)]

    events: list[tuple[float, dict]] = []
    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}/ws", max_size=2**24) as ws:
            for _ in range(4):
                try:
                    await asyncio.wait_for(ws.recv(), 3)
                except Exception:
                    break
            await ws.send(
                json.dumps(
                    {
                        "t": "config",
                        "stt_mode": "auto",
                        "my_lang": "id",
                        "remote_lang": "en",
                        "session_id": "smoke",
                        "beam_size": 1,
                        "vad_max_window_ms": 6000,
                        "vad_silence_ms": 900,
                        "vad_min_speech_ms": 1000,
                    }
                )
            )
            await ws.send(json.dumps({"t": "warmup"}))
            started = time.monotonic()

            async def reader() -> None:
                while True:
                    raw = await ws.recv()
                    if isinstance(raw, str):
                        events.append((time.monotonic() - started, json.loads(raw)))

            task = asyncio.create_task(reader())
            for frame in frames:
                await ws.send(bytes([0x02]) + frame.astype("<f4").tobytes())
                await asyncio.sleep(0.2)
            await asyncio.sleep(4.0)
            await ws.send(
                json.dumps(
                    {
                        "t": "translate_text",
                        "request_id": "r1",
                        "text": "Minggu depan kalau boleh",
                        "src": "id",
                        "tgt": "en",
                    }
                )
            )
            await asyncio.sleep(5.0)
            task.cancel()
    finally:
        try:
            httpx.post(f"http://127.0.0.1:{port}/shutdown", timeout=5)
        except Exception:
            pass
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()

    counts = Counter(event.get("t") for _, event in events)
    partials = [(t, event) for t, event in events if event.get("t") == "partial"]
    finals = [(t, event) for t, event in events if event.get("t") == "transcript"]
    translations = {event.get("chunk_id"): (t, event) for t, event in events if event.get("t") == "translation"}
    translated = [event for _, event in events if event.get("t") == "translated_text"]
    print("event counts:", dict(counts))
    if partials:
        print(f"first partial at {partials[0][0]:.2f}s: {partials[0][1]['text']!r}")
        print(f"last  partial at {partials[-1][0]:.2f}s: {partials[-1][1]['text']!r}")
    for timestamp, event in finals[:5]:
        pair = translations.get(event["chunk_id"])
        if pair is not None:
            mt_ms = (pair[0] - timestamp) * 1000
            print(
                f"final {timestamp:.2f}s -> translation +{mt_ms:.0f}ms "
                f"[{event['tag']}]: {pair[1]['text_tgt']!r}"
            )
        else:
            print(f"final {timestamp:.2f}s [{event['tag']}]: {event['text']!r} (no translation!)")
    if translated:
        print(f"translated_text: {translated[-1]['text_src']!r} -> {translated[-1]['text_tgt']!r}")
    ok = bool(partials) and bool(finals) and bool(translated) and bool(translations)
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", default="sidecar/tests/fixtures/en_meeting_30s.wav")
    parser.add_argument("--seconds", type=int, default=12)
    parser.add_argument("--models", default=str(DEFAULT_MODELS))
    parser.add_argument(
        "--data-dir",
        default="/tmp/fispeak-smoke",
        help="scratch data dir (port/lock/logs); models are read from --models",
    )
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
