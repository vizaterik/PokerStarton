from __future__ import annotations

from pydantic import BaseModel, Field


class HuPotBranchRow(BaseModel):
    """Heads-up after flop: pot tag + matchup `BBvsSB`."""

    spot_key: str
    hero_position: str
    villain_position: str | None = None
    pot_kind: str = "srp"
    pot_tag: str = "Raise"
    matchup: str = ""
    label: str
    hands_count: int
    profit_money: float
    profit_bb: float
    winrate_bb100: float


class HudStat(BaseModel):
    """H2N-style HUD row: value = cases / opportunities * 100."""

    key: str
    label: str
    value: float | None = None
    samples: int = 0  # alias of opportunities (compat)
    cases: int = 0
    opportunities: int = 0
    unit: str = "pct"  # pct | bb100 | money | count | ratio


class PositionHudRow(BaseModel):
    position: str
    hands: int
    vpip: float | None = None
    pfr: float | None = None
    three_bet: float | None = None
    winrate_bb100: float | None = None
    profit_bb: float = 0.0


class AnalysisCurvePoint(BaseModel):
    hand_index: int
    cum_total_bb: float
    cum_wwsd_bb: float
    cum_wsd_bb: float
    cum_total_money: float
    cum_wwsd_money: float
    cum_wsd_money: float
    # H2N-style performance overlay
    cum_ev_bb: float = 0.0
    cum_ev_money: float = 0.0
    # % of scored decisions that matched the strategy chart
    compliance_rate: float = 100.0


class StrategyAnalysis(BaseModel):
    strategy_id: str
    hands: int = 0
    winrate_bb100: float | None = None
    total_profit_bb: float = 0.0
    total_profit_money: float = 0.0
    stats: list[HudStat] = Field(default_factory=list)
    by_position: list[PositionHudRow] = Field(default_factory=list)
    curve: list[AnalysisCurvePoint] = Field(default_factory=list)


class ReplaySeat(BaseModel):
    seat: int
    name: str
    position: str | None = None
    stack: float | None = None
    is_hero: bool = False
    is_button: bool = False
    cards: str | None = None


class ReplayAction(BaseModel):
    street: str
    order: int
    player_name: str
    is_hero: bool
    action: str
    amount: float | None = None


class ReplayHand(BaseModel):
    id: str
    external_hand_id: str
    played_at: str | None = None
    table_name: str | None = None
    small_blind: float | None = None
    big_blind: float | None = None
    hero_name: str | None = None
    hero_position: str | None = None
    hero_cards: list[str] = Field(default_factory=list)
    board: list[str] = Field(default_factory=list)
    hero_net: float = 0.0
    hero_net_bb: float = 0.0
    seats: list[ReplaySeat] = Field(default_factory=list)
    actions: list[ReplayAction] = Field(default_factory=list)
    raw_text: str = ""


class StatHandsResponse(BaseModel):
    strategy_id: str
    stat: str
    label: str
    total_matched: int
    hands: list[ReplayHand] = Field(default_factory=list)


class StrategyDeviationRow(BaseModel):
    id: str
    hand_id: str
    hand_code: str
    actual_action: str
    expected_action: str
    actual_freq: float | None = None
    expected_freq: float | None = None
    severity: float | None = None
    spot_key: str | None = None
    spot_label: str | None = None
    hero_position: str | None = None
    villain_position: str | None = None
    external_hand_id: str | None = None
    played_at: str | None = None
    hero_net_bb: float = 0.0
    """Estimated $ put in when hero continued vs a chart fold (or similar leak)."""
    missed_ev_money: float = 0.0


class PreflopSpotAccuracy(BaseModel):
    spot_key: str
    label: str
    decisions: int = 0
    correct: int = 0
    correct_pct: float = 100.0


