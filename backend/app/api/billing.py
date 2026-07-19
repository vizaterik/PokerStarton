from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.billing import SelectPlanRequest, SubscriptionRead
from app.services import subscription as sub_svc

router = APIRouter(prefix="/billing", tags=["billing"])


@router.get("/subscription", response_model=SubscriptionRead)
def get_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionRead:
    payload = sub_svc.build_subscription_payload(db, current_user)
    db.commit()  # persist month reset if any
    return SubscriptionRead(**payload)


@router.post("/select-plan", response_model=SubscriptionRead)
def select_plan(
    payload: SelectPlanRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionRead:
    sub_svc.select_plan(current_user, payload.plan_id)
    db.commit()
    db.refresh(current_user)
    return SubscriptionRead(**sub_svc.build_subscription_payload(db, current_user))
