/**
 * Math recommendations from the local Analysis session (IndexedDB),
 * not from the server's previous active session.
 */

import type {
  GameEvaluation,
  HudEvalItem,
  PlanChecklistItem,
  RecommendationHandItem,
  RecommendationsResponse,
} from "../api/client";
import { peekAnalysisCache } from "../lib/analysisCache";
import { listHandsForStrategy, type HandRow } from "./localDb";
import { parseHandHistory } from "./parseHh";
import type { ParsedAction, ParsedHand } from "./types";

const RANK_ORDER = "23456789TJQKA";
const OPEN_TOP_PCT: Record<string, number> = {
  UTG: 0.14,
  "UTG+1": 0.16,
  UTG1: 0.16,
  "UTG+2": 0.18,
  UTG2: 0.18,
  MP: 0.2,
  MP1: 0.2,
  HJ: 0.22,
  CO: 0.3,
  BTN: 0.48,
  SB: 0.4,
  BB: 0,
};
const ACTION_RU: Record<string, string> = {
  fold: "Фолд",
  call: "Колл",
  raise: "Рейз",
  check: "Чек",
};
const STREET_RU: Record<string, string> = {
  preflop: "префлопе",
  flop: "флопе",
  turn: "терне",
  river: "ривере",
};

const FLOP_RE = /\*\*\*\s*FLOP\s*\*\*\s*\[([^\]]+)\]/i;
const TURN_RE = /\*\*\*\s*TURN\s*\*\*\s*\[[^\]]+\]\s*\[([^\]]+)\]/i;
const RIVER_RE = /\*\*\*\s*RIVER\s*\*\*\s*\[[^\]]+\]\s*\[([^\]]+)\]/i;
const CARD_RE = /^([2-9TJQKA])([cdhs])$/i;

function parseBoard(raw: string): string[] {
  const board: string[] = [];
  const f = FLOP_RE.exec(raw);
  if (f) {
    for (const p of f[1].trim().split(/\s+/)) if (p.length >= 2) board.push(normCard(p));
  }
  const t = TURN_RE.exec(raw);
  if (t) board.push(normCard(t[1].trim()));
  const r = RIVER_RE.exec(raw);
  if (r) board.push(normCard(r[1].trim()));
  return board;
}

function normCard(c: string): string {
  return c.length >= 2 ? c[0].toUpperCase() + c[1].toLowerCase() : c;
}

function parseHeroCards(heroHand: string | null): string[] {
  if (!heroHand || heroHand.length < 4) return [];
  const a = heroHand.slice(0, 2);
  const b = heroHand.slice(2, 4);
  return CARD_RE.test(a) && CARD_RE.test(b) ? [normCard(a), normCard(b)] : [];
}

function handRankIndex(code: string | null): number {
  if (!code) return 169;
  const c = code.trim().toUpperCase();
  const pairs: Record<string, number> = {
    AA: 1,
    KK: 2,
    QQ: 3,
    JJ: 4,
    TT: 5,
    "99": 8,
    "88": 12,
    "77": 18,
    "66": 28,
    "55": 40,
    "44": 55,
    "33": 70,
    "22": 85,
  };
  if (pairs[c] != null) return pairs[c];
  if (c.length < 2) return 169;
  const r1 = c[0];
  const r2 = c[1];
  const suited = c.endsWith("S");
  const offsuit = c.endsWith("O") || c.length === 2;
  const i1 = RANK_ORDER.indexOf(r1);
  const i2 = RANK_ORDER.indexOf(r2);
  if (i1 < 0 || i2 < 0) return 169;
  const hi = Math.max(i1, i2);
  const lo = Math.min(i1, i2);
  const gap = hi - lo;
  let base = 90 - hi * 5 - lo * 2;
  if (suited) base -= 12;
  if (offsuit && !suited && c.length >= 3) base += 8;
  if (gap >= 3) base += gap * 4;
  if (hi === 12) base -= 10;
  return Math.max(1, Math.min(169, Math.floor(base)));
}

