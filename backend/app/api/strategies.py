from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.hand import Deviation, HandUpload, PlaySession
from app.models.strategy import Strategy, StrategyCell, StrategySpot
from app.models.user import User
from app.schemas.analysis import (
    EnsureSpotsResponse,
    MissingSpotsResponse,
    RecommendationsResponse,
    ReplayHand,
    StatHandsResponse,
    StrategyAnalysis,
    StrategyDeviationsResponse,
    TrainerDealResponse,
    TrainerGradeRequest,
    TrainerGradeResponse,
)
from app.schemas.strategy import (
    CellBatchUpsert,
    CellRead,
    GameTreePayload,
    GameTreeRead,
    SpotCreate,
    SpotRead,
    SpotUpdate,
    StrategyCreate,
    StrategyRead,
    StrategyUpdate,
)
from app.services import hand_replay as hand_replay_svc
from app.services import hud_stats as hud_stats_svc
from app.services import subscription as sub_svc
from app.services import trainer as trainer_svc
from app.services.ensure_spots import ensure_spots_from_hands, list_missing_spots
from app.services.hand_codes import normalize_hand_code
from app.services.recommendations import build_recommendations
from app.services.strategy_deviations import list_strategy_deviations
from app.services.strategy_modules import stack_window, validate_strategy_meta
from app.services.trainer import invalidate_trainer_cache

router = APIRouter(prefix="/strategies", tags=["strategies"])


def _get_owned_strategy(db: Session, strategy_id: UUID, user: User) -> Strategy:
    strategy = db.get(Strategy, strategy_id)
    if strategy is None or strategy.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Strategy not found")
    return strategy


