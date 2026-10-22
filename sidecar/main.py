"""Sidecar entry point.

    python sidecar/main.py --mode normal      # run the HTTP/WS service
    python sidecar/main.py --mode doctor      # diagnostics only, then exit

Binds 127.0.0.1:8765 (fallback 8766-8770), writes the real port to `userData/sidecar.port` and
prints `[fispeak-sidecar] ready port=<n>` so the Electron main process can pick it up.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import socket
import sys
from importlib import metadata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sidecar import config  # noqa: E402
from sidecar.logging_setup import setup_logging  # noqa: E402
from sidecar.server.app import create_app  # noqa: E402
from sidecar.server.state import SidecarState  # noqa: E402

log = logging.getLogger("sidecar")

LOCK_FILE = "sidecar.lock"


def bind_socket(host: str, start_port: int, stop_port: int) -> tuple[socket.socket, int]:
    """Bind the first free port in the scan range (09-sidecar-spec §1)."""
    failures: list[str] = []
    for port in range(start_port, stop_port + 1):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
            sock.listen(64)
            sock.setblocking(False)
            # port 0 means "any free port" - report the one the OS picked
            return sock, int(sock.getsockname()[1])
        except OSError as exc:
            sock.close()
            failures.append(f"{port}: {exc}")
    raise SystemExit(f"[fispeak-sidecar] no free port in {start_port}-{stop_port} ({'; '.join(failures)})")


def acquire_lock():
    """Exclusive lock on the data dir so only one sidecar owns `sidecar.port`.

    The lock is released automatically when the process dies, so a crash never leaves a stale
    lock behind. Returns an open handle that must stay referenced for the process lifetime.
    """
    path = config.data_dir() / LOCK_FILE
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = path.open("w")
    except OSError as exc:
        log.warning("lock file unavailable", extra={"fields": {"error": str(exc)}})
        return None

    try:
        import fcntl
    except ImportError:  # pragma: no cover - Windows
        handle.write(json.dumps({"pid": os.getpid(), "version": config.VERSION}))
        handle.flush()
        return handle

    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise SystemExit(
            "[fispeak-sidecar] another sidecar already owns this data dir - reuse it instead of spawning a second one"
        )
    handle.write(json.dumps({"pid": os.getpid(), "version": config.VERSION}))
    handle.flush()
    return handle


def update_lock(handle, port: int) -> None:
    if handle is None:
        return
    try:
        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps({"pid": os.getpid(), "port": port, "version": config.VERSION}))
        handle.flush()
    except OSError:
        pass


def _scan_stop(port: int) -> int:
    """The fallback scan only applies to the default port range (8765-8770)."""
    if port <= 0:
        return 0  # "any free port" - no scan
    return config.PORT_SCAN_STOP if port <= config.PORT_SCAN_STOP else port


def write_port_file(port: int) -> Path:
    path = config.port_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(port))
    return path


def clear_port_file() -> None:
    path = config.port_file()
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def run_doctor() -> int:
    from sidecar.engine.mt import model_status as mt_status
    from sidecar.engine.stt import model_status as stt_status

    packages = {}
    for name in ("fastapi", "uvicorn", "faster-whisper", "ctranslate2", "transformers", "numpy"):
        try:
            packages[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            packages[name] = None

    report = {
        "ok": True,
        "version": config.VERSION,
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "platform": sys.platform,
        "data_dir": str(config.data_dir()),
        "models_dir": str(config.models_dir()),
        "models": {"stt": stt_status(), "mt": mt_status()},
        "packages": packages,
    }
    print(json.dumps(report, indent=2))
    return 0


async def serve(port: int) -> int:
    import uvicorn

    lock_handle = acquire_lock()
    sock, actual_port = bind_socket(config.HOST, port, _scan_stop(port))
    state = SidecarState(port=actual_port)
    app = create_app(state)

    update_lock(lock_handle, actual_port)
    write_port_file(actual_port)
    log.info("sidecar ready", extra={"fields": {"port": actual_port, "host": config.HOST}})
    print(f"[fispeak-sidecar] ready port={actual_port}", flush=True)

    server = uvicorn.Server(
        uvicorn.Config(app, log_config=None, access_log=False, lifespan="on", ws_ping_interval=None)
    )
    serve_task = asyncio.create_task(server.serve(sockets=[sock]))
    shutdown_task = asyncio.create_task(state.shutdown_requested.wait())

    try:
        done, _pending = await asyncio.wait(
            {serve_task, shutdown_task}, return_when=asyncio.FIRST_COMPLETED
        )
        if shutdown_task in done:
            log.info("shutdown requested", extra={"fields": {"port": actual_port}})
            server.should_exit = True
        await serve_task
    except (KeyboardInterrupt, asyncio.CancelledError):
        server.should_exit = True
    finally:
        shutdown_task.cancel()
        server.should_exit = True
        try:
            await serve_task
        except Exception:
            pass
        clear_port_file()
        log.info("sidecar stopped", extra={"fields": {"port": actual_port}})
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sidecar", description="fispeak Python sidecar")
    parser.add_argument("--mode", choices=("normal", "doctor"), default="normal")
    parser.add_argument("--debug", action="store_true", help="verbose logging")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("FISPEAK_SIDECAR_PORT", config.DEFAULT_PORT)),
        help="first port to try (falls back to the next free one)",
    )
    args = parser.parse_args(argv)

    setup_logging(args.debug or os.environ.get("FISPEAK_DEBUG") == "1")

    if args.mode == "doctor":
        return run_doctor()
    return asyncio.run(serve(args.port))


if __name__ == "__main__":
    raise SystemExit(main())
