"""One-shot: wipe first-party pageview stats."""
from sqlalchemy import text

from app.db.session import engine

with engine.begin() as conn:
    tables = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
    if "page_views" not in tables:
        print("page_views table missing — nothing to clear")
    else:
        result = conn.execute(text("DELETE FROM page_views"))
        print(f"cleared page_views: {result.rowcount}")
