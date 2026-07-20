/**
 * Build ReplayHand / StatHandsResponse from IndexedDB (no server).
 */

import type {
  ReplayAction,
  ReplayHand,
  ReplaySeat,
  StatHandsResponse,
} from "../api/client";
import type { HudFlags } from "./hudFlags";
import { listHandsForStrategy, openLocalDb, type HandRow } from "./localDb";
import { parseHandHistory } from "./parseHh";

const FLOP_RE =
  /\*\*\*\s+(?:FIRST\s+)?FLOP\s+\*\*\*\s*\[([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])\]/i;
const TURN_RE = /\*\*\*\s+(?:FIRST\s+)?TURN\s+\*\*\*.*?\[([2-9TJQKA][shdc])\]/i;
const RIVER_RE = /\*\*\*\s+(?:FIRST\s+)?RIVER\s+\*\*\*.*?\[([2-9TJQKA][shdc])\]/i;
const FIRST_BOARD_RE =
  /FIRST Board\s*\[([2-9TJQKA][shdc](?:\s+[2-9TJQKA][shdc]){2,4})\]/i;
const TABLE_RE =
  /^Table '([^']+)'\s+(\d+)-max\s+Seat #(\d+) is the button/i;
const SEAT_RE =
  /^Seat (\d+):\s+(.+?)\s+\(\$?([\d.]+) in chips\)/i;

const STAT_FLAG: Record<string, keyof HudFlags> = {
  vpip: "vpip",
  pfr: "pfr",
  three_bet: "three_bet",
  fold_to_3bet: "fold_to_3bet",
  four_bet: "four_bet",
  ats: "ats",
  fold_bb_steal: "fold_bb_steal",
  limp: "limp",
  cbet: "cbet",
  fold_to_cbet: "fold_to_cbet",
  wtsd: "went_to_showdown",
  wsd: "won_at_showdown",
  wwsf: "won_when_saw_flop",
};

const STAT_LABELS: Record<string, string> = {
  vpip: "VPIP",
  pfr: "PFR",
  three_bet: "3-bet",
  fold_to_3bet: "Fold to 3-bet",
  four_bet: "4-bet",
  ats: "Steal",
  fold_bb_steal: "Fold BB to steal",
  limp: "Limp",
  cbet: "C-bet flop",
  fold_to_cbet: "Fold to C-bet",
  af: "AF",
  afq: "AFq",
  wtsd: "WTSD",
  wsd: "W$SD",
  wwsf: "WWSF",
};

function parseBoard(raw: string): string[] {
  const board: string[] = [];
  const f = FLOP_RE.exec(raw);
  if (f) board.push(f[1], f[2], f[3]);
  const t = TURN_RE.exec(raw);
  if (t) board.push(t[1]);
  const r = RIVER_RE.exec(raw);
  if (r) board.push(r[1]);
  if (board.length < 3) {
    const bm = FIRST_BOARD_RE.exec(raw);
    if (bm) board.push(...bm[1].trim().split(/\s+/));
  }
  return board.map((c) => (c.length === 2 ? c[0].toUpperCase() + c[1].toLowerCase() : c));
}

function parseSeats(
  raw: string,
  heroName: string | null,
  heroHand: string | null,
  heroPosition: string | null,
): ReplaySeat[] {
  let button = 1;
  const seats = new Map<number, { name: string; stack: number }>();
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const tm = TABLE_RE.exec(line.trim());
    if (tm) {
      button = Number(tm[3]);
      continue;
    }
    const sm = SEAT_RE.exec(line.trim());
    if (sm) {
      seats.set(Number(sm[1]), { name: sm[2].trim(), stack: Number(sm[3]) });
    }
  }
  const hero = (heroName || "Hero").toLowerCase();
  if (!seats.size) {
    return [
      {
        seat: 1,
        name: heroName || "Hero",
        position: heroPosition,
        stack: null,
        is_hero: true,
        is_button: true,
        cards: heroHand,
      },
    ];
  }
  return [...seats.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seat, info]) => ({
      seat,
      name: info.name,
      position: info.name.toLowerCase() === hero ? heroPosition : null,
      stack: info.stack,
      is_hero: info.name.toLowerCase() === hero,
      is_button: seat === button,
      cards: info.name.toLowerCase() === hero ? heroHand : null,
    }));
}

function heroCards(heroHand: string | null): string[] {
  if (heroHand && heroHand.length >= 4) return [heroHand.slice(0, 2), heroHand.slice(2, 4)];
  return [];
}

export function isLocalHandId(id: string): boolean {
  return id.includes("::") || id.startsWith("local-");
}

