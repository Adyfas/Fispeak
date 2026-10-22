"""REST endpoints of the sidecar.

Phase 2 surface is exactly four routes (09-sidecar-spec CORRECTION 2026-10-22):
`GET /health`, `GET /languages`, `WS /ws` (see `ws.py`) and `POST /shutdown`.
Session, model-status and summary routes belong to Electron main, not to the sidecar.
"""

from __future__ import annotations

from fastapi import FastAPI

from sidecar import config
from sidecar.engine import languages
from sidecar.server.state import SidecarState


def register_rest(app: FastAPI, state: SidecarState) -> None:
    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "ok": True,
            "port": state.port,
            "version": config.VERSION,
            "models": state.models_report(),
        }

    @app.get("/languages")
    async def languages_endpoint() -> dict[str, object]:
        return languages.as_dict()

    @app.post("/shutdown")
    async def shutdown() -> dict[str, object]:
        state.shutdown_requested.set()
        return {"ok": True}
