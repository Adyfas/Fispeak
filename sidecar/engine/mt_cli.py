#!/usr/bin/env python3
"""MT smoke tool (13-dev-env §3).

    python sidecar/engine/mt_cli.py --text "Kapan kita rapat besok?" --src ind_Latn --tgt eng_Latn
    python sidecar/engine/mt_cli.py --text "..." --src id --tgt en --json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sidecar.engine import languages  # noqa: E402
from sidecar.engine.mt import get_engine  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Translate a sentence with the local NLLB model.")
    parser.add_argument("--text", required=True, help="text to translate")
    parser.add_argument("--src", required=True, help="source language (FLORES or ISO-639-1 code)")
    parser.add_argument("--tgt", required=True, help="target language (FLORES or ISO-639-1 code)")
    parser.add_argument("--beam-size", type=int, default=2)
    parser.add_argument("--models-dir", default=None, help="override the models directory")
    parser.add_argument("--json", action="store_true", help="print the raw result as JSON")
    args = parser.parse_args(argv)

    src = languages.to_flores(args.src)
    tgt = languages.to_flores(args.tgt)
    if not src or not tgt:
        print(f"unsupported language pair: {args.src!r} -> {args.tgt!r}", file=sys.stderr)
        return 2

    engine = get_engine("nllb", Path(args.models_dir) if args.models_dir else None)
    engine.beam_size = args.beam_size  # dev override for the "high accuracy" setting

    load_started = time.monotonic()
    engine.load()
    load_elapsed = time.monotonic() - load_started

    started = time.monotonic()
    translated, quality = engine.translate_with_meta(args.text, src, tgt)
    elapsed = time.monotonic() - started

    payload = {
        "source": args.text,
        "src": src,
        "tgt": tgt,
        "translated": translated,
        "quality": quality,
        "elapsed_s": round(elapsed, 3),
        "load_s": round(load_elapsed, 3),
        "cache": engine.cache_stats,
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(
            f"{payload['src']} -> {payload['tgt']} "
            f"({payload['elapsed_s']}s translate, {payload['load_s']}s model load, {payload['quality']})"
        )
        print(payload["translated"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
