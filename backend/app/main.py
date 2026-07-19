from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.base import Base
from app.db.migrate_sqlite import ensure_sqlite_schema
from app.db.session import engine
import app.models  # noqa: F401


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.database_url.startswith("sqlite"):
        ensure_sqlite_schema(engine)
    else:
        # Create any ORM tables missing from incomplete Alembic history (Postgres).
        Base.metadata.create_all(bind=engine)
    yield


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


_static = Path(settings.desktop_static_dir).resolve() if settings.desktop_static_dir else None
if _static and _static.is_dir() and (_static / "index.html").is_file():
    assets = _static / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        # Do not shadow API / health (already registered above).
        candidate = _static / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_static / "index.html")