export function buildReplayFromRow(row: HandRow): ReplayHand {
  const raw = (row.raw_text || "").trim();
  return buildReplayFromRawText(raw, {
    id: row.key,
    external_hand_id: row.external_hand_id,
    played_at: row.played_at,
    table_name: row.table_name,
    small_blind: row.small_blind,
    big_blind: row.big_blind,
    hero_name: row.hero_name,
    hero_position: row.hero_position,
    hero_hand: row.hero_hand,
    hero_net: row.hero_net,
    hero_net_bb: row.hero_net_bb,
  });
}

/** Build a ReplayHand from raw HH text (feed posts, pasted hands). */
export function buildReplayFromRawText(
  rawText: string,
  extras?: {
    id?: string;
    external_hand_id?: string | null;
    played_at?: string | null;
    table_name?: string | null;
    small_blind?: number | null;
    big_blind?: number | null;
    hero_name?: string | null;
    hero_position?: string | null;
    hero_hand?: string | null;
    hero_net?: number | null;
    hero_net_bb?: number | null;
  },
): ReplayHand {
  const raw = (rawText || "").trim();
  const parsed = raw ? parseHandHistory(raw)[0] : null;
  const heroHand = parsed?.hero_hand ?? extras?.hero_hand ?? null;
  const actionsSrc = parsed?.actions ?? [];
  const actions: ReplayAction[] = [...actionsSrc]
    .sort((a, b) => a.action_order - b.action_order)
    .map((a) => ({
      street: a.street,
      order: a.action_order,
      player_name: a.player_name,
      is_hero: a.is_hero,
      action: a.action,
      amount: a.amount,
    }));

  return {
    id: extras?.id || parsed?.external_hand_id || "feed-hand",
    external_hand_id:
      extras?.external_hand_id || parsed?.external_hand_id || "feed",
    played_at: extras?.played_at ?? parsed?.played_at ?? null,
    table_name: parsed?.table_name ?? extras?.table_name ?? null,
    small_blind: parsed?.small_blind ?? extras?.small_blind ?? null,
    big_blind: parsed?.big_blind ?? extras?.big_blind ?? null,
    hero_name: parsed?.hero_name ?? extras?.hero_name ?? "Hero",
    hero_position: parsed?.hero_position ?? extras?.hero_position ?? null,
    hero_cards: heroCards(heroHand),
    board: parseBoard(raw),
    hero_net: Math.round((extras?.hero_net ?? 0) * 10000) / 10000,
    hero_net_bb: Math.round((extras?.hero_net_bb ?? 0) * 10000) / 10000,
    seats: parseSeats(
      raw,
      parsed?.hero_name ?? extras?.hero_name ?? null,
      heroHand,
      parsed?.hero_position ?? extras?.hero_position ?? null,
    ),
    actions,
    raw_text: raw,
  };
}

async function getHandByKey(key: string): Promise<HandRow | null> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("hands", "readonly");
    const req = tx.objectStore("hands").get(key);
    req.onsuccess = () => resolve((req.result as HandRow) || null);
    req.onerror = () => reject(req.error ?? new Error("get hand failed"));
  });
}

export async function fetchLocalHandReplay(handKey: string): Promise<ReplayHand> {
  const row = await getHandByKey(handKey);
  if (!row || !row.raw_text) {
    throw new Error("Раздача не найдена. Загрузите историю заново на странице Анализ.");
  }
  return buildReplayFromRow(row);
}

function matchesStat(flags: HudFlags | null, row: HandRow, stat: string): boolean {
  const key = stat.trim().toLowerCase();
  if (key === "af" || key === "afq") {
    const f = flags;
    return !!f && f.postflop_bets + f.postflop_raises > 0;
  }
  if (key === "wtsd") {
    return !!(flags?.saw_flop && flags.went_to_showdown);
  }
  const field = STAT_FLAG[key];
  if (!field) return false;
  if (flags) return Boolean(flags[field]);
  // legacy rows
  if (key === "vpip") return !!row.vpip;
  if (key === "pfr") return !!row.pfr;
  if (key === "three_bet") return !!row.three_bet;
  return false;
}

export async function fetchLocalStatHands(
  strategyId: string,
  stat: string,
  limit = 150,
): Promise<StatHandsResponse> {
  const key = stat.trim().toLowerCase();
  const hands = await listHandsForStrategy(strategyId);
  const matched = hands.filter((h) => matchesStat(h.flags, h, key));
  return {
    strategy_id: strategyId,
    stat: key,
    label: STAT_LABELS[key] || key,
    total_matched: matched.length,
    hands: matched.slice(0, limit).map(buildReplayFromRow),
  };
}
