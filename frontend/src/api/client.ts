const API_BASE = String(import.meta.env.VITE_API_BASE ?? "")
  .trim()
  .replace(/^["']|["']$/g, "")
  .replace(/\/$/, "");

const COLD_START_MS = 120_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

function networkErrorMessage(err: unknown): string {
  if (isAbortError(err)) {
    return "Сервер долго просыпается (Free Render). Подождите ~1 мин и нажмите ещё раз.";
  }
  const target = API_BASE || "(этот же сайт)";
  return `Нет связи с API ${target}. На Free Render сервис засыпает — подождите ~1 мин и повторите. Лучше открывать сайт с домена API (same-origin), без отдельного Static Site.`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  needs_nickname?: boolean;
};

export type Strategy = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  format?: string;
  table_size?: string;
  stack_depth?: string;
  mtt_stage?: string | null;
  action_mode?: string;
};

export type StrategyCreatePayload = {
  name: string;
  description?: string;
  format?: string;
  table_size?: string;
  stack_depth?: string;
  mtt_stage?: string | null;
  action_mode?: string | null;
  is_default?: boolean;
};

export type User = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  plan_id?: string;
  plan_started_at?: string | null;
  created_at?: string;
  is_admin?: boolean;
};

/** Shared /auth/me cache — keeps nickname gate from bouncing after setNickname. */
let cachedMe: User | null = null;
let cachedMeAt = 0;
const ME_CACHE_MS = 90_000;

export function getCachedMe(): User | null {
  if (!cachedMe) return null;
  if (Date.now() - cachedMeAt > ME_CACHE_MS) return null;
  return cachedMe;
}

export function setCachedMe(user: User | null) {
  cachedMe = user;
  cachedMeAt = user ? Date.now() : 0;
}

export function clearCachedMe() {
  cachedMe = null;
  cachedMeAt = 0;
}

/**
 * Ping API until awake. Free Render often resets the first connection —
 * retry in a loop instead of a single long fetch.
 */
export async function wakeApi(timeoutMs = COLD_START_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const slice = Math.min(40_000, Math.max(5_000, deadline - Date.now()));
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), slice);
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
      if (res.ok) return true;
    } catch {
      /* cold start / connection reset — keep trying */
    } finally {
      window.clearTimeout(timer);
    }
    await sleep(Math.min(4_000, 800 * attempt));
  }
  return false;
}

let keepAliveTimer: number | undefined;

/** While the tab is open, ping /health so Free Render stays warm. */
export function startApiKeepAlive(intervalMs = 4 * 60_000) {
  if (keepAliveTimer !== undefined) return;
  const tick = () => {
    void fetch(`${API_BASE}/health`).catch(() => {});
  };
  tick();
  keepAliveTimer = window.setInterval(tick, intervalMs);
}

export function stopApiKeepAlive() {
  if (keepAliveTimer !== undefined) {
    window.clearInterval(keepAliveTimer);
    keepAliveTimer = undefined;
  }
}

export type PlanInfo = {
  id: string;
  name: string;
  tagline: string;
  price_usd: number;
  price_rub: number;
  max_strategies: number | null;
  max_hands_per_month: number | null;
  features: string[];
  highlights: string[];
  is_hit: boolean;
  unlimited_strategies: boolean;
  unlimited_hands: boolean;
};

export type SubscriptionInfo = {
  plan: PlanInfo;
  plan_started_at: string | null;
  usage: {
    strategies: number;
    strategies_limit: number | null;
    hands_month: number;
    hands_month_limit: number | null;
    quota_month: string;
  };
  plans: PlanInfo[];
  features: string[];
};

