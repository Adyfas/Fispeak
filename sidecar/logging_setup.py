"""One-line JSON logging (09-sidecar-spec §6): {"ts":…,"lvl":"INFO","mod":"stt","msg":"…"}."""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now().microsecond // 1000:03d}Z",
            "lvl": record.levelname,
            "mod": record.name,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(debug: bool = False) -> None:
    if debug:
        os.environ.setdefault("FISPEAK_DEBUG", "1")
    level = logging.DEBUG if debug else logging.INFO
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    # uvicorn installs its own colourising handlers; route them through ours so stdout stays JSON.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        log = logging.getLogger(name)
        log.handlers.clear()
        log.propagate = True


def log(mod: str, msg: str, level: int = logging.INFO, **fields: object) -> None:
    logging.getLogger(mod).log(level, msg, extra={"fields": fields} if fields else None)