function equityVsOpen(code: string | null): number {
  return Math.round(Math.max(18, Math.min(85, 88 - handRankIndex(code) * 0.38)) * 10) / 10;
}
function equityVs3bet(code: string | null): number {
  return Math.round(Math.max(12, Math.min(82, 80 - handRankIndex(code) * 0.42)) * 10) / 10;
}
function percentile(code: string | null): number {
  return handRankIndex(code) / 169;
}

function flushDrawOuts(hero: string[], board: string[]): number {
  const suits = new Map<string, number>();
  for (const c of [...hero, ...board]) {
    const s = c[1]?.toLowerCase();
    if (s) suits.set(s, (suits.get(s) || 0) + 1);
  }
  for (const [suit, n] of suits) {
    if (n !== 4) continue;
    const hs = hero.filter((c) => c[1]?.toLowerCase() === suit).length;
    const bs = board.filter((c) => c[1]?.toLowerCase() === suit).length;
    if (hs >= 1 && bs >= 2) return 9;
  }
  return 0;
}

function straightDrawOuts(hero: string[], board: string[]): number {
  const ranks: number[] = [];
  for (const c of [...hero, ...board]) {
    const i = RANK_ORDER.indexOf(c[0]?.toUpperCase() || "");
    if (i >= 0) ranks.push(i);
  }
  let uniq = [...new Set(ranks)].sort((a, b) => a - b);
  if (uniq.includes(12)) uniq = [...new Set([...uniq, 0])].sort((a, b) => a - b);
  if (uniq.length < 3) return 0;
  let best = 0;
  for (let start = 0; start < 13; start++) {
    const window = uniq.filter((r) => r >= start && r <= start + 4);
    if (window.length === 4) {
      const span = window[window.length - 1] - window[0];
      if (span === 3) best = Math.max(best, 8);
      else if (span === 4) best = Math.max(best, 4);
    }
    if (window.length >= 3 && window[window.length - 1] - window[0] <= 4) {
      best = Math.max(best, 4);
    }
  }
  return best;
}

function runningPotBefore(hand: ParsedHand, actionOrder: number): number {
  let pot = (hand.small_blind || 0) + (hand.big_blind || 0);
  for (const a of hand.actions) {
    if (a.action_order >= actionOrder) break;
    if (a.amount != null && a.amount > 0) pot += a.amount;
  }
  return Math.max(pot, (hand.big_blind || 0) * 1.5);
}

function preflopRaisesBeforeHero(hand: ParsedHand): number {
  let n = 0;
  for (const a of hand.actions) {
    if (a.street !== "preflop") continue;
    if (a.is_hero) break;
    if (a.action === "raise" && a.amount != null && a.amount > 0) n += 1;
  }
  return n;
}

function heroPreflopActionRow(hand: ParsedHand): ParsedAction | null {
  for (const a of hand.actions) {
    if (a.street !== "preflop" || !a.is_hero) continue;
    if (a.action === "raise" || a.action === "call" || a.action === "fold") {
      if (a.action === "call" && (a.amount == null || a.amount <= 0)) continue;
      return a;
    }
  }
  return null;
}

function lostMoney(hand: ParsedHand): number {
  const net = hand.hero_net ?? 0;
  return net < 0 ? Math.abs(net) : 0;
}

function callEv(equityPct: number, pot: number, bet: number): number {
  return (equityPct / 100) * (pot + 2 * bet) - bet;
}

function toItem(opts: {
  handKey: string;
  hand: ParsedHand;
  street: string;
  board: string[];
  potBefore: number;
  betAmount: number;
  actual: string;
  correct: string;
  lost: number;
  evLoss: number;
  potOddsPct: number | null;
  equityPct: number | null;
  outs: number | null;
  title: string;
  analysis: string;
  example: string;
}): RecommendationHandItem {
  const cards = parseHeroCards(opts.hand.hero_hand);
  const hid = opts.hand.external_hand_id;
  const code = opts.hand.hero_hand_code || "?";
  const pos = (opts.hand.hero_position || "?").toUpperCase();
  return {
    hand_id: opts.handKey,
    external_hand_id: hid,
    hand_code: code,
    hero_cards: cards.length ? cards.join(" ") : opts.hand.hero_hand || "",
    position: pos,
    street: opts.street,
    board: opts.board,
    pot_before: Math.round(opts.potBefore * 100) / 100,
    bet_amount: Math.round(opts.betAmount * 100) / 100,
    actual_action: opts.actual,
    correct_action: opts.correct,
    lost_money: Math.round(opts.lost * 100) / 100,
    ev_loss: Math.round(Math.max(0, opts.evLoss) * 100) / 100,
    pot_odds_pct: opts.potOddsPct,
    equity_pct: opts.equityPct,
    outs: opts.outs,
    title: opts.title,
    analysis: opts.analysis,
    example: opts.example,
    text: `${opts.title}\n\n${opts.analysis}\n\nПример правильной линии: ${opts.example}`,
  };
}

