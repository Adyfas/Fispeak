#!/usr/bin/env python3
"""STT smoke tool (13-dev-env §3).

    python sidecar/engine/stt_cli.py --file sidecar/tests/fixtures/en_meeting_30s.wav
    python sidecar/engine/stt_cli.py --file ... --lang en --json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sidecar.engine.stt import SttEngine  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Transcribe a 16 kHz mono wav file with faster-whisper.")
    parser.add_argument("--file", required=True, help="path to a 16 kHz mono wav file")
    parser.add_argument("--lang", default=None, help="force a language (default: auto detect)")
    parser.add_argument("--beam-size", type=int, default=2)
    parser.add_argument("--models-dir", default=None, help="override the models directory")
    parser.add_argument("--json", action="store_true", help="print the raw result as JSON")
    args = parser.parse_args(argv)

    import soundfile as sf

    path = Path(args.file)
    if not path.exists():
        print(f"file not found: {path}", file=sys.stderr)
        return 2

    audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    engine = SttEngine(Path(args.models_dir) if args.models_dir else None)
    started = time.monotonic()
    result = engine.transcribe(audio, language=args.lang, beam_size=args.beam_size)
    elapsed = time.monotonic() - started

    payload = {
        "file": str(path),
        "sample_rate": sample_rate,
        "duration_s": round(len(audio) / sample_rate, 2),
        "elapsed_s": round(elapsed, 2),
        "language": result.language,
        "language_probability": round(result.language_probability, 3),
        "segments": [
            {
                "text": segment.text,
                "lang": segment.lang,
                "conf": round(segment.confidence, 3),
                "started_ms": segment.started_ms,
                "ended_ms": segment.ended_ms,
            }
            for segment in result.segments
        ],
        "text": result.text,
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"lang={payload['language']} ({payload['language_probability']}) in {payload['elapsed_s']}s")
        for segment in payload["segments"]:
            print(f"  [{segment['started_ms']:>6}-{segment['ended_ms']:>6} ms] {segment['text']}")
        print()
        print(payload["text"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
