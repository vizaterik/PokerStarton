from fastapi import APIRouter

from app.api import (
    analytics,
    auth,
    billing,
    career,
    databases,
    hand_shares,
    hud,
    strategies,
    support,
    sync,
    uploads,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(billing.router)
api_router.include_router(strategies.router)
api_router.include_router(uploads.router)
api_router.include_router(sync.router)
api_router.include_router(career.router)
api_router.include_router(databases.router)
api_router.include_router(hud.router)
api_router.include_router(hand_shares.router)
api_router.include_router(support.router)
api_router.include_router(analytics.router)