function rowToParsed(row: HandRow): ParsedHand | null {
  const raw = (row.raw_text || "").trim();
  if (!raw) return null;
  try {
    const parsed = parseHandHistory(raw)[0];
    if (parsed) return parsed;
  } catch {
    /* fall through */
  }
  // Minimal stub from stored fields (no postflop math).
  return {
    external_hand_id: row.external_hand_id,
    raw_text: raw,
    played_at: row.played_at,
    table_name: row.table_name,
    table_max: row.table_max ?? null,
    button_seat: row.button_seat ?? null,
    small_blind: row.small_blind,
    big_blind: row.big_blind,
    hero_name: row.hero_name,
    hero_position: row.hero_position,
    hero_hand: row.hero_hand,
    hero_hand_code: row.hero_hand_code,
    detected_spot: row.detected_spot,
    villain_position: row.villain_position,
    stack_bb: null,
    hero_preflop_action: row.hero_preflop_action,
    hero_net: row.hero_net,
    hero_net_bb: row.hero_net_bb,
    went_to_showdown: row.went_to_showdown,
    hero_net_wsd: row.hero_net_wsd,
    hero_net_wsd_bb: row.hero_net_wsd_bb,
    hero_net_wwsd: row.hero_net_wwsd,
    hero_net_wwsd_bb: row.hero_net_wwsd_bb,
    seats: Array.isArray(row.seats) ? row.seats : [],
    actions: [],
    vpip: !!row.vpip,
    pfr: !!row.pfr,
    three_bet: !!row.three_bet,
    three_bet_opp: !!row.three_bet_opp,
    flags: row.flags ?? undefined,
  };
}

