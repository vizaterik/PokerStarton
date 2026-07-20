"""Import all models so Alembic and Base.metadata see them."""

from app.models.analysis_snapshot import AnalysisSnapshot
from app.models.bankroll import BankrollEntry, BankrollSettings
from app.models.hand import Deviation, Hand, HandAction, HandUpload, PlaySession
from app.models.hand_database import HandDatabase
from app.models.hand_share import HandShare
from app.models.feed import FeedPost, FeedSettings
from app.models.hand_share_social import (
    HandShareComment,
    HandShareCommentLike,
    HandShareLike,
    HandShareView,
)
from app.models.page_view import PageView
from app.models.player_stats import HudAggregationCredit, PlayerStatsAggregated
from app.models.strategy import Strategy, StrategyCell, StrategySpot
from app.models.user import User

__all__ = [
    "User",
    "Strategy",
    "StrategySpot",
    "StrategyCell",
    "PlaySession",
    "HandUpload",
    "Hand",
    "HandAction",
    "Deviation",
    "HandShare",
    "HandShareComment",
    "HandShareCommentLike",
    "HandShareLike",
    "HandShareView",
    "FeedSettings",
    "FeedPost",
    "HandDatabase",
    "AnalysisSnapshot",
    "BankrollSettings",
    "BankrollEntry",
    "PageView",
    "PlayerStatsAggregated",
    "HudAggregationCredit",
]
