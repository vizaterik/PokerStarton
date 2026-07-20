from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Render / Heroku style URLs → SQLAlchemy + psycopg v3."""
    u = (url or "").strip()
    if not u:
        return u
    if u.startswith("postgres://"):
        u = "postgresql+psycopg://" + u[len("postgres://") :]
    elif u.startswith("postgresql://") and not u.startswith("postgresql+"):
        u = "postgresql+psycopg://" + u[len("postgresql://") :]
    # Render Postgres expects TLS even on the private network.
    if ("dpg-" in u or "render.com" in u) and "sslmode=" not in u:
        u += ("&" if "?" in u else "?") + "sslmode=require"
    return u


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite:///./pokerledger.db"
    secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    cors_origins: str = (
        "http://localhost:5173,"
        "https://pokerstarton.onrender.com,"
        "https://pokerstarton-api.onrender.com"
    )
    upload_dir: str = "uploads"
    algorithm: str = "HS256"
    google_client_id: str = ""
    # Serve built React UI from this directory (Docker / Render same-origin).
    desktop_static_dir: str = ""
    static_dir: str = ""
    desktop_mode: bool = False

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True

    # AI feed (YouTube + OpenAI-compatible LLM)
    youtube_api_key: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_db(cls, v: object) -> object:
        if isinstance(v, str):
            return normalize_database_url(v)
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        raw = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        if self.desktop_mode or "*" in raw:
            return ["*"]
        return raw


settings = Settings()
