/**
 * PokerStars / GGPoker HH parser (port of backend/app/parsers/pokerstars.py).
 * Runs in the browser / Worker on the user's PC.
 */

import { cardsToHandCode } from "./handCodes";
import { mergeFlagsIntoHand } from "./hudFlags";
import type { ParsedAction, ParsedHand } from "./types";

const HAND_SPLIT_RE =
  /(?=PokerStars Hand #)|(?=Poker Hand #)|(?=PokerStars Zoom Hand #)/gi;

const HEADER_RE =
  /^(?:PokerStars(?: Zoom)? Hand|Poker Hand) #([^\s:]+):\s*.*?\((\$?[\d.]+)\/(\$?[\d.]+).*?\)\s*-\s*(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/i;

const TABLE_RE =
  /^Table '([^']+)'\s+(\d+)-max\s+Seat #(\d+) is the button/i;

const SEAT_RE =
  /^Seat (\d+):\s+(.+?)\s+\(\$?([\d.]+) in chips\)/i;

const DEALT_RE =
  /^Dealt to (.+?)(?:\s+\[([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])\])?\s*$/i;

const ACTION_RE =
  /^(.+?):\s+(folds|checks|calls|bets|raises|posts)\b(?:\s+(?:small blind|big blind|the ante))?(?:\s+\$?([\d.]+))?(?:\s+to\s+\$?([\d.]+))?/i;

// GG Rush&Cash run-it-twice: *** FIRST FLOP *** / *** SECOND RIVER ***
const STREET_RE =
  /^\*\*\*\s+(?:(FIRST|SECOND)\s+)?(HOLE CARDS|FLOP|TURN|RIVER|SHOWDOWN|SUMMARY)\s+\*\*\*/i;

function streetFromMarker(prefix: string | undefined, label: string): string {
  const lab = (label || "").toUpperCase();
  const pref = (prefix || "").toUpperCase();
  if (pref === "SECOND") return "summary";
  if (lab === "HOLE CARDS") return "preflop";
  if (lab === "FLOP") return "flop";
  if (lab === "TURN") return "turn";
  if (lab === "RIVER") return "river";
  return "summary";
}

const SIX_MAX = ["BTN", "SB", "BB", "UTG", "MP", "CO"] as const;

function money(value: string | null | undefined): number | null {
  if (value == null) return null;
  return Number(value.replace("$", ""));
}

function normalizeVerb(verb: string, hasTo: boolean): string | null {
  const v = verb.toLowerCase();
  if (v === "folds") return "fold";
  if (v === "checks" || v === "calls") return "call";
  if (v === "bets" || v === "raises") return "raise";
  if (v === "posts") return null;
  if (hasTo) return "raise";
  return null;
}

function assignPositions(seatOrder: number[], button: number): Record<number, string> {
  if (!seatOrder.length) return {};
  const seats = [...seatOrder].sort((a, b) => a - b);
  let btn = button;
  if (!seats.includes(btn)) btn = seats[0];
  const idx = seats.indexOf(btn);
  const rotated = seats.slice(idx).concat(seats.slice(0, idx));
  const n = rotated.length;
  let labels: string[];
  if (n === 2) labels = ["SB", "BB"];
  else if (n === 3) labels = ["BTN", "SB", "BB"];
  else if (n === 4) labels = ["BTN", "SB", "BB", "CO"];
  else if (n === 5) labels = ["BTN", "SB", "BB", "UTG", "CO"];
  else if (n <= 6) labels = SIX_MAX.slice(0, n) as string[];
  else {
    const extra = ["UTG+1", "UTG+2", "MP", "HJ", "CO"];
    labels = ["BTN", "SB", "BB", "UTG", ...extra.slice(0, n - 4)];
  }
  const out: Record<number, string> = {};
  rotated.forEach((seat, i) => {
    out[seat] = labels[i];
  });
  return out;
}

function detectSpot(actionsBefore: string[], heroAction: string): string {
  let raises = 0;
  let limps = 0;
  let callsAfterRaise = 0;
  for (const act of actionsBefore) {
    if (act === "raise") {
      raises += 1;
      callsAfterRaise = 0;
    } else if (act === "call") {
      if (raises === 0) limps += 1;
      else callsAfterRaise += 1;
    }
  }
  if (raises === 0) {
    if (limps > 0 && heroAction === "raise") return "iso";
    return "rfi";
  }
  if (raises === 1) {
    if (callsAfterRaise >= 1 && heroAction === "raise") return "squeeze";
    return "vs_open";
  }
  if (raises === 2) return "vs_3bet";
  return "vs_4bet";
}

