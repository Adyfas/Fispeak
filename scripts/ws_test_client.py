#!/usr/bin/env python3
"""Manual WebSocket client for the sidecar (09-sidecar-spec, 11-roadmap acceptance).

    python scripts/ws_test_client.py --file sidecar/tests/fixtures/en_meeting_30s.wav
    python scripts/ws_test_client.py --file ... --tag you --my-lang id --remote-lang en

Sends the wav as 200 ms tagged frames and prints every event the sidecar emits.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sidecar import config  # noqa: E402

TAG_BYTES = {"you": 0x01, "remote": 0x02}


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    import soundfile as sf

    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return np.asarray(audio, dtype=np.float32), sample_rate


def split_frames(audio: np.ndarray) -> list[bytes]:
    size = config.FRAME_SAMPLES
    frames = []
    for start in range(0, len(audio), size):
        chunk = audio[start : start + size]
        if chunk.size < size:
            chunk = np.pad(chunk, (0, size - chunk.size))
        frames.append(chunk.astype("<f4").tobytes())
    return frames


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Send audio to the fispeak sidecar over WebSocket.")
    parser.add_argument("--url", default="ws://127.0.0.1:8765/ws")
    parser.add_argument("--file", required=True, help="16 kHz mono wav file")
    parser.add_argument("--tag", choices=sorted(TAG_BYTES), default="remote")
    parser.add_argument("--my-lang", default="id")
    parser.add_argument("--remote-lang", default="auto")
    parser.add_argument("--session-id", default="dev-session")
    parser.add_argument("--limit-seconds", type=float, default=None, help="only send the first N seconds")
    parser.add_argument(
        "--silence-seconds",
        type=float,
        default=4.0,
        help="append this much silence so the VAD closes the window and the transcript is emitted",
    )
    parser.add_argument("--timeout", type=float, default=120.0, help="seconds to wait for events")
    args = parser.parse_args(argv)

    from websockets.sync.client import connect

    audio, sample_rate = read_wav(Path(args.file))
    if sample_rate != config.SAMPLE_RATE:
        print(f"warning: wav is {sample_rate} Hz, expected {config.SAMPLE_RATE} Hz", file=sys.stderr)
    if args.limit_seconds:
        audio = audio[: int(args.limit_seconds * sample_rate)]
    if args.silence_seconds > 0:
        audio = np.concatenate([audio, np.zeros(int(args.silence_seconds * sample_rate), dtype=np.float32)])

    frames = split_frames(audio)
    tag_byte = TAG_BYTES[args.tag]
    print(f"[ws] {args.url} sending {len(frames)} frames ({len(frames) * 200 / 1000:.1f}s) tag={args.tag}")

    started = time.monotonic()
    with connect(args.url, open_timeout=10, max_size=None) as socket:
        socket.send(json.dumps({"t": "hello", "proto": 1, "client": "electron"}))
        socket.send(
            json.dumps(
                {
                    "t": "config",
                    "my_lang": args.my_lang,
                    "remote_lang": args.remote_lang,
                    "session_id": args.session_id,
                    "tts_enabled": False,
                    "beam_size": 2,
                    "whisper_model": "small",
                }
            )
        )
        for frame in frames:
            socket.send(bytes([tag_byte]) + frame)
        print("[ws] frames sent, waiting for events...")

        deadline = started + args.timeout
        while time.monotonic() < deadline:
            try:
                raw = socket.recv(timeout=max(0.5, deadline - time.monotonic()))
            except TimeoutError:
                print("[ws] timeout waiting for events")
                break
            if isinstance(raw, bytes):
                print(f"[ws] binary frame {len(raw)} bytes")
                continue
            event = json.loads(raw)
            kind = event.get("t")
            if kind == "transcript":
                print(f"[{event.get('tag')}] {event.get('lang')}: {event.get('text')}")
            elif kind == "translation":
                print(f"[{event.get('tag')}] {event.get('src_lang')}->{event.get('tgt_lang')}: {event.get('text_tgt')}")
            elif kind == "audio_level":
                continue
            else:
                print(f"[ws] {json.dumps(event, ensure_ascii=False)}")
            if kind == "translation" and event.get("tag") == args.tag:
                break
    print(f"[ws] done in {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