function findPreflopLeaks(
  pairs: { key: string; hand: ParsedHand }[],
  limit = 30,
): RecommendationHandItem[] {
  const items: RecommendationHandItem[] = [];
  for (const { key, hand } of pairs) {
    const code = hand.hero_hand_code;
    const pos = (hand.hero_position || "").toUpperCase();
    if (!code || !pos) continue;
    const row = heroPreflopActionRow(hand);
    const actual = hand.hero_preflop_action || row?.action || null;
    if (actual !== "raise" && actual !== "call") continue;
    const bet = row?.amount != null ? row.amount : 0;
    const pot = row ? runningPotBefore(hand, row.action_order) : (hand.big_blind || 0) * 1.5;
    const lost = lostMoney(hand);
    const raisesBefore = hand.actions.length
      ? preflopRaisesBeforeHero(hand)
      : hand.detected_spot?.toLowerCase().includes("3bet")
        ? 2
        : hand.detected_spot?.toLowerCase().includes("vs")
          ? 1
          : 0;
    const cards = parseHeroCards(hand.hero_hand).join(" ") || hand.hero_hand || "";
    const hid = hand.external_hand_id;

    if (actual === "call" && raisesBefore >= 1 && bet > 0) {
      const needed = pot + bet * 2 > 0 ? Math.round((1000 * bet) / (pot + bet * 2)) / 10 : 100;
      const eq = raisesBefore >= 2 ? equityVs3bet(code) : equityVsOpen(code);
      const vs = raisesBefore >= 2 ? "3-бет диапазон" : "опен-рейз";
      const ev = callEv(eq, pot, bet);
      if (needed <= eq + 1.5) continue;
      const evLoss = ev < 0 ? Math.abs(ev) : (bet * (needed - eq)) / 100;
      items.push(
        toItem({
          handKey: key,
          hand,
          street: "preflop",
          board: [],
          potBefore: pot,
          betAmount: bet,
          actual: "call",
          correct: "fold",
          lost,
          evLoss,
          potOddsPct: needed,
          equityPct: eq,
          outs: null,
          title: `−EV колл на префлопе · ${code} · ${pos}`,
          analysis: `Раздача #${hid}: у вас ${cards} (${code}) из ${pos}. Вы заколлировали $${bet.toFixed(2)} при банке ≈ $${pot.toFixed(2)}. Шансы банка требовали ≈ ${needed.toFixed(1)}% эквити, а против типичного ${vs} у ${code} примерно ${eq.toFixed(1)}%. EV колла ≈ ${ev.toFixed(2)}$. Итог: −$${lost.toFixed(2)}.`,
          example: `На префлопе с ${code} из ${pos} правильная линия — ${ACTION_RU.fold}.`,
        }),
      );
      continue;
    }

    if (actual === "raise" && raisesBefore === 0) {
      const top = OPEN_TOP_PCT[pos];
      if (top == null || top <= 0) continue;
      const pct = percentile(code);
      if (pct <= top) continue;
      if (lost <= 0 && pct < top + 0.12) continue;
      items.push(
        toItem({
          handKey: key,
          hand,
          street: "preflop",
          board: [],
          potBefore: pot,
          betAmount: bet,
          actual: "raise",
          correct: "fold",
          lost,
          evLoss: Math.max(lost, (hand.big_blind || 1) * 2.5),
          potOddsPct: null,
          equityPct: Math.round((1 - pct) * 1000) / 10,
          outs: null,
          title: `Слишком широкий опен · ${code} · ${pos}`,
          analysis: `Раздача #${hid}: ${cards} (${code}) из ${pos}. Открытие шире позиционного топ-${Math.round(top * 100)}% (перцентиль ~${Math.round(pct * 100)}%). Итог: −$${lost.toFixed(2)}.`,
          example: `С ${code} из ${pos} базовая линия — ${ACTION_RU.fold}.`,
        }),
      );
    }
  }
  items.sort((a, b) => b.lost_money - a.lost_money || b.ev_loss - a.ev_loss);
  return items.slice(0, limit);
}

function findPotOddsLeaks(
  pairs: { key: string; hand: ParsedHand }[],
  limit = 30,
): RecommendationHandItem[] {
  const items: RecommendationHandItem[] = [];
  for (const { key, hand } of pairs) {
    const hero = parseHeroCards(hand.hero_hand);
    if (hero.length !== 2) continue;
    const boardFull = parseBoard(hand.raw_text || "");
    if (boardFull.length < 3) continue;
    const lost = lostMoney(hand);
    const code = hand.hero_hand_code || "?";
    const hid = hand.external_hand_id;
    const cards = hero.join(" ");

    for (const a of hand.actions) {
      if (!a.is_hero || !["flop", "turn", "river"].includes(a.street)) continue;
      if (a.action !== "call" || a.amount == null || a.amount <= 0) continue;
      const streetBoard =
        a.street === "flop"
          ? boardFull.slice(0, 3)
          : a.street === "turn"
            ? boardFull.slice(0, 4)
            : boardFull.slice(0, 5);
      if (streetBoard.length < 3) continue;
      const flushO = flushDrawOuts(hero, streetBoard);
      const straightO = straightDrawOuts(hero, streetBoard);
      const outs = Math.max(flushO, straightO);
      if (outs <= 0) continue;
      const bet = a.amount;
      const pot = runningPotBefore(hand, a.action_order);
      const denom = pot + bet * 2;
      if (denom <= 0) continue;
      const needed = Math.round((1000 * bet) / denom) / 10;
      const equity = Math.min(95, outs * 2);
      if (needed <= equity) continue;
      const ev = callEv(equity, pot, bet);
      const evLoss = ev < 0 ? Math.abs(ev) : (bet * (needed - equity)) / 100;
      const streetRu = STREET_RU[a.street] || a.street;
      const draw =
        [flushO ? "флеш-дро" : "", straightO >= 8 ? "OESD" : straightO >= 4 ? "гатшот" : ""]
          .filter(Boolean)
          .join(" + ") || `${outs} outs`;
      items.push(
        toItem({
          handKey: key,
          hand,
          street: a.street,
          board: streetBoard,
          potBefore: pot,
          betAmount: bet,
          actual: "call",
          correct: "fold",
          lost,
          evLoss,
          potOddsPct: needed,
          equityPct: equity,
          outs,
          title: `−EV колл с дро · ${a.street.toUpperCase()} · −$${Math.max(lost, evLoss).toFixed(2)}`,
          analysis: `Раздача #${hid}: ${cards} (${code}), борд ${streetBoard.join(" ")}, ${streetRu}. Колл $${bet.toFixed(2)} при банке ≈ $${pot.toFixed(2)}, ${draw} (${outs} outs ≈ ${equity.toFixed(1)}%). Нужно ${needed.toFixed(1)}% — колл −EV (≈ ${ev.toFixed(2)}$). Итог: −$${lost.toFixed(2)}.`,
          example: `На ${streetRu} правильная линия — ${ACTION_RU.fold}, если equity < pot odds.`,
        }),
      );
    }
  }
  items.sort((a, b) => b.ev_loss - a.ev_loss || b.lost_money - a.lost_money);
  return items.slice(0, limit);
}

