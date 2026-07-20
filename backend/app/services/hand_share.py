from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.hand import Hand, HandAction, HandUpload, PlaySession
from app.models.hand_share import HandShare
from app.models.user import User
from app.parsers.pokerstars import ParsedAction, ParsedHand, parse_pokerstars
from app.schemas.analysis import ReplayHand
from app.schemas.hand_share import HandShareRead, ShareHandFromTextRequest
from app.services import databases as db_svc
from app.services.hand_limits import assert_database_capacity
from app.services.hand_pipeline import _persist_hand
from app.services.hand_replay import build_replay_hand

_BOARD_MARKER_RE = re.compile(r"\*\*\*\s+(FLOP|TURN|RIVER)\s+\*\*\*", re.I)


def _dec(value: float | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


def _owned_hand(db: Session, user_id: UUID, hand_id: UUID) -> Hand | None:
    upload_ids = select(HandUpload.id).where(HandUpload.user_id == user_id)
    session_ids = select(PlaySession.id).where(PlaySession.user_id == user_id)
    return db.scalar(
        select(Hand)
        .options(selectinload(Hand.actions))
        .where(
            Hand.id == hand_id,
            or_(Hand.upload_id.in_(upload_ids), Hand.session_id.in_(session_ids)),
        )
    )


def _ensure_share_row(db: Session, user_id: UUID, hand_id: UUID) -> HandShareRead:
    existing = db.scalar(select(HandShare).where(HandShare.hand_id == hand_id))
    if existing is not None:
        return HandShareRead(token=existing.token, path=f"/h/{existing.token}")

    share = HandShare(
        token=secrets.token_urlsafe(16),
        hand_id=hand_id,
        created_by=user_id,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    return HandShareRead(token=share.token, path=f"/h/{share.token}")


def create_or_get_hand_share(db: Session, user_id: UUID, hand_id: UUID) -> HandShareRead:
    hand = _owned_hand(db, user_id, hand_id)
    if hand is None:
        raise LookupError("Раздача не найдена")
    return _ensure_share_row(db, user_id, hand.id)


def _try_parse(raw_text: str) -> ParsedHand | None:
    try:
        rows = parse_pokerstars(raw_text)
    except Exception:
        return None
    return rows[0] if rows else None


def _raw_has_board(raw: str) -> bool:
    return bool(_BOARD_MARKER_RE.search(raw or ""))


def _append_board_to_raw(raw: str, board: list[str]) -> str:
    """Ensure raw_text contains FLOP/TURN/RIVER markers when board cards are known."""
    cards = [c.strip() for c in board if c and len(c.strip()) >= 2]
    if len(cards) < 3:
        return raw
    if _raw_has_board(raw):
        return raw
    lines = [(raw or "").rstrip()]
    if lines[-1]:
        lines.append("")
    flop = " ".join(cards[:3])
    lines.append(f"*** FLOP *** [{flop}]")
    if len(cards) >= 4:
        lines.append(f"*** TURN *** [{flop}] [{cards[3]}]")
    if len(cards) >= 5:
        turn_board = " ".join(cards[:4])
        lines.append(f"*** RIVER *** [{turn_board}] [{cards[4]}]")
    return "\n".join(lines).strip() + "\n"


def _street_rank(street: str) -> int:
    order = {"preflop": 0, "flop": 1, "turn": 2, "river": 3}
    return order.get((street or "").lower(), 0)


def _parsed_from_request(payload: ShareHandFromTextRequest) -> ParsedHand:
    text = (payload.raw_text or "").strip()
    text = _append_board_to_raw(text, payload.board or [])
    parsed_ps = _try_parse(text) if len(text) >= 40 else None

    eid = (payload.external_hand_id or "").strip()[:64]
    if not eid and parsed_ps:
        eid = parsed_ps.external_hand_id
    if not eid:
        eid = hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()[:16]

    actions: list[ParsedAction] = []
    if payload.actions:
        for a in payload.actions:
            actions.append(
                ParsedAction(
                    street=(a.street or "preflop").lower(),
                    action_order=int(a.action_order),
                    player_name=a.player_name,
                    is_hero=bool(a.is_hero),
                    action=(a.action or "fold").lower(),
                    amount=a.amount,
                )
            )
    elif parsed_ps and parsed_ps.actions:
        actions = list(parsed_ps.actions)

    if not actions:
        raise ValueError("В раздаче нет действий для реплея")

    # Prefer fuller action list from PokerStars parse when client sent a stub cut.
    if parsed_ps and parsed_ps.actions and len(parsed_ps.actions) > len(actions):
        actions = list(parsed_ps.actions)

    hero_hand = (payload.hero_hand or "").strip()[:4] or None
    if not hero_hand and parsed_ps:
        hero_hand = parsed_ps.hero_hand

    raw_final = text or (parsed_ps.raw_text if parsed_ps else f"Hand #{eid}")
    if parsed_ps and parsed_ps.raw_text and (
        len(parsed_ps.raw_text) > len(raw_final) or (_raw_has_board(parsed_ps.raw_text) and not _raw_has_board(raw_final))
    ):
        raw_final = parsed_ps.raw_text

    return ParsedHand(
        external_hand_id=eid,
        raw_text=raw_final,
        played_at=payload.played_at or (parsed_ps.played_at if parsed_ps else None),
        table_name=payload.table_name or (parsed_ps.table_name if parsed_ps else None),
        small_blind=payload.small_blind
        if payload.small_blind is not None
        else (parsed_ps.small_blind if parsed_ps else None),
        big_blind=payload.big_blind
        if payload.big_blind is not None
        else (parsed_ps.big_blind if parsed_ps else None),
        hero_name=payload.hero_name or (parsed_ps.hero_name if parsed_ps else "Hero"),
        hero_position=payload.hero_position
        or (parsed_ps.hero_position if parsed_ps else None),
        hero_hand=hero_hand,
        hero_hand_code=parsed_ps.hero_hand_code if parsed_ps else None,
        detected_spot=parsed_ps.detected_spot if parsed_ps else None,
        villain_position=parsed_ps.villain_position if parsed_ps else None,
        stack_bb=parsed_ps.stack_bb if parsed_ps else None,
        hero_preflop_action=parsed_ps.hero_preflop_action if parsed_ps else None,
        hero_net=payload.hero_net
        if payload.hero_net is not None
        else (parsed_ps.hero_net if parsed_ps else None),
        hero_net_bb=payload.hero_net_bb
        if payload.hero_net_bb is not None
        else (parsed_ps.hero_net_bb if parsed_ps else None),
        went_to_showdown=bool(parsed_ps.went_to_showdown) if parsed_ps else False,
        hero_net_wsd=parsed_ps.hero_net_wsd if parsed_ps else None,
        hero_net_wsd_bb=parsed_ps.hero_net_wsd_bb if parsed_ps else None,
        hero_net_wwsd=parsed_ps.hero_net_wwsd if parsed_ps else None,
        hero_net_wwsd_bb=parsed_ps.hero_net_wwsd_bb if parsed_ps else None,
        actions=actions,
    )


def _max_street(actions: list) -> int:
    if not actions:
        return -1
    return max(_street_rank(getattr(a, "street", "") or "") for a in actions)


def _upgrade_hand_for_share(db: Session, hand: Hand, parsed: ParsedHand) -> None:
    """Overwrite stub snapshot hands with the full client replay payload."""
    existing_n = len(hand.actions or [])
    incoming_n = len(parsed.actions or [])
    existing_street = _max_street(list(hand.actions or []))
    incoming_street = _max_street(parsed.actions)
    richer_actions = incoming_n > existing_n or incoming_street > existing_street
    richer_raw = bool(parsed.raw_text) and (
        len(parsed.raw_text) > len(hand.raw_text or "")
        or (_raw_has_board(parsed.raw_text) and not _raw_has_board(hand.raw_text or ""))
    )

    if richer_raw:
        hand.raw_text = parsed.raw_text
    if parsed.table_name:
        hand.table_name = parsed.table_name
    if parsed.hero_name:
        hand.hero_name = parsed.hero_name
    if parsed.hero_position:
        hand.hero_position = parsed.hero_position
    if parsed.hero_hand:
        hand.hero_hand = parsed.hero_hand
    if parsed.small_blind is not None:
        hand.small_blind = _dec(parsed.small_blind)
    if parsed.big_blind is not None:
        hand.big_blind = _dec(parsed.big_blind)
    if parsed.hero_net is not None:
        hand.hero_net = _dec(parsed.hero_net)
    if parsed.hero_net_bb is not None:
        hand.hero_net_bb = _dec(parsed.hero_net_bb)
    if parsed.played_at is not None:
        hand.played_at = parsed.played_at

    if richer_actions and parsed.actions:
        db.execute(delete(HandAction).where(HandAction.hand_id == hand.id))
        db.flush()
        for action in parsed.actions:
            db.add(
                HandAction(
                    hand_id=hand.id,
                    street=action.street,
                    action_order=action.action_order,
                    player_name=action.player_name,
                    is_hero=action.is_hero,
                    action=action.action,
                    amount=_dec(action.amount),
                )
            )

    db.commit()


def _find_share_for_external(db: Session, user_id: UUID, external_hand_id: str) -> HandShare | None:
    eid = (external_hand_id or "").strip()[:64]
    if not eid:
        return None
    return db.scalar(
        select(HandShare)
        .join(Hand, Hand.id == HandShare.hand_id)
        .where(
            HandShare.created_by == user_id,
            Hand.external_hand_id == eid,
        )
        .order_by(HandShare.created_at.desc())
        .limit(1)
    )


def _create_dedicated_share_hand(db: Session, user: User, parsed: ParsedHand) -> Hand:
    active_db = db_svc.get_active_database(db, user)
    assert_database_capacity(db, database_id=active_db.id, additional_hands=1)

    session = PlaySession(
        user_id=user.id,
        database_id=active_db.id,
        strategy_id=None,
        room="pokerstars",
        label="Shared hand",
        source_filename="share.txt",
        table_name=parsed.table_name,
        small_blind=_dec(parsed.small_blind),
        big_blind=_dec(parsed.big_blind),
        max_seats=None,
        started_at=parsed.played_at,
        ended_at=parsed.played_at,
        hands_count=1,
        status="archived",
    )
    db.add(session)
    db.flush()

    upload = HandUpload(
        user_id=user.id,
        database_id=active_db.id,
        strategy_id=None,
        session_id=session.id,
        room="pokerstars",
        original_filename="share.txt",
        storage_path=None,
        status="analyzed",
        hands_count=1,
        processed_at=datetime.now(timezone.utc),
    )
    db.add(upload)
    db.flush()

    hand = _persist_hand(db, upload, parsed, session.id)
    db.commit()
    return hand


def create_share_from_raw_text(
    db: Session,
    user: User,
    *,
    raw_text: str,
    external_hand_id: str | None = None,
) -> HandShareRead:
    """Legacy helper — prefer create_share_from_replay."""
    return create_share_from_replay(
        db,
        user,
        ShareHandFromTextRequest(raw_text=raw_text, external_hand_id=external_hand_id),
    )


def create_share_from_replay(
    db: Session,
    user: User,
    payload: ShareHandFromTextRequest,
) -> HandShareRead:
    """Persist a full replay snapshot for public sharing and return /h/{token}.

    Never reuses truncated analysis-snapshot stubs. Upgrades an existing share
    hand for the same external_hand_id when the payload is richer.
    """
    parsed = _parsed_from_request(payload)

    existing_share = _find_share_for_external(db, user.id, parsed.external_hand_id)
    if existing_share is not None:
        hand = db.scalar(
            select(Hand)
            .options(selectinload(Hand.actions))
            .where(Hand.id == existing_share.hand_id)
        )
        if hand is not None:
            _upgrade_hand_for_share(db, hand, parsed)
            return HandShareRead(token=existing_share.token, path=f"/h/{existing_share.token}")

    hand = _create_dedicated_share_hand(db, user, parsed)
    return _ensure_share_row(db, user.id, hand.id)


def get_public_hand_replay(db: Session, token: str) -> ReplayHand:
    clean = (token or "").strip()
    if not clean or len(clean) > 64:
        raise LookupError("Ссылка недействительна")

    share = db.scalar(select(HandShare).where(HandShare.token == clean))
    if share is None:
        raise LookupError("Ссылка недействительна")

    hand = db.scalar(
        select(Hand)
        .options(selectinload(Hand.actions))
        .where(Hand.id == share.hand_id)
    )
    if hand is None:
        raise LookupError("Раздача не найдена")
    return build_replay_hand(hand)