export type RegisterResponse = {
  email: string;
  message: string;
  needs_verification: boolean;
  dev_code?: string | null;
};

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refresh = localStorage.getItem("refresh_token");
    if (!refresh) return false;
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const tokens = (await res.json()) as TokenResponse;
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  _retried = false,
  _netAttempt = 0,
): Promise<T> {
  // Empty API_BASE = same origin (UI served from the FastAPI host).
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = localStorage.getItem("access_token");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // Free Render cold start — default unless caller already set a signal.
  let ownTimer: number | undefined;
  let signal = init?.signal;
  if (!signal) {
    const ctrl = new AbortController();
    signal = ctrl.signal;
    ownTimer = window.setTimeout(() => ctrl.abort(), COLD_START_MS);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal,
    });
  } catch (err) {
    if (ownTimer !== undefined) window.clearTimeout(ownTimer);
    // First connection often dies while the free dyno boots — wake and retry.
    if (!isAbortError(err) && _netAttempt < 2) {
      await wakeApi(COLD_START_MS);
      return request<T>(path, init, _retried, _netAttempt + 1);
    }
    throw new Error(networkErrorMessage(err));
  } finally {
    if (ownTimer !== undefined) window.clearTimeout(ownTimer);
  }
  if (!res.ok) {
    // Soft-fail network-ish proxy errors — never wipe the session.
    if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/refresh") {
      if (!_retried && (await tryRefreshAccessToken())) {
        return request<T>(path, init, true, _netAttempt);
      }
      // Only clear after refresh failed — real auth rejection.
      clearCachedMe();
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
    }
    let message = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string | { msg?: string }[] };
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) {
        message = body.detail.map((d) => d.msg).filter(Boolean).join("; ");
      }
    } catch {
      /* keep statusText */
    }
    throw new Error(message || `Ошибка запроса (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function login(email: string, password: string) {
  // Free Render cold start can take 50–90s.
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 90000);
  return request<TokenResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    signal: ctrl.signal,
  })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          "Сервер долго просыпается (Free Render). Подождите минуту и попробуйте снова.",
        );
      }
      throw err;
    })
    .finally(() => window.clearTimeout(timer));
}

export function register(
  email: string,
  password: string,
  passwordConfirm: string,
  referralCode?: string,
  acceptedTerms = false,
) {
  return request<RegisterResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      password_confirm: passwordConfirm,
      referral_code: referralCode?.trim() ? referralCode.trim() : null,
      accepted_terms: acceptedTerms,
    }),
  });
}

export function verifyEmail(email: string, code: string) {
  return request<TokenResponse>("/api/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export function resendCode(email: string) {
  return request<RegisterResponse>("/api/auth/resend-code", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function setNickname(display_name: string) {
  await wakeApi();
  const user = await request<User>("/api/auth/nickname", {
    method: "PATCH",
    body: JSON.stringify({ display_name }),
  });
  setCachedMe(user);
  return user;
}

export async function getMe() {
  const user = await request<User>("/api/auth/me");
  setCachedMe(user);
  return user;
}

export type ProfileTopHand = {
  token: string;
  path: string;
  likes_count: number;
  hero_hand: string | null;
  hero_position: string | null;
  played_at: string | null;
  hero_net: number | null;
};

export type ProfileStats = {
  registered_at: string;
  rating: number;
  likes_received: number;
  shares_count: number;
  top_hands: ProfileTopHand[];
};

export function getProfileStats() {
  return request<ProfileStats>("/api/auth/me/stats");
}

export type SupportTicketPayload = {
  site_nick: string;
  email: string;
  topic: string;
  message: string;
};

export function submitSupportTicket(payload: SupportTicketPayload) {
  return request<{ ok: boolean; message: string }>("/api/support/tickets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getSubscription() {
  return request<SubscriptionInfo>("/api/billing/subscription");
}

export function selectPlan(planId: string) {
  return request<SubscriptionInfo>("/api/billing/select-plan", {
    method: "POST",
    body: JSON.stringify({ plan_id: planId }),
  });
}

export type DeleteAccountResponse = {
  message: string;
  uploads_archived: number;
  sessions_archived: number;
};

/** Irreversible. Requires confirmation === "DELETE". Hands kept in system archive. */
export function deleteAccount(confirmation: string) {
  return request<DeleteAccountResponse>("/api/auth/account", {
    method: "DELETE",
    body: JSON.stringify({ confirmation }),
  });
}

export type StrategyDetail = Strategy & {
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type SpotPayload = {
  spot_key: string;
  hero_position: string;
  villain_position?: string | null;
  stack_bb_min?: number | string | null;
  stack_bb_max?: number | string | null;
  label?: string | null;
  sort_order?: number;
};

export type CellPayload = {
  hand_code: string;
  raise_freq: number;
  call_freq: number;
  fold_freq: number;
};

export type StrategySpot = {
  id: string;
  strategy_id: string;
  spot_key: string;
  hero_position: string;
  villain_position: string | null;
  stack_bb_min: string | null;
  stack_bb_max: string | null;
  label: string | null;
  sort_order: number;
};

export type StrategyCell = {
  id: string;
  spot_id: string;
  hand_code: string;
  raise_freq: string | number;
  call_freq: string | number;
  fold_freq: string | number;
};

export function listStrategies() {
  return request<Strategy[]>("/api/strategies");
}

export function createStrategy(nameOrPayload: string | StrategyCreatePayload, description?: string) {
  const body: StrategyCreatePayload =
    typeof nameOrPayload === "string"
      ? { name: nameOrPayload, description }
      : nameOrPayload;
  return request<Strategy>("/api/strategies", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getStrategy(strategyId: string) {
  return request<StrategyDetail>(`/api/strategies/${strategyId}`);
}

export type GameTreeRemote = {
  tree: Record<string, unknown> | null;
};

export function getStrategyTree(strategyId: string) {
  return request<GameTreeRemote>(`/api/strategies/${strategyId}/tree`);
}

export function putStrategyTree(strategyId: string, tree: Record<string, unknown>) {
  return request<GameTreeRemote>(`/api/strategies/${strategyId}/tree`, {
    method: "PUT",
    body: JSON.stringify({ tree }),
  });
}

export type HudStat = {
  key: string;
  label: string;
  value: number | null;
  /** Opportunities (H2N sample) — same as opportunities */
  samples: number;
  cases?: number;
  opportunities?: number;
  unit: "pct" | "bb100" | "money" | "count" | "ratio" | string;
};

export type PositionHudRow = {
  position: string;
  hands: number;
  vpip: number | null;
  pfr: number | null;
  three_bet: number | null;
  winrate_bb100: number | null;
  profit_bb: number;
};

export type AnalysisCurvePoint = {
  hand_index: number;
  cum_total_bb: number;
  cum_wwsd_bb: number;
  cum_wsd_bb: number;
  cum_total_money: number;
  cum_wwsd_money: number;
  cum_wsd_money: number;
  cum_ev_bb?: number;
  cum_ev_money?: number;
  compliance_rate?: number;
};

export type StrategyAnalysis = {
  strategy_id: string;
  hands: number;
  winrate_bb100: number | null;
  total_profit_bb: number;
  total_profit_money: number;
  stats: HudStat[];
  by_position: PositionHudRow[];
  curve: AnalysisCurvePoint[];
};

export function fetchStrategyAnalysis(strategyId: string, signal?: AbortSignal) {
  return request<StrategyAnalysis>(`/api/strategies/${strategyId}/analysis`, { signal });
}

/** Instant HUD from pre-aggregated cases/opportunities (no full hand scan). */
export type AggregatedHudReport = {
  database_id: string | null;
  game_type: string;
  hands: number;
  stats: HudStat[];
  by_position: Array<{
    position: string;
    hands: number;
    vpip: number | null;
    vpip_cases: number;
    vpip_opportunities: number;
    pfr: number | null;
    pfr_cases: number;
    pfr_opportunities: number;
    three_bet: number | null;
    three_bet_cases: number;
    three_bet_opportunities: number;
  }>;
  source: string;
};

export function fetchAggregatedHud(query: {
  gameType?: string;
  databaseId?: string;
  signal?: AbortSignal;
} = {}) {
  const params = new URLSearchParams();
  if (query.gameType) params.set("game_type", query.gameType);
  if (query.databaseId) params.set("database_id", query.databaseId);
  const q = params.toString();
  return request<AggregatedHudReport>(`/api/hud/aggregated${q ? `?${q}` : ""}`, {
    signal: query.signal,
  });
}

export type ReplaySeat = {
  seat: number;
  name: string;
  position: string | null;
  stack: number | null;
  is_hero: boolean;
  is_button: boolean;
  cards: string | null;
};

export type ReplayAction = {
  street: string;
  order: number;
  player_name: string;
  is_hero: boolean;
  action: string;
  amount: number | null;
};

export type ReplayHand = {
  id: string;
  external_hand_id: string;
  played_at: string | null;
  table_name: string | null;
  small_blind: number | null;
  big_blind: number | null;
  hero_name: string | null;
  hero_position: string | null;
  hero_cards: string[];
  board: string[];
  hero_net: number;
  hero_net_bb: number;
  seats: ReplaySeat[];
  actions: ReplayAction[];
  raw_text: string;
};

export type StatHandsResponse = {
  strategy_id: string;
  stat: string;
  label: string;
  total_matched: number;
  hands: ReplayHand[];
};

export function fetchStatHands(strategyId: string, stat: string, limit = 150) {
  const q = new URLSearchParams({ stat, limit: String(limit) });
  return request<StatHandsResponse>(`/api/strategies/${strategyId}/analysis/hands?${q}`);
}

export function fetchStrategyHuPotHands(
  strategyId: string,
  potKind: string,
  matchup: string,
  limit = 150,
) {
  const q = new URLSearchParams({
    pot_kind: potKind,
    matchup,
    limit: String(limit),
  });
  return request<StatHandsResponse>(
    `/api/strategies/${strategyId}/analysis/hu-hands?${q}`,
  );
}

export function fetchResultsHuPotHands(query: {
  potKind: string;
  matchup: string;
  sessionId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}) {
  const q = new URLSearchParams({
    pot_kind: query.potKind,
    matchup: query.matchup,
    limit: String(query.limit ?? 150),
  });
  if (query.sessionId) q.set("session_id", query.sessionId);
  if (query.dateFrom) q.set("date_from", query.dateFrom);
  if (query.dateTo) q.set("date_to", query.dateTo);
  return request<StatHandsResponse>(`/api/uploads/results/hu-hands?${q}`);
}

export type StrategyDeviation = {
  id: string;
  hand_id: string;
  hand_code: string;
  actual_action: string;
  expected_action: string;
  actual_freq: number | null;
  expected_freq: number | null;
  severity: number | null;
  spot_key: string | null;
  spot_label: string | null;
  hero_position: string | null;
  villain_position?: string | null;
  external_hand_id: string | null;
  played_at: string | null;
  hero_net_bb: number;
  missed_ev_money?: number;
};

export type LeakInsight = {
  id: string;
  title: string;
  score_pct: number | null;
  status: string;
  hint: string;
};

export type LeakHeatCell = {
  hand_code: string;
  errors: number;
  lost_money: number;
};

export type LeakFinderReport = {
  missed_profit_money: number;
  critical_errors: number;
  insights: LeakInsight[];
  heat: LeakHeatCell[];
};

export type PreflopSpotAccuracy = {
  spot_key: string;
  label: string;
  decisions: number;
  correct: number;
  correct_pct: number;
};

export type PreflopOpenBreakdown = {
  decisions: number;
  opened: number;
  folded: number;
  called: number;
  should_open: number;
  opened_correct: number;
  missed_opens: number;
  should_fold: number;
  folded_correct: number;
  wrong_opens: number;
  open_follow_pct: number;
  fold_follow_pct: number;
  accuracy_pct: number;
};

export type PreflopPositionOpenRow = {
  position: string;
  decisions: number;
  opened: number;
  folded: number;
  called: number;
  should_open: number;
  opened_correct: number;
  missed_opens: number;
  should_fold: number;
  folded_correct: number;
  wrong_opens: number;
  accuracy_pct: number;
};

export type PreflopBranchAccuracy = {
  spot_key: string;
  spot_label: string;
  hero_position: string;
  villain_position: string | null;
  pot_kind?: string;
  pot_tag?: string;
  matchup?: string;
  decisions: number;
  correct: number;
  correct_pct: number;
  profit_money?: number;
  profit_bb?: number;
  winrate_bb100?: number;
};

export type ChartErrorCell = {
  hand_code: string;
  opens?: number;
  errors: number;
  /** Error counts by hero's actual action */
  raise_count?: number;
  call_count?: number;
  fold_count?: number;
  actual_action: string | null;
  expected_action: string | null;
};

export type ChartErrorSpot = {
  spot_key: string;
  hero_position: string;
  villain_position: string | null;
  label: string;
  /** Constructor pot kind when grouped by tree branch (`srp` / `3bp` / …). */
  pot_kind?: string | null;
  /** Painted strategy spot used for scoring — load cells by this id. */
  spot_id?: string | null;
  cells: ChartErrorCell[];
};

export type StrategyDeviationsResponse = {
  strategy_id: string;
  total: number;
  decisions?: number;
  correct?: number;
  correct_pct?: number;
  open_decisions?: number;
  open_correct?: number;
  open_pct?: number;
  play_decisions?: number;
  play_correct?: number;
  play_pct?: number;
  opens?: PreflopOpenBreakdown;
  by_spot?: PreflopSpotAccuracy[];
  by_position?: PreflopPositionOpenRow[];
  by_branch?: PreflopBranchAccuracy[];
  /** HU after flop pots: pot + matchup like BBvsSB */
  hu_pot_branches?: BranchProfitRow[];
  chart_errors?: ChartErrorSpot[];
  deviations: StrategyDeviation[];
  leak_finder?: LeakFinderReport;
};

export function fetchStrategyDeviations(strategyId: string, limit = 300, signal?: AbortSignal) {
  const q = new URLSearchParams({ limit: String(limit) });
  return request<StrategyDeviationsResponse>(`/api/strategies/${strategyId}/deviations?${q}`, {
    signal,
  });
}

export type RecommendationHandItem = {
  hand_id: string;
  external_hand_id: string;
  hand_code: string;
  hero_cards: string;
  position: string;
  street: string;
  board: string[];
  pot_before: number;
  bet_amount: number;
  actual_action: string;
  correct_action: string;
  lost_money: number;
  ev_loss: number;
  pot_odds_pct: number | null;
  equity_pct: number | null;
  outs: number | null;
  title: string;
  analysis: string;
  example: string;
  text: string;
};

export type PlanChecklistItem = {
  priority: number;
  text: string;
};

export type HudEvalItem = {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  samples: number;
  target_min: number | null;
  target_max: number | null;
  status: "low" | "ok" | "high" | "unknown" | string;
  score: number;
  recommendation: string;
};

export type GameEvaluation = {
  score: number;
  label: string;
  summary: string;
  hands: number;
  confidence: "low" | "medium" | "high" | string;
  math_score: number;
  hud_score: number;
  hud: HudEvalItem[];
  focus: string[];
};

export type RecommendationsResponse = {
  strategy_id: string;
  hands_count?: number;
  math_errors: number;
  total_damage_money: number;
  discipline: RecommendationHandItem[];
  critical_damage: RecommendationHandItem[];
  pot_odds: RecommendationHandItem[];
  plan: PlanChecklistItem[];
  evaluation: GameEvaluation | null;
};

export function fetchStrategyRecommendations(strategyId: string, signal?: AbortSignal) {
  return request<RecommendationsResponse>(`/api/strategies/${strategyId}/recommendations`, {
    signal,
  });
}

export type EnsuredSpotInfo = {
  spot_key: string;
  hero_position: string;
  villain_position: string | null;
  label: string;
  hands_count?: number;
  profit_money?: number;
  profit_bb?: number;
};

export type MissingSpotsResponse = {
  strategy_id: string;
  missing_count: number;
  missing: EnsuredSpotInfo[];
};

export type EnsureSpotsResponse = {
  strategy_id: string;
  created_count: number;
  created: EnsuredSpotInfo[];
};

/** List HH branches not yet in the strategy (read-only). */
export function fetchMissingSpots(strategyId: string, signal?: AbortSignal) {
  return request<MissingSpotsResponse>(`/api/strategies/${strategyId}/missing-spots`, { signal });
}

/** Opt-in: create strategy spots for missing HH branches. */
export function ensureStrategySpots(strategyId: string) {
  return request<EnsureSpotsResponse>(`/api/strategies/${strategyId}/ensure-spots`, {
    method: "POST",
  });
}

export function fetchHandReplay(strategyId: string, handId: string) {
  return request<ReplayHand>(`/api/strategies/${strategyId}/hands/${handId}/replay`);
}

export type TrainerDeal = {
  strategy_id: string;
  hand_id: string;
  hand_code: string;
  spot_key: string;
  spot_label: string;
  hero_position: string | null;
  villain_position: string | null;
  decision_index: number;
  pause_at: number;
  pool_size: number;
  hand: ReplayHand;
};

export type TrainerGrade = {
  hand_id: string;
  correct: boolean;
  chosen: string;
  expected_action: string;
  raise_freq: number;
  call_freq: number;
  fold_freq: number;
  in_range: boolean;
  spot_label: string;
  hand_code: string;
  tip: string;
  played_in_hh: string | null;
  hand: ReplayHand;
};

export function fetchTrainerDeal(
  strategyId: string,
  opts?: {
    mode?: "all" | "errors";
    exclude?: string[];
    positions?: string[];
    spots?: string[];
  },
) {
  const q = new URLSearchParams();
  if (opts?.mode) q.set("mode", opts.mode);
  if (opts?.exclude?.length) q.set("exclude", opts.exclude.join(","));
  if (opts?.positions?.length) q.set("positions", opts.positions.join(","));
  if (opts?.spots?.length) q.set("spots", opts.spots.join(","));
  const qs = q.toString();
  return request<TrainerDeal>(
    `/api/strategies/${strategyId}/trainer/next${qs ? `?${qs}` : ""}`,
  );
}

export function gradeTrainerDeal(
  strategyId: string,
  handId: string,
  action: "fold" | "call" | "raise",
) {
  return request<TrainerGrade>(`/api/strategies/${strategyId}/trainer/grade`, {
    method: "POST",
    body: JSON.stringify({ hand_id: handId, action }),
  });
}

export type HandShare = {
  token: string;
  path: string;
};

export function createHandShare(handId: string) {
  return request<HandShare>(`/api/hands/${handId}/share`, { method: "POST" });
}

/** Share a specific replay snapshot — works for local / unsynced hands (auth required). */
export function createHandShareFromReplay(hand: {
  raw_text: string;
  external_hand_id?: string | null;
  played_at?: string | null;
  table_name?: string | null;
  small_blind?: number | null;
  big_blind?: number | null;
  hero_name?: string | null;
  hero_position?: string | null;
  hero_cards?: string[];
  hero_net?: number | null;
  hero_net_bb?: number | null;
  board?: string[];
  actions: Array<{
    street: string;
    order: number;
    player_name: string;
    is_hero: boolean;
    action: string;
    amount: number | null;
  }>;
}) {
  const heroHand =
    hand.hero_cards && hand.hero_cards.length >= 2
      ? `${hand.hero_cards[0]}${hand.hero_cards[1]}`.replace(/\s+/g, "").slice(0, 4)
      : undefined;
  return request<HandShare>("/api/hands/share", {
    method: "POST",
    body: JSON.stringify({
      raw_text: hand.raw_text || `Hand #${hand.external_hand_id || "share"}`,
      external_hand_id: hand.external_hand_id || undefined,
      played_at: hand.played_at || undefined,
      table_name: hand.table_name || undefined,
      small_blind: hand.small_blind ?? undefined,
      big_blind: hand.big_blind ?? undefined,
      hero_name: hand.hero_name || undefined,
      hero_position: hand.hero_position || undefined,
      hero_hand: heroHand,
      hero_net: hand.hero_net ?? undefined,
      hero_net_bb: hand.hero_net_bb ?? undefined,
      board: hand.board?.length ? hand.board : undefined,
      actions: (hand.actions || []).map((a) => ({
        street: a.street,
        action_order: a.order,
        player_name: a.player_name,
        is_hero: a.is_hero,
        action: a.action,
        amount: a.amount,
      })),
    }),
  });
}

