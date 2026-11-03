"""Local TTS engine (Kokoro-82M ONNX, CPU int8).

The sidecar owns synthesis; Electron only plays the resulting WAV. This keeps the heavy
model out of the renderer and makes it swappable for a clone engine later.

Model files live in `userData/models/kokoro-onnx/`:
  kokoro-v1.0.int8.onnx
  voices-v1.0.bin
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from pathlib import Path

from sidecar import config


class TtsModelMissingError(RuntimeError):
    """The Kokoro files are not installed in the models folder."""


class TtsUnsupportedLanguageError(RuntimeError):
    """Kokoro has no voice for the requested target language."""


# Kokoro language tags differ from Whisper/FLORES codes.
LANG_TAGS = {
    "en": "en-us",
    "es": "es",
    "fr": "fr-fr",
    "it": "it",
    "pt": "pt-br",
    "hi": "hi",
    "ja": "ja",
    "zh": "zh",
}

DEFAULT_VOICE = "af_heart"


def model_paths(models_dir: Path | None = None) -> tuple[Path, Path]:
    root = Path(models_dir) if models_dir else config.models_dir()
    folder = root / "kokoro-onnx"
    return folder / "kokoro-v1.0.int8.onnx", folder / "voices-v1.0.bin"


def model_status(models_dir: Path | None = None) -> dict:
    model, voices = model_paths(models_dir)
    missing = [path.name for path in (model, voices) if not path.is_file()]
    return {"ok": not missing, "path": str(model.parent), "missing": missing}


class KokoroEngine:
    """Thin, lazy wrapper around `kokoro_onnx.Kokoro`."""

    name = "kokoro"

    def __init__(self, models_dir: Path | None = None) -> None:
        self._models_dir = models_dir
        self._engine = None
        self._lock = threading.Lock()

    @property
    def status(self) -> dict:
        return model_status(self._models_dir)

    @property
    def loaded(self) -> bool:
        return self._engine is not None

    def ensure_loaded(self) -> None:
        if self._engine is not None:
            return
        model, voices = model_paths(self._models_dir)
        if not model.is_file() or not voices.is_file():
            raise TtsModelMissingError(f"kokoro model missing: {model.parent}")
        from kokoro_onnx import Kokoro  # heavy import, only when needed

        self._engine = Kokoro(str(model), str(voices))

    def synthesize(
        self,
        text: str,
        *,
        lang: str = "en",
        voice: str | None = None,
        speed: float = 1.0,
    ) -> tuple[Path, int, int]:
        """Synthesize `text` and write a WAV. Returns (path, sample_rate, duration_ms)."""
        clean = text.strip()
        if not clean:
            raise ValueError("empty text")
        tag = LANG_TAGS.get(lang.lower())
        if tag is None:
            raise TtsUnsupportedLanguageError(f"no Kokoro voice for {lang!r}")
        self.ensure_loaded()
        with self._lock:
            samples, sample_rate = self._engine.create(
                clean,
                voice=voice or DEFAULT_VOICE,
                speed=max(0.5, min(2.0, speed)),
                lang=tag,
            )
        out_dir = config.data_dir() / "tts"
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"{uuid.uuid4().hex}.wav"
        import soundfile as sf

        sf.write(path, samples, sample_rate)
        duration_ms = int(len(samples) / sample_rate * 1000)
        return path, sample_rate, duration_ms


class QwenCloneEngine:
    """Qwen3-TTS 0.6B voice clone through the isolated `.venv-tts` worker.

    The main sidecar venv stays on transformers 4.x (NLLB), so the clone runs in a separate
    Python process and is loaded only when the owner picks "My voice".
    """

    name = "qwen3-tts"

    # MLX holds a large buffer pool while the worker is alive (measured ~9 GB peak). Stop it
    # when the owner stops speaking: the model reloads in ~3 s from the OS page cache.
    IDLE_SHUTDOWN_S = 45

    def __init__(self, models_dir: Path | None = None) -> None:
        root = Path(__file__).resolve().parents[2]
        self._python = root / ".venv-tts" / "bin" / "python"
        self._worker = root / "sidecar" / "engine" / "qwen_tts_worker.py"
        self._models_dir = models_dir
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._idle_timer: threading.Timer | None = None

    @property
    def status(self) -> dict:
        voice_wav, voice_meta = _voice_paths()
        missing = []
        if not self._python.is_file():
            missing.append(".venv-tts")
        if not self._worker.is_file():
            missing.append("qwen_tts_worker.py")
        if not voice_wav.is_file() or not voice_meta.is_file():
            missing.append("voice sample")
        return {"ok": not missing, "missing": missing}

    def _ensure_worker(self) -> subprocess.Popen:
        if self._idle_timer is not None:
            self._idle_timer.cancel()
            self._idle_timer = None
        if self._proc is not None and self._proc.poll() is None:
            return self._proc
        env = os.environ.copy()
        hf_home = (Path(self._models_dir) if self._models_dir else config.models_dir()) / "hf"
        env["HF_HOME"] = str(hf_home)
        # The clone model is downloaded up front; never let a stale network check delay the
        # first synthesis (or hang when the Mac is offline).
        env["HF_HUB_OFFLINE"] = "1"
        self._proc = subprocess.Popen(
            [str(self._python), str(self._worker)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            env=env,
        )
        return self._proc

    def synthesize(
        self,
        text: str,
        *,
        lang: str = "en",
        voice: str | None = None,
        speed: float = 1.0,
    ) -> tuple[Path, int, int]:
        clean = text.strip()
        if not clean:
            raise ValueError("empty text")
        voice_wav, voice_meta = _voice_paths()
        if not voice_wav.is_file() or not voice_meta.is_file():
            raise TtsModelMissingError("voice sample missing")
        ref_text = str(json.loads(voice_meta.read_text()).get("ref_text") or "").strip()
        if not ref_text:
            raise TtsModelMissingError("voice sample has no reference text")
        out_dir = config.data_dir() / "tts"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{uuid.uuid4().hex}.wav"
        request = json.dumps(
            {
                "text": clean,
                "ref_audio": str(voice_wav),
                "ref_text": ref_text,
                "out": str(out),
            }
        )
        with self._lock:
            for attempt in range(2):
                proc = self._ensure_worker()
                try:
                    assert proc.stdin is not None and proc.stdout is not None
                    proc.stdin.write(request + "\n")
                    proc.stdin.flush()
                    # Libraries may still write to fd 1 directly; only trust JSON lines.
                    response: dict | None = None
                    for _ in range(400):
                        line = proc.stdout.readline()
                        if not line:
                            response = {"ok": False, "error": "worker closed"}
                            break
                        text = line.strip()
                        if not text.startswith("{"):
                            continue
                        try:
                            response = json.loads(text)
                        except json.JSONDecodeError:
                            continue
                        break
                    if response is None:
                        response = {"ok": False, "error": "worker sent no reply"}
                    if response.get("ok"):
                        self._schedule_idle_shutdown()
                        return (
                            Path(str(response["path"])),
                            int(response.get("sample_rate") or 24_000),
                            int(response.get("duration_ms") or 0),
                        )
                    raise RuntimeError(str(response.get("error") or "clone failed"))
                except (BrokenPipeError, RuntimeError):
                    self._proc = None
                    if attempt == 1:
                        raise
        raise RuntimeError("clone failed")

    def _schedule_idle_shutdown(self) -> None:
        if self._idle_timer is not None:
            self._idle_timer.cancel()
        timer = threading.Timer(self.IDLE_SHUTDOWN_S, self._idle_shutdown)
        timer.daemon = True
        self._idle_timer = timer
        timer.start()

    def _idle_shutdown(self) -> None:
        """Release the ~9 GB MLX pool when nobody is playing the cloned voice."""
        if not self._lock.acquire(blocking=False):
            self._schedule_idle_shutdown()
            return
        try:
            proc, self._proc, self._idle_timer = self._proc, None, None
            if proc is not None and proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=3)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
        finally:
            self._lock.release()


def _voice_paths() -> tuple[Path, Path]:
    folder = config.data_dir() / "voices"
    return folder / "voice.wav", folder / "voice.json"
