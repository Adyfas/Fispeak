"""FastAPI application factory (09-sidecar-spec §1-§3)."""

from __future__ import annotations

from fastapi import FastAPI, WebSocket

from sidecar import config
from sidecar.server.rest import register_rest
from sidecar.server.state import SidecarState
from sidecar.server.ws import WsSession


def create_app(state: SidecarState) -> FastAPI:
    app = FastAPI(
        title="fispeak-sidecar",
        version=config.VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    register_rest(app, state)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        await WsSession(websocket, state).run()

    return app