/** @deprecated use createHandShareFromReplay */
export function createHandShareFromText(payload: {
  raw_text: string;
  external_hand_id?: string | null;
}) {
  return createHandShareFromReplay({
    raw_text: payload.raw_text,
    external_hand_id: payload.external_hand_id,
    actions: [],
  });
}

/** Public replay — no auth required; does not clear tokens on failure. */
export async function fetchPublicHandReplay(token: string) {
  const res = await fetch(`${API_BASE}/api/public/hands/${encodeURIComponent(token)}/replay`);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(message || "Раздача недоступна");
  }
  return (await res.json()) as ReplayHand;
}

export type ShareStreet = "preflop" | "flop" | "turn" | "river";

export type HandShareComment = {
  id: string;
  street: ShareStreet;
  body: string;
  author_name: string;
  is_mine: boolean;
  likes_count: number;
  liked_by_me: boolean;
  created_at: string | null;
};

export type HandShareSocial = {
  likes_count: number;
  liked_by_me: boolean;
  comments: HandShareComment[];
  my_comments_by_street: Partial<Record<ShareStreet, string>>;
};

export function fetchHandShareSocial(token: string) {
  return request<HandShareSocial>(
    `/api/public/hands/${encodeURIComponent(token)}/social`,
  );
}

export function postHandShareComment(token: string, street: ShareStreet, body: string) {
  return request<HandShareSocial>(
    `/api/public/hands/${encodeURIComponent(token)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ street, body }),
    },
  );
}

export function toggleHandShareLike(token: string) {
  return request<{ likes_count: number; liked_by_me: boolean }>(
    `/api/public/hands/${encodeURIComponent(token)}/like`,
    { method: "POST" },
  );
}

export function toggleHandShareCommentLike(token: string, commentId: string) {
  return request<{ comment_id: string; likes_count: number; liked_by_me: boolean }>(
    `/api/public/hands/${encodeURIComponent(token)}/comments/${encodeURIComponent(commentId)}/like`,
    { method: "POST" },
  );
}

export function deleteStrategy(strategyId: string) {
  return request<void>(`/api/strategies/${strategyId}`, { method: "DELETE" });
}

export function listSpots(strategyId: string, signal?: AbortSignal) {
  return request<StrategySpot[]>(`/api/strategies/${strategyId}/spots`, { signal });
}

export function createSpot(strategyId: string, payload: SpotPayload) {
  return request<StrategySpot>(`/api/strategies/${strategyId}/spots`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteSpot(spotId: string) {
  return request<void>(`/api/strategies/spots/${spotId}`, { method: "DELETE" });
}

export function listCells(spotId: string) {
  return request<StrategyCell[]>(`/api/strategies/spots/${spotId}/cells`);
}

export function upsertCells(spotId: string, cells: CellPayload[]) {
  return request<StrategyCell[]>(`/api/strategies/spots/${spotId}/cells`, {
    method: "PUT",
    body: JSON.stringify({ cells }),
  });
}

export type UploadReport = {
  upload_id: string;
  session_id: string | null;
  session_label: string | null;
  status: string;
  hands_count: number;
  duplicates_skipped: number;
  hands_with_decision: number;
  deviations_count: number;
  correct_count: number;
  error_message: string | null;
  strategy_id: string | null;
  original_filename: string;
  room: string | null;
  restored?: boolean;
};

export type PlaySession = {
  id: string;
  user_id: string;
  strategy_id: string | null;
  upload_id: string | null;
  room: string;
  label: string;
  source_filename: string;
  table_name: string | null;
  small_blind: string | number | null;
  big_blind: string | number | null;
  max_seats: number | null;
  started_at: string | null;
  ended_at: string | null;
  hands_count: number;
  hands_with_decision: number;
  deviations_count: number;
  correct_count: number;
  created_at: string;
  /** active | archived */
  status: string;
  upload_status?: string;
};

export type BatchUploadReport = {
  uploads: UploadReport[];
  sessions: PlaySession[];
  files_count: number;
  total_hands: number;
  total_duplicates_skipped: number;
  total_deviations: number;
  total_correct: number;
};

export type Deviation = {
  id: string;
  hand_id: string;
  strategy_id: string;
  spot_id: string | null;
  hand_code: string;
  actual_action: string;
  expected_action: string;
  actual_freq: string | number | null;
  expected_freq: string | number | null;
  severity: string | number | null;
  created_at: string;
};

export function uploadHands(files: File | File[], strategyId: string) {
  const form = new FormData();
  const list = Array.isArray(files) ? files : [files];
  for (const file of list) form.append("files", file);
  form.append("strategy_id", strategyId);
  // Large HH can take a few minutes — keep progress pulse alive until then.
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 4 * 60 * 1000);
  return request<BatchUploadReport>("/api/uploads", {
    method: "POST",
    body: form,
    signal: ctrl.signal,
  })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          "Сервер слишком долго разбирает раздачи (более 4 мин). Перезапустите backend и попробуйте снова.",
        );
      }
      throw err;
    })
    .finally(() => window.clearTimeout(timer));
}

export type ClientHandsSyncResponse = {
  session_id: string;
  upload_id: string;
  database_id: string;
  hands_saved: number;
  duplicates_skipped: number;
  label: string;
};

/** Store PC-parsed hands in the active profile DB (no server HH parse). */
export function syncClientHands(payload: {
  strategy_id: string;
  label?: string;
  source_filename?: string;
  room?: string;
  hands: unknown[];
  session_id?: string;
  finalize?: boolean;
}) {
  const ctrl = new AbortController();
  // Chunked sync can take a while for large sessions.
  const timer = window.setTimeout(() => ctrl.abort(), 8 * 60 * 1000);
  return request<ClientHandsSyncResponse>("/api/uploads/client-hands", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  })
    .catch((err: unknown) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(
          "Синхронизация в профиль заняла слишком долго. Проверьте backend и попробуйте снова.",
        );
      }
      throw err;
    })
    .finally(() => window.clearTimeout(timer));
}

export type AnalysisSnapshotUploadResponse = {
  session_id: string;
  snapshot_id: string | null;
  database_id: string;
  hands_saved: number;
  hands_total?: number;
  finalize?: boolean;
  label: string;
  /** Precomputed career report — Report tab reads this, no rebuild. */
  career_report?: ResultsReport | null;
};

export type AnalysisSnapshotRead = {
  snapshot_id: string;
  session_id: string;
  strategy_id: string | null;
  database_id: string | null;
  hands_count: number;
  label: string;
  source_filename: string;
  created_at: string | null;
  report: Record<string, unknown>;
};

export type AnalysisSnapshotUploadProgress = {
  /** Bytes sent so far (upload phase). */
  loaded: number;
  /** Total body size in bytes. */
  total: number;
  /** 0–100 of the HTTP upload body. */
  percent: number;
  /** uploading = bytes on the wire; waiting = server processing response. */
  phase: "uploading" | "waiting";
};

/**
 * One-shot upload of PC analysis report + compact hands (no HH text).
 * Uses XHR so we can show megabyte progress on large sessions.
 */
export function uploadAnalysisSnapshot(
  payload: {
    strategy_id: string;
    label?: string;
    source_filename?: string;
    room?: string;
    started_at?: string | null;
    ended_at?: string | null;
    report: Record<string, unknown>;
    hands: unknown[];
    session_id?: string;
    finalize?: boolean;
  },
  opts?: {
    body?: string;
    onUploadProgress?: (p: AnalysisSnapshotUploadProgress) => void;
  },
): Promise<AnalysisSnapshotUploadResponse> {
  const body = opts?.body ?? JSON.stringify(payload);
  const totalBytes = new TextEncoder().encode(body).length;
  const onUploadProgress = opts?.onUploadProgress;

  const sendOnce = (retried: boolean): Promise<AnalysisSnapshotUploadResponse> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/api/uploads/analysis-snapshot`);
      xhr.setRequestHeader("Content-Type", "application/json");
      const token = localStorage.getItem("access_token");
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.timeout = 4 * 60 * 1000;
      xhr.responseType = "text";

      xhr.upload.onprogress = (ev) => {
        if (!onUploadProgress) return;
        const total = ev.lengthComputable && ev.total > 0 ? ev.total : totalBytes;
        const loaded = Math.min(ev.loaded, total);
        onUploadProgress({
          loaded,
          total,
          percent: total > 0 ? Math.min(100, Math.round((100 * loaded) / total)) : 0,
          phase: "uploading",
        });
      };

      xhr.upload.onload = () => {
        onUploadProgress?.({
          loaded: totalBytes,
          total: totalBytes,
          percent: 100,
          phase: "waiting",
        });
      };

      xhr.onload = () => {
        void (async () => {
          if (xhr.status === 401 && !retried) {
            const ok = await tryRefreshAccessToken();
            if (ok) {
              try {
                resolve(await sendOnce(true));
              } catch (err) {
                reject(err);
              }
              return;
            }
            localStorage.removeItem("access_token");
            localStorage.removeItem("refresh_token");
          }
          if (xhr.status === 401) {
            reject(new Error("Сессия истекла. Войдите снова."));
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            let message = xhr.statusText || "Ошибка загрузки";
            try {
              const parsed = JSON.parse(xhr.responseText || "{}") as {
                detail?: string | { msg?: string }[];
              };
              if (typeof parsed.detail === "string") message = parsed.detail;
            } catch {
              /* keep statusText */
            }
            reject(new Error(message || "Ошибка загрузки отчёта"));
            return;
          }
          try {
            resolve(JSON.parse(xhr.responseText) as AnalysisSnapshotUploadResponse);
          } catch {
            reject(new Error("Сервер вернул некорректный ответ"));
          }
        })();
      };

      xhr.onerror = () => {
        reject(new Error("Сервер не отвечает. Проверьте, что backend запущен."));
      };
      xhr.ontimeout = () => {
        reject(
          new Error(
            "Загрузка отчёта заняла слишком долго. Проверьте backend и попробуйте снова.",
          ),
        );
      };

      onUploadProgress?.({
        loaded: 0,
        total: totalBytes,
        percent: 0,
        phase: "uploading",
      });
      xhr.send(body);
    });

  return sendOnce(false);
}

