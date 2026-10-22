#!/usr/bin/env python3
"""Generate the test audio fixtures for the sidecar (13-dev-env §6).

The speech fixtures are synthesized locally with the macOS `say` voices (no third-party
licence, no network). The silence fixture is pure digital silence.

    .venv/bin/python scripts/make_test_fixtures.py [--force]

Files:
    sidecar/tests/fixtures/en_meeting_30s.wav   English meeting, ~30 s, contains "meeting"/"schedule"
    sidecar/tests/fixtures/id_meeting_20s.wav   Indonesian meeting, ~20 s
    sidecar/tests/fixtures/silence_5s.wav        5 s of silence (hallucination fixture)
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sidecar import config  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "sidecar" / "tests" / "fixtures"

EN_TEXT = (
    "Hi everyone, thanks for joining the weekly project meeting. "
    "I want to start with a quick update on the new translation model. "
    "The release runs about twenty percent faster on the laptop, and the transcript quality "
    "on English meetings looks noticeably better. "
    "One thing we still need to fix is language detection when a speaker switches mid sentence. "
    "I suggest we schedule a separate session for that next Tuesday, to compare the results. "
    "If the schedule works for everyone, please reply in the channel. "
    "I will share the benchmark numbers later. Thanks everyone."
)

ID_TEXT = (
    "Halo everyone, terima kasih sudah bergabung dalam rapat pagi ini. "
    "Kita akan membahas jadwal rilis fitur baru dan progress integrasi model terjemahan. "
    "Tolong konfirmasi kalau agenda Anda sudah sesuai. "
    "Jika ada kendala, silakan tulis di channel sebelum jam sepuluh. "
    "Terima kasih, sampai jumpa di rapat berikutnya."
)


def say_to_wav(text: str, voice: str, target: Path) -> None:
    if not shutil.which("say"):
        raise SystemExit("macOS `say` is required to synthesize the speech fixtures")
    tmp = target.with_suffix(".raw.wav")
    subprocess.run(
        ["say", "-v", voice, "-o", str(tmp), "--data-format=LEI16@16000", text],
        check=True,
    )
    tmp.replace(target)


def write_silence(target: Path, seconds: float) -> None:
    samples = np.zeros(int(config.SAMPLE_RATE * seconds), dtype=np.float32)
    sf.write(str(target), samples, config.SAMPLE_RATE, subtype="PCM_16")


def duration(path: Path) -> float:
    info = sf.info(str(path))
    return float(info.duration)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate sidecar test fixtures.")
    parser.add_argument("--force", action="store_true", help="overwrite existing fixtures")
    args = parser.parse_args()

    FIXTURES.mkdir(parents=True, exist_ok=True)

    silence = FIXTURES / "silence_5s.wav"
    if args.force or not silence.exists():
        write_silence(silence, 5.0)
        print(f"[fixtures] silence_5s.wav {duration(silence):.1f}s")

    for name, text, voice in (
        ("en_meeting_30s.wav", EN_TEXT, "Samantha"),
        ("id_meeting_20s.wav", ID_TEXT, "Damayanti"),
    ):
        target = FIXTURES / name
        if args.force or not target.exists():
            say_to_wav(text, voice, target)
            print(f"[fixtures] {name} {duration(target):.1f}s")
        else:
            print(f"[fixtures] {name} exists ({duration(target):.1f}s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
