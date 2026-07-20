"""Lightweight background loop for auto YouTube feed ingest."""

from __future__ import annotations

import asyncio
import logging

from app.db.session import SessionLocal
from app.services import feed_pipeline as feed_svc

log = logging.getLogger("feed_worker")

# Run about every 6 hours
INTERVAL_SEC = 6 * 60 * 60


async def feed_auto_loop(stop: asyncio.Event) -> None:
    # Initial delay so app finishes boot / migrations
    try:
        await asyncio.wait_for(stop.wait(), timeout=90)
        return
    except asyncio.TimeoutError:
        pass

    while not stop.is_set():
        try:
            with SessionLocal() as db:
                settings = feed_svc.get_or_create_settings(db)
                if settings.auto_enabled:
                    created, skipped, msg = feed_svc.run_auto_cycle(db)
                    log.info("feed auto: %s (created=%s skipped=%s)", msg, created, skipped)
        except Exception:
            log.exception("feed auto cycle failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=INTERVAL_SEC)
            return
        except asyncio.TimeoutError:
            continue