export function getAnalysisSnapshot(strategyId?: string, signal?: AbortSignal) {
  const q = strategyId ? `?strategy_id=${encodeURIComponent(strategyId)}` : "";
  return request<AnalysisSnapshotRead>(`/api/uploads/analysis-snapshot${q}`, { signal });
}

export function listSessions(signal?: AbortSignal) {
  return request<PlaySession[]>("/api/uploads/sessions", { signal });
}

export function listUploads() {
  return request<
    Array<{
      id: string;
      original_filename: string;
      status: string;
      hands_count: number;
      uploaded_at: string;
      session_id: string | null;
    }>
  >("/api/uploads");
}

export function getUploadReport(uploadId: string) {
  return request<UploadReport>(`/api/uploads/${uploadId}/report`);
}

export function listDeviations(uploadId: string) {
  return request<Deviation[]>(`/api/uploads/${uploadId}/deviations`);
}

export function listSessionDeviations(sessionId: string) {
  return request<Deviation[]>(`/api/uploads/sessions/${sessionId}/deviations`);
}

export type CurvePoint = {
  hand_index: number;
  cum_bb: number;
  cum_money: number;
  cum_wwsd_bb: number;
  cum_wsd_bb: number;
  cum_wwsd_money: number;
  cum_wsd_money: number;
  hand_bb: number;
  hand_money: number;
  played_at: string | null;
  session_id: string | null;
};

