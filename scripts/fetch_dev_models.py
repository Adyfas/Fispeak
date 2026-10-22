#!/usr/bin/env python3
"""Dev-only model fetcher (13-dev-env §5).

Downloads the two Phase 2 models into the Electron `userData/models` tree so the sidecar can
lazy-load them without the (Phase 3) ModelManager UI:

    .venv/bin/python scripts/fetch_dev_models.py
    .venv/bin/python scripts/fetch_dev_models.py --models-dir /tmp/fispeak-models
    .venv/bin/python scripts/fetch_dev_models.py --force

File lists come from the verified CORRECTION sections in 06-stt-engine.md and
07-translation-engine.md (HF API, 2026-10-22). Production downloads belong to the Electron
ModelManager; this script exists only to make the sidecar testable on a dev machine.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sidecar import config  # noqa: E402

MODELS = (
    {
        "dir": config.STT_MODEL_DIR,
        "repo": "Systran/faster-whisper-small",
        "files": config.STT_MODEL_FILES,
        "min_bytes": {config.STT_MODEL_DIR: 100_000_000},
    },
    {
        "dir": config.MT_MODEL_DIR,
        "repo": "Code-Dev/nllb-200-distilled-600M-ct2-int8",
        "files": config.MT_MODEL_FILES,
        "min_bytes": {config.MT_MODEL_DIR: 200_000_000},
    },
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(model: dict, root: Path, force: bool) -> None:
    target = root / model["dir"]
    target.mkdir(parents=True, exist_ok=True)
    print(f"[fetch] {model['repo']} -> {target}")
    for name in model["files"]:
        file_path = target / name
        if file_path.exists() and not force:
            print(f"  = {name} ({file_path.stat().st_size:,} bytes)")
            continue
        hf_hub_download(
            repo_id=model["repo"],
            filename=name,
            local_dir=str(target),
        )
        print(f"  + {name} ({file_path.stat().st_size:,} bytes)")

    model_bin = target / "model.bin"
    minimum = model["min_bytes"][model["dir"]]
    if not model_bin.exists() or model_bin.stat().st_size < minimum:
        raise SystemExit(f"[fetch] model.bin looks truncated in {target} (expected >= {minimum:,} bytes)")


def write_manifest(root: Path) -> Path:
    manifest = {"models": {}}
    for model in MODELS:
        target = root / model["dir"]
        manifest["models"][model["dir"]] = {
            name: {"size": (target / name).stat().st_size, "sha256": sha256(target / name)}
            for name in model["files"]
            if (target / name).exists()
        }
    path = root / "dev-manifest.json"
    path.write_text(json.dumps(manifest, indent=2))
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Download the Phase 2 STT/MT models for local dev.")
    parser.add_argument("--models-dir", default=str(config.models_dir()), help="target models directory")
    parser.add_argument("--force", action="store_true", help="re-download files that already exist")
    args = parser.parse_args()

    root = Path(args.models_dir).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    for model in MODELS:
        fetch(model, root, args.force)
    manifest = write_manifest(root)
    print(f"[fetch] done. models={root} manifest={manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