export function computeHeroNet(
  block: string,
  heroName = "Hero",
  bigBlind: number | null = null,
): [number | null, number | null] {
  if (!block.trim()) return [null, null];
  const hero = heroName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let invested = 0;
  let streetIn = 0;
  let collected = 0;
  let returned = 0;
  let sawMoney = false;

  const postRe = new RegExp(`^${hero}: posts .+?\\$?([\\d.]+)`, "i");
  const callRe = new RegExp(`^${hero}: calls \\$?([\\d.]+)`, "i");
  const betRe = new RegExp(`^${hero}: bets \\$?([\\d.]+)`, "i");
  const raiseRe = new RegExp(`^${hero}: raises \\$?([\\d.]+) to \\$?([\\d.]+)`, "i");
  const returnedRe = new RegExp(`^Uncalled bet \\(\\$?([\\d.]+)\\) returned to ${hero}\\b`, "i");
  const collectedRe = new RegExp(`^${hero} collected \\$?([\\d.]+)`, "i");
  const summaryWonRe = new RegExp(
    `^Seat \\d+:\\s+${hero}\\b.+(?:won|collected) \\(\\$?([\\d.]+)\\)`,
    "i",
  );

  for (const raw of block.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const sm = STREET_RE.exec(line);
    if (sm) {
      const mapped = streetFromMarker(sm[1], sm[2]);
      if (mapped === "flop" || mapped === "turn" || mapped === "river" || mapped === "summary") {
        streetIn = 0;
      }
      continue;
    }
    let m = postRe.exec(line);
    if (m) {
      const amt = Number(m[1]);
      invested += amt;
      streetIn += amt;
      sawMoney = true;
      continue;
    }
    m = callRe.exec(line);
    if (m) {
      const amt = Number(m[1]);
      invested += amt;
      streetIn += amt;
      sawMoney = true;
      continue;
    }
    m = betRe.exec(line);
    if (m) {
      const amt = Number(m[1]);
      invested += amt;
      streetIn += amt;
      sawMoney = true;
      continue;
    }
    m = raiseRe.exec(line);
    if (m) {
      const toAmt = Number(m[2]);
      const delta = Math.max(0, toAmt - streetIn);
      invested += delta;
      streetIn = toAmt;
      sawMoney = true;
      continue;
    }
    m = returnedRe.exec(line);
    if (m) {
      returned += Number(m[1]);
      sawMoney = true;
      continue;
    }
    m = collectedRe.exec(line);
    if (m) {
      collected += Number(m[1]);
      sawMoney = true;
      continue;
    }
    if (collected === 0) {
      m = summaryWonRe.exec(line);
      if (m) {
        collected += Number(m[1]);
        sawMoney = true;
      }
    }
  }

  if (!sawMoney && invested === 0 && collected === 0) {
    return [0, bigBlind ? 0 : null];
  }
  const net = Math.round((collected + returned - invested) * 10000) / 10000;
  const netBb =
    bigBlind && bigBlind > 0 ? Math.round((net / bigBlind) * 10000) / 10000 : null;
  return [net, netBb];
}

function playersWhoRevealed(block: string): Set<string> {
  const names = new Set<string>();
  const revealAction =
    /^([^:\n]+?):\s*shows?\s*\[([2-9TJQKA][shdc](?:\s+[2-9TJQKA][shdc])?)\]/gim;
  const revealSummary =
    /^Seat\s+\d+:\s*(.+?)\s+(?:\([^)]*\)\s+)?(?:showed|mucked)\s*\[([2-9TJQKA][shdc](?:\s+[2-9TJQKA][shdc])?)\]/gim;
  for (const re of [revealAction, revealSummary]) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(block))) {
      let name = m[1].trim().replace(/\s+\([^)]*\)\s*$/, "").trim().toLowerCase();
      if (name && !name.includes("***")) names.add(name);
    }
  }
  return names;
}

function detectWentToShowdown(block: string, heroName: string): boolean {
  const revealed = playersWhoRevealed(block);
  const heroKey = heroName.trim().toLowerCase();
  if (!revealed.has(heroKey)) return false;
  for (const n of revealed) if (n !== heroKey) return true;
  return false;
}