@router.get(
    "/{strategy_id}/missing-spots",
    response_model=MissingSpotsResponse,
)
def get_missing_strategy_spots(
    strategy_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MissingSpotsResponse:
    """List HH branches that are not yet strategy spots (does not create them)."""
    _get_owned_strategy(db, strategy_id, current_user)
    return list_missing_spots(db, current_user.id, strategy_id)


def _get_owned_spot(db: Session, spot_id: UUID, user: User) -> StrategySpot:
    spot = db.get(StrategySpot, spot_id)
    if spot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Spot not found")
    _get_owned_strategy(db, spot.strategy_id, user)
    return spot


@router.get("", response_model=list[StrategyRead])
def list_strategies(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Strategy]:
    return list(db.scalars(select(Strategy).where(Strategy.user_id == current_user.id).order_by(Strategy.name)))


@router.post("", response_model=StrategyRead, status_code=status.HTTP_201_CREATED)
def create_strategy(
    payload: StrategyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Strategy:
    sub_svc.assert_can_create_strategy(db, current_user)
    try:
        meta = validate_strategy_meta(
            format=payload.format,
            table_size=payload.table_size,
            stack_depth=payload.stack_depth,
            mtt_stage=payload.mtt_stage,
            action_mode=payload.action_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    strategy = Strategy(
        user_id=current_user.id,
        name=payload.name,
        description=payload.description,
        is_default=payload.is_default,
        **meta,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.get("/{strategy_id}", response_model=StrategyRead)
def get_strategy(
    strategy_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Strategy:
    return _get_owned_strategy(db, strategy_id, current_user)


@router.get("/{strategy_id}/analysis", response_model=StrategyAnalysis)
def get_strategy_analysis(
    strategy_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StrategyAnalysis:
    _get_owned_strategy(db, strategy_id, current_user)
    return hud_stats_svc.build_strategy_analysis(db, current_user.id, strategy_id)


@router.post(
    "/{strategy_id}/ensure-spots",
    response_model=EnsureSpotsResponse,
)
def ensure_strategy_spots(
    strategy_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EnsureSpotsResponse:
    """Opt-in: create strategy spots for HH branches missing from the strategy."""
    _get_owned_strategy(db, strategy_id, current_user)
    return ensure_spots_from_hands(db, current_user.id, strategy_id)


@router.get("/{strategy_id}/analysis/hands", response_model=StatHandsResponse)
def get_strategy_stat_hands(
    strategy_id: UUID,
    stat: str,
    limit: int = 150,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StatHandsResponse:
    _get_owned_strategy(db, strategy_id, current_user)
    try:
        return hand_replay_svc.list_stat_hands(
            db,
            current_user.id,
            strategy_id,
            stat,
            limit=max(1, min(limit, 300)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{strategy_id}/analysis/hu-hands", response_model=StatHandsResponse)
def get_strategy_hu_pot_hands(
    strategy_id: UUID,
    pot_kind: str = Query(..., min_length=1),
    matchup: str = Query(..., min_length=1),
    limit: int = 150,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StatHandsResponse:
    """Replay hands for one HU postflop pot (pot_kind + matchup like BBvsSB)."""
    _get_owned_strategy(db, strategy_id, current_user)
    try:
        return hand_replay_svc.list_strategy_hu_pot_hands(
            db,
            current_user.id,
            strategy_id,
            pot_kind,
            matchup,
            limit=max(1, min(limit, 300)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{strategy_id}/deviations", response_model=StrategyDeviationsResponse)
def get_strategy_deviations(
    strategy_id: UUID,
    limit: int = 300,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StrategyDeviationsResponse:
    _get_owned_strategy(db, strategy_id, current_user)
    return list_strategy_deviations(
        db,
        current_user.id,
        strategy_id,
        limit=max(1, min(limit, 500)),
    )


@router.get("/{strategy_id}/recommendations", response_model=RecommendationsResponse)
def get_strategy_recommendations(
    strategy_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> RecommendationsResponse:
    _get_owned_strategy(db, strategy_id, current_user)
    return build_recommendations(db, current_user.id, strategy_id)


@router.get("/{strategy_id}/trainer/next", response_model=TrainerDealResponse)
def trainer_next_deal(
    strategy_id: UUID,
    mode: str = "all",
    exclude: str = "",
    positions: str = "",
    spots: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TrainerDealResponse:
    """Next Oakley-style preflop decision from uploaded hands vs strategy charts."""
    _get_owned_strategy(db, strategy_id, current_user)
    key = mode.strip().lower()
    if key not in {"all", "errors"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mode: all|errors")
    exclude_ids: list[UUID] = []
    for part in exclude.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            exclude_ids.append(UUID(part))
        except ValueError:
            continue
    pos_list = [p.strip().upper() for p in positions.split(",") if p.strip()]
    spot_list = [s.strip().lower() for s in spots.split(",") if s.strip()]
    try:
        return trainer_svc.next_trainer_deal(
            db,
            current_user.id,
            strategy_id,
            mode=key,
            exclude_ids=exclude_ids,
            positions=pos_list or None,
            spots=spot_list or None,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{strategy_id}/trainer/grade", response_model=TrainerGradeResponse)
def trainer_grade(
    strategy_id: UUID,
    payload: TrainerGradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TrainerGradeResponse:
    _get_owned_strategy(db, strategy_id, current_user)
    try:
        return trainer_svc.grade_trainer_deal(
            db, current_user.id, strategy_id, payload
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{strategy_id}/hands/{hand_id}/replay", response_model=ReplayHand)
def get_strategy_hand_replay(
    strategy_id: UUID,
    hand_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReplayHand:
    _get_owned_strategy(db, strategy_id, current_user)
    try:
        return hand_replay_svc.get_strategy_hand_replay(
            db, current_user.id, strategy_id, hand_id
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{strategy_id}/tree", response_model=GameTreeRead)
def get_strategy_tree(
    strategy_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GameTreeRead:
    strategy = _get_owned_strategy(db, strategy_id, current_user)
    tree = strategy.game_tree
    if tree is not None and not isinstance(tree, dict):
        return GameTreeRead(tree=None)
    return GameTreeRead(tree=tree)


@router.put("/{strategy_id}/tree", response_model=GameTreeRead)
def put_strategy_tree(
    strategy_id: UUID,
    payload: GameTreePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GameTreeRead:
    strategy = _get_owned_strategy(db, strategy_id, current_user)
    tree = payload.tree
    if not isinstance(tree, dict) or tree.get("version") != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid game tree payload",
        )
    if str(tree.get("strategyId") or "") not in ("", str(strategy_id)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tree strategyId mismatch",
        )
    # Normalize id so reloads always match this strategy.
    stored = {**tree, "strategyId": str(strategy_id)}
    strategy.game_tree = stored
    db.commit()
    db.refresh(strategy)
    return GameTreeRead(tree=strategy.game_tree)


@router.patch("/{strategy_id}", response_model=StrategyRead)
def update_strategy(
    strategy_id: UUID,
    payload: StrategyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Strategy:
    strategy = _get_owned_strategy(db, strategy_id, current_user)
    data = payload.model_dump(exclude_unset=True)
    meta_keys = {"format", "table_size", "stack_depth", "mtt_stage", "action_mode"}
    if meta_keys & data.keys():
        try:
            meta = validate_strategy_meta(
                format=data.get("format", strategy.format),
                table_size=data.get("table_size", strategy.table_size),
                stack_depth=data.get("stack_depth", strategy.stack_depth),
                mtt_stage=data.get("mtt_stage", strategy.mtt_stage),
                action_mode=data.get("action_mode", strategy.action_mode),
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        data.update(meta)
    for key, value in data.items():
        setattr(strategy, key, value)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.delete("/{strategy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_strategy(
    strategy_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    strategy = _get_owned_strategy(db, strategy_id, current_user)
    # Deviations.strategy_id is NOT NULL — remove them before the strategy row.
    db.execute(delete(Deviation).where(Deviation.strategy_id == strategy.id))

    # Keep uploaded session/hands in DB — only detach from this strategy.
    for upload in db.scalars(select(HandUpload).where(HandUpload.strategy_id == strategy.id)):
        upload.strategy_id = None
    for session in db.scalars(select(PlaySession).where(PlaySession.strategy_id == strategy.id)):
        session.strategy_id = None

    db.delete(strategy)
    db.commit()


@router.get("/{strategy_id}/spots", response_model=list[SpotRead])
def list_spots(
    strategy_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[StrategySpot]:
    _get_owned_strategy(db, strategy_id, current_user)
    return list(
        db.scalars(
            select(StrategySpot)
            .where(StrategySpot.strategy_id == strategy_id)
            .order_by(StrategySpot.sort_order, StrategySpot.spot_key)
        )
    )


@router.post("/{strategy_id}/spots", response_model=SpotRead, status_code=status.HTTP_201_CREATED)
def create_spot(
    strategy_id: UUID,
    payload: SpotCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StrategySpot:
    strategy = _get_owned_strategy(db, strategy_id, current_user)
    data = payload.model_dump()
    if data.get("stack_bb_min") is None and data.get("stack_bb_max") is None:
        lo, hi = stack_window(strategy.format, strategy.stack_depth, strategy.action_mode)
        if lo is not None:
            data["stack_bb_min"] = lo
        if hi is not None:
            data["stack_bb_max"] = hi
    spot = StrategySpot(strategy_id=strategy_id, **data)
    db.add(spot)
    db.commit()
    db.refresh(spot)
    return spot


@router.patch("/spots/{spot_id}", response_model=SpotRead)
def update_spot(
    spot_id: UUID,
    payload: SpotUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StrategySpot:
    spot = _get_owned_spot(db, spot_id, current_user)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(spot, key, value)
    db.commit()
    db.refresh(spot)
    return spot


@router.delete("/spots/{spot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_spot(
    spot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    spot = _get_owned_spot(db, spot_id, current_user)
    db.delete(spot)
    db.commit()


@router.get("/spots/{spot_id}/cells", response_model=list[CellRead])
def list_cells(
    spot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[StrategyCell]:
    _get_owned_spot(db, spot_id, current_user)
    return list(db.scalars(select(StrategyCell).where(StrategyCell.spot_id == spot_id)))


@router.put("/spots/{spot_id}/cells", response_model=list[CellRead])
def upsert_cells(
    spot_id: UUID,
    payload: CellBatchUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[StrategyCell]:
    spot = _get_owned_spot(db, spot_id, current_user)
    existing = {
        c.hand_code: c for c in db.scalars(select(StrategyCell).where(StrategyCell.spot_id == spot_id))
    }
    result: list[StrategyCell] = []
    for item in payload.cells:
        code = normalize_hand_code(item.hand_code)
        cell = existing.get(code)
        if cell is None:
            cell = StrategyCell(spot_id=spot_id, hand_code=code)
            db.add(cell)
            existing[code] = cell
        cell.raise_freq = item.raise_freq
        cell.call_freq = item.call_freq
        cell.fold_freq = item.fold_freq
        result.append(cell)
    # Bump strategy so Analysis can detect chart edits without a full HH re-import.
    strategy = db.get(Strategy, spot.strategy_id)
    if strategy is not None:
        strategy.updated_at = datetime.now(timezone.utc)
    db.commit()
    for cell in result:
        db.refresh(cell)
    invalidate_trainer_cache(strategy_id=spot.strategy_id)
    return result