class PreflopOpenBreakdown(BaseModel):
    """RFI: what hero did vs what the chart wanted."""

    decisions: int = 0
    """Hero actually raised (opened)."""
    opened: int = 0
    """Hero folded (did not open)."""
    folded: int = 0
    """Hero called / limped."""
    called: int = 0
    """Chart preferred raise — spots where we should open."""
    should_open: int = 0
    """Opened when chart wanted open."""
    opened_correct: int = 0
    """Folded/called when chart wanted open (missed open = error)."""
    missed_opens: int = 0
    """Chart preferred fold."""
    should_fold: int = 0
    """Folded when chart wanted fold."""
    folded_correct: int = 0
    """Raised/called when chart wanted fold."""
    wrong_opens: int = 0
    """% correct among should_open spots."""
    open_follow_pct: float = 100.0
    """% correct among should_fold spots."""
    fold_follow_pct: float = 100.0
    """Overall RFI accuracy (same as open_pct)."""
    accuracy_pct: float = 100.0


class PreflopPositionOpenRow(BaseModel):
    """RFI open / not-open breakdown for one hero position."""

    position: str
    decisions: int = 0
    opened: int = 0
    folded: int = 0
    called: int = 0
    should_open: int = 0
    opened_correct: int = 0
    missed_opens: int = 0
    should_fold: int = 0
    folded_correct: int = 0
    wrong_opens: int = 0
    accuracy_pct: float = 100.0


class PreflopBranchAccuracy(BaseModel):
    """Accuracy + P/L for one strategy branch (spot × hero pos × villain pos)."""

    spot_key: str
    spot_label: str
    hero_position: str
    villain_position: str | None = None
    pot_kind: str = "srp"
    pot_tag: str = "Raise"
    matchup: str = ""
    decisions: int = 0
    correct: int = 0
    correct_pct: float = 100.0
    profit_money: float = 0.0
    profit_bb: float = 0.0
    winrate_bb100: float = 0.0


class ChartErrorCell(BaseModel):
    hand_code: str
    """Total error count for this hand in the spot."""
    errors: int = 0
    """Legacy alias (unused)."""
    opens: int = 0
    """Error breakdown by hero's actual action (raise / call / fold)."""
    raise_count: int = 0
    call_count: int = 0
    fold_count: int = 0
    actual_action: str | None = None
    expected_action: str | None = None


class ChartErrorSpot(BaseModel):
    """Error matrix for one strategy chart. spot_id is the painted chart used for scoring."""

    spot_key: str
    hero_position: str
    villain_position: str | None = None
    label: str = ""
    spot_id: str | None = None
    cells: list[ChartErrorCell] = Field(default_factory=list)


class LeakInsight(BaseModel):
    id: str
    title: str
    score_pct: float | None = None
    status: str = "ok"  # ok | warn | leak
    hint: str


class LeakHeatCell(BaseModel):
    hand_code: str
    errors: int = 0
    lost_money: float = 0.0


class LeakFinderReport(BaseModel):
    missed_profit_money: float = 0.0
    critical_errors: int = 0
    insights: list[LeakInsight] = Field(default_factory=list)
    heat: list[LeakHeatCell] = Field(default_factory=list)


class RecommendationHandItem(BaseModel):
    """One math-based leak with full hand context and correct-line example."""

    hand_id: str
    external_hand_id: str
    hand_code: str
    hero_cards: str = ""
    position: str
    street: str
    board: list[str] = Field(default_factory=list)
    pot_before: float = 0.0
    bet_amount: float = 0.0
    actual_action: str
    correct_action: str
    lost_money: float = 0.0
    ev_loss: float = 0.0
    pot_odds_pct: float | None = None
    equity_pct: float | None = None
    outs: int | None = None
    title: str
    analysis: str
    example: str
    text: str


class PlanChecklistItem(BaseModel):
    priority: int
    text: str


class HudEvalItem(BaseModel):
    """One HUD metric vs solid-reg target with coaching note."""

    key: str
    label: str
    value: float | None = None
    unit: str = "pct"  # pct | ratio
    samples: int = 0
    target_min: float | None = None
    target_max: float | None = None
    status: str = "ok"  # low | ok | high | unknown
    score: float = 10.0  # 0..10 for this metric
    recommendation: str = ""


