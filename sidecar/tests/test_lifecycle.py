"""Sidecar process lifecycle: port file, health, graceful shutdown (09-sidecar-spec §1)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENTRY = ROOT / "sidecar" / "main.py"


def _get(url: str, timeout: float = 1.0):
    with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 - fixed localhost URL
        return response.status, json.loads(response.read().decode("utf-8"))


def _wait_for_port_file(path: Path, timeout: float = 30.0) -> int:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if path.exists():
            try:
                return int(path.read_text().strip())
            except ValueError:
                pass
        time.sleep(0.1)
    raise AssertionError("the sidecar never wrote the port file")


def _spawn(data_dir: Path):
    env = os.environ.copy()
    env["FISPEAK_DATA_DIR"] = str(data_dir)
    env.pop("FISPEAK_MODELS_DIR", None)
    # port 0: the OS picks a free port, the sidecar writes it to sidecar.port
    return subprocess.Popen(
        [sys.executable, str(ENTRY), "--mode", "normal", "--port", "0"],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def test_sidecar_starts_serves_health_and_shuts_down_cleanly(tmp_path: Path) -> None:
    process = _spawn(tmp_path)

    try:
        port_file = tmp_path / "sidecar.port"
        port = _wait_for_port_file(port_file)

        deadline = time.time() + 30
        health = None
        while time.time() < deadline:
            if process.poll() is not None:
                raise AssertionError(f"sidecar exited early: {process.stdout.read() if process.stdout else ''}")
            try:
                health = _get(f"http://127.0.0.1:{port}/health")
                break
            except (urllib.error.URLError, OSError, TimeoutError):
                time.sleep(0.25)

        assert health is not None, "the sidecar never answered /health"
        status, body = health
        assert status == 200
        assert body["ok"] is True
        assert body["port"] == port
        assert "version" in body
        assert "models" in body

        assert int(port_file.read_text().strip()) == port

        languages_status, languages_body = _get(f"http://127.0.0.1:{port}/languages")
        assert languages_status == 200
        assert "stt" in languages_body and "nllb" in languages_body

        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/shutdown", data=b"", method="POST"
        )
        with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310 - fixed localhost URL
            assert json.loads(response.read().decode("utf-8"))["ok"] is True

        exited = process.wait(timeout=10)
        assert exited == 0, f"the sidecar exited with {exited}"
        assert not port_file.exists(), "the port file must be removed on shutdown"
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def test_a_second_sidecar_refuses_to_share_the_data_dir(tmp_path: Path) -> None:
    """Only one sidecar may own `userData` (the port file must stay unambiguous)."""
    first = _spawn(tmp_path)
    try:
        _wait_for_port_file(tmp_path / "sidecar.port")

        second = subprocess.run(
            [sys.executable, str(ENTRY), "--mode", "normal", "--port", "0"],
            cwd=str(ROOT),
            env={**os.environ, "FISPEAK_DATA_DIR": str(tmp_path)},
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert second.returncode != 0, "a second sidecar must not start on the same data dir"
        assert "already owns" in (second.stdout + second.stderr)
    finally:
        if first.poll() is None:
            first.kill()
            first.wait(timeout=5)