export type SessionProfitRow = {
  id: string;
  label: string;
  room: string;
  source_filename: string;
  started_at: string | null;
  hands_count: number;
  profit_money: number;
  profit_bb: number;
  winrate_bb100: number;
  /** Parallel tables merged into one play sitting */
  tables_count?: number;
};

export type BranchProfitRow = {
  spot_key: string;
  hero_position: string;
  villain_position: string | null;
  pot_kind?: string;
  pot_tag?: string;
  matchup?: string;
  label: string;
  hands_count: number;
  profit_money: number;
  profit_bb: number;
  winrate_bb100: number;
};

export type ResultsReport = {
  total_hands: number;
  total_profit_money: number;
  total_profit_bb: number;
  winrate_bb100: number;
  wins: number;
  losses: number;
  scratches: number;
  sessions_count: number;
  has_any_data: boolean;
  date_from: string | null;
  date_to: string | null;
  curve: CurvePoint[];
  sessions: SessionProfitRow[];
  top_losing_branches?: BranchProfitRow[];
  top_profitable_branches?: BranchProfitRow[];
};

export type ResultsQuery = {
  sessionId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function getResults(query: ResultsQuery = {}) {
  const params = new URLSearchParams();
  if (query.sessionId) params.set("session_id", query.sessionId);
  if (query.dateFrom) params.set("date_from", query.dateFrom);
  if (query.dateTo) params.set("date_to", query.dateTo);
  const q = params.toString();
  return request<ResultsReport>(`/api/uploads/results${q ? `?${q}` : ""}`);
}

export type StakeRecommendation = {
  label: string;
  big_blind: number;
  buyin_100bb: number;
  role: "soft" | "primary" | "stretch" | string;
  note: string;
  /** True when BR is below the style BI target even for the lowest stake. */
  shortfall?: boolean;
};

export type LimitVerdictDto = {
  status: string;
  headline: string;
  detail: string;
  affordable_buyin?: number;
  required_buyins?: number;
  stop_loss_buyins?: number | null;
  recommended_label?: string | null;
  previous_label?: string | null;
  next_label?: string | null;
};

export type RiskProfile = {
  id: string;
  name: string;
  description: string;
  buyins_range: string;
  buyins_target: number;
  session_tip: string;
  stop_loss_buyins?: number | null;
};

export type BankrollSettings = {
  balance: number;
  currency: string;
  game_mode?: string;
  risk_profile: string;
  risk_profile_name: string;
  risk_description: string;
  buyins_range: string;
  buyins_target: number;
  recommended_buyin: number;
  recommended_stakes: StakeRecommendation[];
  primary_stake: string | null;
  session_tip: string;
  stop_loss_buyins?: number | null;
  limit_verdict?: LimitVerdictDto | null;
  goal_stake?: string | null;
  updated_at: string | null;
};

export type BankrollEntry = {
  id: string;
  kind: string;
  amount: number;
  balance_after: number;
  note: string | null;
  session_id?: string | null;
  created_at: string;
};

export type BankrollOverview = {
  settings: BankrollSettings;
  profiles: RiskProfile[];
  entries: BankrollEntry[];
};

export function getBankroll() {
  return request<BankrollOverview>("/api/career/bankroll");
}

export function updateBankrollProfile(payload: {
  risk_profile?: string;
  game_mode?: string;
  buyins_target?: number;
  currency?: string;
  goal_stake?: string | null;
}) {
  return request<BankrollSettings>("/api/career/bankroll/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function bankrollTxn(payload: { kind: string; amount: number; note?: string }) {
  return request<BankrollOverview>("/api/career/bankroll/txn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/* ── Hand databases (H2N-style) ── */

export type HandDatabase = {
  id: string;
  name: string;
  created_at?: string | null;
  is_active: boolean;
  sessions_count: number;
  hands_count: number;
  hands_limit?: number;
  uploads_count: number;
};

/** Soft limits mirrored from backend (hard check is server-side). */
export const MAX_HANDS_PER_DATABASE = 100_000;
export const MAX_HANDS_PER_ANALYSIS = 100_000;

export async function listHandDatabases() {
  const awake = await wakeApi();
  if (!awake) {
    throw new Error(networkErrorMessage(new Error("wake failed")));
  }
  return request<HandDatabase[]>("/api/databases");
}

export async function createHandDatabase(name: string, switchTo = true) {
  const awake = await wakeApi();
  if (!awake) {
    throw new Error(networkErrorMessage(new Error("wake failed")));
  }
  return request<HandDatabase>("/api/databases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, switch: switchTo }),
  });
}

export async function switchHandDatabase(databaseId: string) {
  return request<HandDatabase>(`/api/databases/${databaseId}/switch`, {
    method: "POST",
  });
}

export async function renameHandDatabase(databaseId: string, name: string) {
  return request<HandDatabase>(`/api/databases/${databaseId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function clearHandDatabase(databaseId: string) {
  return request<{
    database_id: string;
    uploads_deleted: number;
    sessions_deleted: number;
    files_removed: number;
  }>(`/api/databases/${databaseId}/clear`, { method: "POST" });
}

export async function deleteHandDatabase(databaseId: string) {
  return request<{
    database_id: string;
    uploads_deleted: number;
    sessions_deleted: number;
    files_removed: number;
    deleted: boolean;
    reset?: boolean;
    active_database_id?: string | null;
  }>(`/api/databases/${databaseId}`, { method: "DELETE" });
}

export function saveTokens(tokens: TokenResponse) {
  localStorage.setItem("access_token", tokens.access_token);
  localStorage.setItem("refresh_token", tokens.refresh_token);
}

export function clearTokens() {
  clearCachedMe();
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

export function isLoggedIn() {
  return Boolean(localStorage.getItem("access_token"));
}

export function afterAuthPath(tokens: TokenResponse) {
  return tokens.needs_nickname ? "/nickname" : "/strategies";
}

const VISITOR_KEY = "ps_visitor_id";

export function getVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing && existing.length >= 8) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return `v_${Date.now().toString(36)}`;
  }
}

export function trackPageView(path: string, referrer?: string) {
  return request<{ ok: boolean; skipped: boolean }>("/api/analytics/pageview", {
    method: "POST",
    body: JSON.stringify({
      path,
      visitor_id: getVisitorId(),
      referrer: referrer || null,
    }),
  }).catch(() => undefined);
}

export type TrafficWindow = {
  pageviews: number;
  unique_visitors: number;
  unique_users: number;
  registrations: number;
};

export type AdminOverview = {
  today: TrafficWindow;
  days_7: TrafficWindow;
  days_30: TrafficWindow;
  top_paths: { path: string; count: number }[];
  recent: {
    created_at: string;
    path: string;
    visitor_id: string;
    user_id: string | null;
    display_name: string | null;
  }[];
  totals: {
    users: number;
    strategies: number;
    hand_uploads: number;
    hands: number;
  };
};

export function getAdminOverview() {
  return request<AdminOverview>("/api/admin/overview");
}

export type TopLikedHand = {
  token: string;
  path: string;
  likes_count: number;
  views_count: number;
  hero_hand: string | null;
  hero_position: string | null;
  author_name: string | null;
  author_path: string | null;
  played_at: string | null;
  stakes_label: string | null;
  hero_net: number | null;
};

export type PublicProfileHand = {
  token: string;
  path: string;
  likes_count: number;
  views_count: number;
  hero_hand: string | null;
  hero_position: string | null;
  played_at: string | null;
  stakes_label: string | null;
};

export type PublicProfile = {
  display_name: string;
  registered_at: string | null;
  rating: number;
  likes_received: number;
  shares_count: number;
  top_hands: PublicProfileHand[];
};

export function listTopLikedHands(limit = 5) {
  const q = new URLSearchParams({ limit: String(limit) });
  return request<{ items: TopLikedHand[]; total: number }>(`/api/feed/top?${q}`);
}

export function getPublicProfile(displayName: string) {
  return request<PublicProfile>(
    `/api/public/users/${encodeURIComponent(displayName)}`,
  );
}
