"""Qwen3-TTS voice-clone worker (runs in the isolated `.venv-tts`).

The main sidecar venv keeps transformers 4.x for NLLB; mlx-audio needs transformers 5.x, so
the clone engine lives in its own venv and talks to this worker over stdin/stdout JSON lines.

Protocol (one JSON object per line):
  -> {"cmd":"ping"}
  <- {"ok":true}
  -> {"text":"...", "ref_audio":"/abs/sample.wav", "ref_text":"...", "out":"/abs/out.wav"}
  <- {"ok":true,"path":"...","sample_rate":24000,"duration_ms":1234}
  <- {"ok":false,"error":"..."}

mlx-audio prints progress to stdout while loading, which would corrupt the protocol: every
library write is redirected to stderr and only the JSON replies use the real stdout.
"""

from __future__ import annotations

import contextlib
import json
import sys
import time

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16"

_REAL_STDOUT = sys.stdout


def _respond(payload: dict) -> None:
    _REAL_STDOUT.write(json.dumps(payload) + "\n")
    _REAL_STDOUT.flush()


def main() -> None:
    model = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _respond({"ok": False, "error": f"bad json: {exc}"})
            continue

        if request.get("cmd") == "ping":
            _respond({"ok": True})
            continue

        try:
            # Model load and generation both log to stdout; keep the channel clean.
            with contextlib.redirect_stdout(sys.stderr):
                if model is None:
                    from mlx_audio.tts.utils import load_model

                    model = load_model(MODEL_ID)

                import numpy as np
                import soundfile as sf

                started = time.time()
                results = list(
                    model.generate(
                        text=str(request["text"]),
                        ref_audio=str(request["ref_audio"]),
                        ref_text=str(request["ref_text"]),
                        stream=False,
                    )
                )
                if not results:
                    raise RuntimeError("no audio generated")
                chunks = [
                    np.asarray(result.audio, dtype=np.float32).reshape(-1) for result in results
                ]
                audio = np.concatenate(chunks)
                sample_rate = int(results[0].sample_rate)
                out = str(request["out"])
                sf.write(out, audio, sample_rate)
            _respond(
                {
                    "ok": True,
                    "path": out,
                    "sample_rate": sample_rate,
                    "duration_ms": int(len(audio) / sample_rate * 1000),
                    "elapsed_ms": int((time.time() - started) * 1000),
                }
            )
        except Exception as exc:  # pragma: no cover - worker boundary
            _respond({"ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