function buildCritical(
  preflop: RecommendationHandItem[],
  pot: RecommendationHandItem[],
  top = 5,
): RecommendationHandItem[] {
  const best = new Map<string, RecommendationHandItem>();
  for (const it of [...preflop, ...pot]) {
    const score = it.lost_money * 1.5 + it.ev_loss;
    const prev = best.get(it.hand_id);
    const prevScore = prev ? prev.lost_money * 1.5 + prev.ev_loss : -1;
    if (score > prevScore && (it.lost_money > 0 || it.ev_loss > 0)) best.set(it.hand_id, it);
  }
  return [...best.values()]
    .sort((a, b) => b.lost_money - a.lost_money || b.ev_loss - a.ev_loss)
    .slice(0, top)
    .map((it) => ({
      ...it,
      title: `Дорогой лик −$${it.lost_money.toFixed(2)} · #${it.external_hand_id}`,
      text: `Дорогой лик: #${it.external_hand_id} с ${it.hero_cards} (${it.hand_code}) из ${it.position}: ${ACTION_RU[it.actual_action] || it.actual_action} вместо ${ACTION_RU[it.correct_action] || it.correct_action}, −$${it.lost_money.toFixed(2)}.\n\n${it.analysis}\n\nПример: ${it.example}`,
    }));
}

function buildPlan(
  preflop: RecommendationHandItem[],
  pot: RecommendationHandItem[],
  critical: RecommendationHandItem[],
): PlanChecklistItem[] {
  const byPos = new Map<string, number>();
  for (const i of preflop) byPos.set(i.position, (byPos.get(i.position) || 0) + 1);
  let worstPos = "BTN";
  let worstN = 0;
  for (const [p, n] of byPos) {
    if (n > worstN) {
      worstPos = p;
      worstN = n;
    }
  }
  const damage = critical.reduce((s, i) => s + i.lost_money, 0);
  return [
    {
      priority: 1,
      text:
        worstN > 0
          ? `Сфокусируйтесь на префлопе из ${worstPos}: найдено ${worstN} −EV входов.`
          : "Держите префлоп-дисциплину: не коллируйте рейзы без эквити и не открывайте мусор из ранних позиций.",
    },
    {
      priority: 2,
      text:
        pot.length > 0
          ? `На постфлопе считайте pot odds — найдено ${pot.length} убыточных коллов с дро.`
          : "Не коллируйте ставки с дро, если equity (outs×2) меньше шансов банка.",
    },
    {
      priority: 3,
      text:
        damage > 0
          ? `Разберите топ дорогих ошибок (≈ $${damage.toFixed(2)}) во вкладке «Дорогие лики».`
          : "Перед сессией проверьте 2–3 крупных банка: был ли у колла правильный pot odds.",
    },
  ];
}

function scoreLabel(score: number): string {
  if (score >= 9) return "Элитный уровень";
  if (score >= 7.5) return "Солидный рег";
  if (score >= 6) return "Рабочий уровень";
  if (score >= 4.5) return "Есть заметные лики";
  if (score >= 3) return "Слабая дистанция";
  return "Критичные лики";
}