function parseOne(block: string): ParsedHand | null {
  const lines = block
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const header = HEADER_RE.exec(lines[0]);
  if (!header) return null;

  const hid = header[1].trim();
  const sb = money(header[2]);
  const bb = money(header[3]);
  const playedAt = header[4].replace(/\//g, "-").replace(" ", "T") + "Z";

  let tableName: string | null = null;
  let tableMax: number | null = null;
  let button = 1;
  const seats = new Map<number, { name: string; stack: number }>();
  let heroName = "Hero";
  let heroCards: [string, string] | null = null;
  let street = "preflop";
  const actions: ParsedAction[] = [];
  let actionOrder = 0;
  const preflopVol: Array<[string, string]> = [];

  for (const line of lines.slice(1)) {
    const streetM = STREET_RE.exec(line);
    if (streetM) {
      street = streetFromMarker(streetM[1], streetM[2]);
      continue;
    }
    if (street === "summary") continue;

    const tableM = TABLE_RE.exec(line);
    if (tableM) {
      tableName = tableM[1];
      tableMax = Number(tableM[2]) || null;
      button = Number(tableM[3]);
      continue;
    }

    const seatM = SEAT_RE.exec(line);
    if (seatM) {
      if (/\bsitting out\b/i.test(line)) continue;
      seats.set(Number(seatM[1]), {
        name: seatM[2].trim(),
        stack: Number(seatM[3]),
      });
      continue;
    }

    const dealtM = DEALT_RE.exec(line);
    if (dealtM) {
      const name = dealtM[1].trim();
      if (dealtM[2] && dealtM[3]) {
        heroName = name;
        heroCards = [dealtM[2], dealtM[3]];
      }
      continue;
    }

    const actM = ACTION_RE.exec(line);
    if (actM && ["preflop", "flop", "turn", "river"].includes(street)) {
      const name = actM[1].trim();
      const verb = actM[2];
      const amount = money(actM[4] || actM[3]);
      const norm = normalizeVerb(verb, Boolean(actM[4]));
      if (!norm) continue;
      actionOrder += 1;
      actions.push({
        street,
        action_order: actionOrder,
        player_name: name,
        is_hero: name.toLowerCase() === heroName.toLowerCase(),
        action: norm,
        amount,
      });
      if (street === "preflop") {
        const pfAct = verb.toLowerCase() === "checks" ? "fold" : norm;
        preflopVol.push([name, pfAct]);
      }
    }
  }

  const posMap = assignPositions([...seats.keys()], button);
  const nameToSeat = new Map<string, number>();
  for (const [seat, info] of seats) nameToSeat.set(info.name, seat);
  const heroSeat = nameToSeat.get(heroName);
  const heroPosition = heroSeat != null ? posMap[heroSeat] ?? null : null;
  let stackBb: number | null = null;
  if (heroSeat != null && bb) stackBb = seats.get(heroSeat)!.stack / bb;

  let heroHand: string | null = null;
  let heroHandCode: string | null = null;
  if (heroCards) {
    heroHand = `${heroCards[0]}${heroCards[1]}`.slice(0, 4);
    try {
      heroHandCode = cardsToHandCode(heroCards[0], heroCards[1]);
    } catch {
      heroHandCode = null;
    }
  }

  // Strategy spot = hero's LAST voluntary preflop decision (vs 3bet after open, etc.).
  let heroPreflopAction: string | null = null;
  let detectedSpot: string | null = null;
  let villainPosition: string | null = null;
  const before: string[] = [];
  const beforePlayers: string[] = [];
  for (const [player, act] of preflopVol) {
    if (player.toLowerCase() === heroName.toLowerCase()) {
      heroPreflopAction = act;
      detectedSpot = detectSpot(before, act);
      villainPosition = null;
      for (let i = 0; i < before.length; i++) {
        if (before[i] === "raise") {
          const seat = nameToSeat.get(beforePlayers[i]);
          villainPosition = seat != null ? posMap[seat] ?? null : null;
        }
      }
      // Keep scanning — later hero decisions (face 3bet/4bet) override for strategy.
      before.push(act);
      beforePlayers.push(player);
      continue;
    }
    before.push(act);
    beforePlayers.push(player);
  }

  const [heroNet, heroNetBb] = computeHeroNet(block, heroName, bb);
  const went = detectWentToShowdown(block, heroName);
  const zeroBb = heroNetBb != null ? 0 : null;

  const seatList = [...seats.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seat, info]) => ({ seat, name: info.name, stack: info.stack }));

  return mergeFlagsIntoHand({
    external_hand_id: hid.slice(0, 64),
    raw_text: block.trim(),
    played_at: playedAt,
    table_name: tableName,
    table_max: tableMax ?? (seatList.length || null),
    button_seat: button,
    small_blind: sb,
    big_blind: bb,
    hero_name: heroName,
    hero_position: heroPosition,
    hero_hand: heroHand,
    hero_hand_code: heroHandCode,
    detected_spot: detectedSpot,
    villain_position: villainPosition,
    stack_bb: stackBb,
    hero_preflop_action: heroPreflopAction,
    hero_net: heroNet,
    hero_net_bb: heroNetBb,
    went_to_showdown: went,
    hero_net_wsd: went ? heroNet : 0,
    hero_net_wsd_bb: went ? heroNetBb : zeroBb,
    hero_net_wwsd: went ? 0 : heroNet,
    hero_net_wwsd_bb: went ? zeroBb : heroNetBb,
    seats: seatList,
    actions,
    vpip: false,
    pfr: false,
    three_bet: false,
    three_bet_opp: false,
  });
}

export function splitHandBlocks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(HAND_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  return parts;
}

export function estimateHandCount(text: string): number {
  const m = text.match(HAND_SPLIT_RE);
  return m ? m.length : text.includes("Hand #") ? 1 : 0;
}

export function detectRoom(text: string): string {
  if (/Poker Hand #/i.test(text) && !/PokerStars/i.test(text.slice(0, 200))) return "gg";
  return "pokerstars";
}

export function parseHandHistory(text: string): ParsedHand[] {
  const blocks = splitHandBlocks(text);
  const out: ParsedHand[] = [];
  for (const block of blocks) {
    try {
      const hand = parseOne(block);
      if (hand) out.push(hand);
    } catch {
      /* skip bad block */
    }
  }
  return out;
}
