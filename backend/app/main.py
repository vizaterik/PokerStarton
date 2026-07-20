import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.ensure_schema import ensure_postgres_schema
from app.db.migrate_sqlite import ensure_sqlite_schema
from app.db.session import engine
from app.services.feed_worker import feed_auto_loop
import app.models  # noqa: F401


def _resolve_static_dir() -> Path | None:
    candidates = [
        settings.desktop_static_dir,
        settings.static_dir,
        "static",
        "../frontend/dist",
    ]
    for raw in candidates:
        if not raw:
            continue
        path = Path(raw).expanduser().resolve()
        if path.is_dir() and (path / "index.html").is_file():
            return path
    return None


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.database_url.startswith("sqlite"):
        ensure_sqlite_schema(engine)
    else:
        ensure_postgres_schema(engine)
    stop = asyncio.Event()
    worker = asyncio.create_task(feed_auto_loop(stop))
    try:
        yield
    finally:
        stop.set()
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass


app = FastAPI(title="PokerStraton", version="0.1.0", lifespan=lifespan)

_cors_kwargs: dict = {
    "allow_origins": settings.cors_origin_list,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
# Starlette disallows allow_credentials with allow_origins=["*"]
if settings.cors_origin_list == ["*"]:
    _cors_kwargs["allow_credentials"] = False

app.add_middleware(CORSMiddleware, **_cors_kwargs)

app.include_router(api_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


_static = _resolve_static_dir()
if _static is not None:
    assets = _static / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/")
    async def spa_root() -> FileResponse:
        return FileResponse(_static / "index.html")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        # API/docs should already be registered; never rewrite them to the SPA.
        if full_path.startswith("api/") or full_path in {
            "health",
            "docs",
            "openapi.json",
            "redoc",
        }:
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = _static / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_static / "index.html")