function buildEvaluation(
  strategyId: string,
  n: number,
  preflop: RecommendationHandItem[],
  pot: RecommendationHandItem[],
  critical: RecommendationHandItem[],
): GameEvaluation {
  const cached = peekAnalysisCache(strategyId)?.analysis;
  const hudSrc = cached?.stats || [];
  const hud: HudEvalItem[] = hudSrc.slice(0, 12).map((s) => ({
    key: s.key,
    label: s.label || s.key,
    value: s.value ?? null,
    unit: s.unit || "pct",
    samples: s.samples ?? n,
    target_min: null,
    target_max: null,
    status: "ok",
    score: 7,
    recommendation: `${s.label || s.key}: ${s.value != null ? s.value : "—"}`,
  }));

  const errN = preflop.length + pot.length;
  const damage = critical.reduce((s, i) => s + i.lost_money, 0);
  const errRate = errN / Math.max(n, 1);
  const mathScore = Math.round(Math.max(0, 10 - Math.min(8, errRate * 55) - Math.min(4, damage / 40)) * 100) / 100;
  const hudScore = 7;
  const score = Math.round((0.55 * hudScore + 0.45 * mathScore) * 10) / 10;
  const confidence = n >= 200 ? "high" : n >= 60 ? "medium" : "low";
  const label = scoreLabel(score);
  const focus: string[] = [];
  if (preflop.length) {
    focus.push(`Префлоп-математика: ${preflop.length} −EV входов.`);
  }
  if (pot.length) {
    focus.push(`Математика банка: ${pot.length} −EV коллов с дро.`);
  }
  return {
    score,
    label,
    summary: `Оценка ${score.toFixed(1)}/10 — ${label}. Математика: ${mathScore.toFixed(1)}/10 на ${n.toLocaleString("ru-RU")} раздачах текущей сессии.`,
    hands: n,
    confidence,
    math_score: mathScore,
    hud_score: hudScore,
    hud,
    focus: focus.slice(0, 6),
  };
}

type CacheEntry = { key: string; data: RecommendationsResponse };
let memCache: CacheEntry | null = null;

export async function buildLocalRecommendations(
  strategyId: string,
  onProgress?: (message: string, pct: number) => void,
): Promise<RecommendationsResponse> {
  const rows = await listHandsForStrategy(strategyId);
  const cacheKey = `${strategyId}:${rows.length}:${rows[0]?.external_hand_id || ""}:${rows[rows.length - 1]?.external_hand_id || ""}`;
  if (memCache?.key === cacheKey) return memCache.data;

  onProgress?.("Готовим раздачи сессии…", 10);
  const pairs: { key: string; hand: ParsedHand }[] = [];
  const CHUNK = 250;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    for (const row of slice) {
      const hand = rowToParsed(row);
      if (hand) pairs.push({ key: row.key, hand });
    }
    onProgress?.(
      `Разбор сессии… ${Math.min(i + CHUNK, rows.length).toLocaleString("ru-RU")} / ${rows.length.toLocaleString("ru-RU")}`,
      10 + Math.round((70 * Math.min(i + CHUNK, rows.length)) / Math.max(rows.length, 1)),
    );
    // Yield so UI stays responsive on large sessions.
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => window.setTimeout(r, 0));
  }

  onProgress?.("Считаем префлоп-математику…", 85);
  const preflop = findPreflopLeaks(pairs);
  onProgress?.("Считаем pot odds…", 92);
  const pot = findPotOddsLeaks(pairs);
  const critical = buildCritical(preflop, pot);
  const plan = buildPlan(preflop, pot, critical);
  const evaluation = buildEvaluation(strategyId, pairs.length, preflop, pot, critical);

  const data: RecommendationsResponse = {
    strategy_id: strategyId,
    hands_count: pairs.length,
    math_errors: preflop.length + pot.length,
    total_damage_money: Math.round(critical.reduce((s, i) => s + i.lost_money, 0) * 100) / 100,
    discipline: preflop,
    critical_damage: critical,
    pot_odds: pot,
    plan,
    evaluation,
  };
  memCache = { key: cacheKey, data };
  onProgress?.("Готово", 100);
  return data;
}

export function clearLocalRecommendationsCache() {
  memCache = null;
}