class GameEvaluation(BaseModel):
    """Overall 0–10 grade + HUD coaching block."""

    score: float = 0.0
    label: str = ""
    summary: str = ""
    hands: int = 0
    confidence: str = "low"  # low | medium | high
    math_score: float = 0.0
    hud_score: float = 0.0
    hud: list[HudEvalItem] = Field(default_factory=list)
    focus: list[str] = Field(default_factory=list)


class RecommendationsResponse(BaseModel):
    strategy_id: str
    """Hands from the active session in the profile DB used for this report."""
    hands_count: int = 0
    math_errors: int = 0
    total_damage_money: float = 0.0
    discipline: list[RecommendationHandItem] = Field(default_factory=list)
    critical_damage: list[RecommendationHandItem] = Field(default_factory=list)
    pot_odds: list[RecommendationHandItem] = Field(default_factory=list)
    plan: list[PlanChecklistItem] = Field(default_factory=list)
    evaluation: GameEvaluation | None = None


class StrategyDeviationsResponse(BaseModel):
    strategy_id: str
    total: int = 0
    """Comparable preflop decisions vs charts."""
    decisions: int = 0
    correct: int = 0
    correct_pct: float = 100.0
    """RFI / open accuracy."""
    open_decisions: int = 0
    open_correct: int = 0
    open_pct: float = 100.0
    """Non-open preflop (vs open, 3-bet, squeeze, …)."""
    play_decisions: int = 0
    play_correct: int = 0
    play_pct: float = 100.0
    opens: PreflopOpenBreakdown = Field(default_factory=PreflopOpenBreakdown)
    by_spot: list[PreflopSpotAccuracy] = Field(default_factory=list)
    by_position: list[PreflopPositionOpenRow] = Field(default_factory=list)
    by_branch: list[PreflopBranchAccuracy] = Field(default_factory=list)
    """HU after flop: pot tag + matchup `BBvsSB` (exactly 2 players)."""
    hu_pot_branches: list[HuPotBranchRow] = Field(default_factory=list)
    chart_errors: list[ChartErrorSpot] = Field(default_factory=list)
    deviations: list[StrategyDeviationRow] = Field(default_factory=list)
    leak_finder: LeakFinderReport = Field(default_factory=LeakFinderReport)


class TrainerDealResponse(BaseModel):
    strategy_id: str
    hand_id: str
    hand_code: str
    spot_key: str
    spot_label: str
    hero_position: str | None = None
    villain_position: str | None = None
    """Index of hero's decision action in hand.actions."""
    decision_index: int
    """Replay actionIndex to show (just before hero acts)."""
    pause_at: int
    pool_size: int = 0
    hand: ReplayHand


class TrainerGradeRequest(BaseModel):
    hand_id: str
    action: str


class TrainerGradeResponse(BaseModel):
    hand_id: str
    correct: bool
    chosen: str
    expected_action: str
    raise_freq: float
    call_freq: float
    fold_freq: float
    in_range: bool
    spot_label: str
    hand_code: str
    tip: str
    played_in_hh: str | None = None
    hand: ReplayHand


class EnsuredSpotInfo(BaseModel):
    spot_key: str
    hero_position: str
    villain_position: str | None = None
    label: str = ""
    """How many HH hands map to this branch (for UI)."""
    hands_count: int = 0
    """Net $ / bb for those hands (optional; filled when listing missing)."""
    profit_money: float = 0.0
    profit_bb: float = 0.0


class MissingSpotsResponse(BaseModel):
    strategy_id: str
    missing_count: int = 0
    missing: list[EnsuredSpotInfo] = Field(default_factory=list)


class EnsureSpotsResponse(BaseModel):
    strategy_id: str
    created_count: int = 0
    created: list[EnsuredSpotInfo] = Field(default_factory=list)
