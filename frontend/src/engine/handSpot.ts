/**
 * Resolve hero's last preflop strategy decision from stored HH actions.
 */
import { normalizeChartPos } from "../lib/spotCoverage";
import type { HandRow } from "./localDb";

export type HeroStrategyDecision = {
  spot: string;
  action: string;
  villain: string | null;
};

/** Seat labels from HandRow for strategy villain lookup. */
export function nameToSeatLabel(hand: HandRow): Map<string, string> {
  const out = new Map<string, string>();
  const seats = hand.seats ?? [];
  if (!seats.length) {
    if (hand.hero_name && hand.hero_position) {
      out.set(hand.hero_name, hand.hero_position);
    }
    return out;
  }
  const seatNums = seats.map((s) => s.seat);
  const button = hand.button_seat ?? seatNums[0];
  const sorted = [...seatNums].sort((a, b) => a - b);
  let btn = button;
  if (!sorted.includes(btn)) btn = sorted[0];
  const idx = sorted.indexOf(btn);
  const rotated = sorted.slice(idx).concat(sorted.slice(0, idx));
  const n = rotated.length;
  let labels: string[];
  if (n === 2) labels = ["SB", "BB"];
  else if (n === 3) labels = ["BTN", "SB", "BB"];
  else if (n <= 6) {
    labels = ["BTN", "SB", "BB", "UTG", "HJ", "CO"].slice(0, n);
  } else {
    const extra = ["UTG+1", "UTG+2", "MP", "HJ", "CO"];
    labels = ["BTN", "SB", "BB", "UTG", ...extra.slice(0, n - 4)];
  }
  const seatToLabel = new Map<number, string>();
  rotated.forEach((seat, i) => seatToLabel.set(seat, labels[i]));
  for (const s of seats) {
    const lab = seatToLabel.get(s.seat);
    if (lab) out.set(s.name, lab);
  }
  return out;
}

/**
 * Prefer last hero preflop decision from stored actions (open → face 3bet).
 * Falls back to HandRow.detected_spot for older trimmed imports.
 */
export function resolveHeroStrategyDecision(
  hand: HandRow,
): HeroStrategyDecision | null {
  const acts = hand.preflop_actions?.length
    ? hand.preflop_actions
    : hand.actions ?? [];
  const preflop = acts.filter((a) => (a.street || "").toLowerCase() === "preflop");
  if (preflop.length) {
    const pos = nameToSeatLabel(hand);
    const before: string[] = [];
    const beforePlayers: string[] = [];
    let last: HeroStrategyDecision | null = null;
    for (const a of preflop) {
      const act = (a.action || "").toLowerCase();
      if (!["raise", "call", "fold", "bet", "check"].includes(act)) continue;
      const norm =
        act === "bet" ? "raise" : act === "check" ? "call" : act;
      if (a.is_hero) {
        let raises = 0;
        let limps = 0;
        let callsAfterRaise = 0;
        for (const b of before) {
          if (b === "raise") {
            raises += 1;
            callsAfterRaise = 0;
          } else if (b === "call") {
            if (raises === 0) limps += 1;
            else callsAfterRaise += 1;
          }
        }
        let spot = "rfi";
        if (raises === 0) {
          if (limps > 0 && norm === "raise") spot = "iso";
          else if (norm === "call") spot = "limp";
          else spot = "rfi";
        } else if (raises === 1) {
          if (callsAfterRaise >= 1 && norm === "raise") spot = "squeeze";
          else if (callsAfterRaise >= 1 && norm === "call") spot = "multiway";
          else spot = "vs_open";
        } else if (raises === 2) spot = "vs_3bet";
        else spot = "vs_4bet";
        let villain: string | null = null;
        for (let i = 0; i < before.length; i += 1) {
          if (before[i] === "raise") {
            villain = pos.get(beforePlayers[i]) ?? null;
          }
        }
        if ((spot === "limp" || spot === "iso") && !villain) {
          for (let i = before.length - 1; i >= 0; i -= 1) {
            if (before[i] !== "call") continue;
            villain = pos.get(beforePlayers[i]) ?? null;
            break;
          }
        }
        last = { action: norm, spot, villain };
      }
      before.push(norm);
      beforePlayers.push(a.player_name);
    }
    if (last) return last;
  }
  // Older / trimmed imports: trust stored spot even without a full action log.
  const stored = (hand.detected_spot || "").trim().toLowerCase();
  if (!stored) return null;
  return {
    spot: stored,
    action: (hand.hero_preflop_action || "fold").toLowerCase(),
    villain: hand.villain_position,
  };
}

const KNOWN = new Set([
  "rfi",
  "limp",
  "iso",
  "vs_open",
  "multiway",
  "vs_3bet",
  "vs_4bet",
  "squeeze",
]);

/** Spot seed for session branch lists (all HH decisions, not only stored detected_spot). */
export function handToSessionSpot(hand: HandRow): {
  spot_key: string;
  hero_position: string;
  villain_position: string | null;
} | null {
  const decision = resolveHeroStrategyDecision(hand);
  if (!decision || !KNOWN.has(decision.spot)) return null;
  const heroRaw = hand.hero_position;
  if (!heroRaw) return null;
  const hero = normalizeChartPos(heroRaw);
  // Opens: no villain. ISO keeps limper as villain when known.
  let villain =
    decision.spot === "rfi"
      ? null
      : decision.villain
        ? normalizeChartPos(decision.villain)
        : hand.villain_position
          ? normalizeChartPos(hand.villain_position)
          : null;
  if (decision.spot === "rfi") villain = null;
  if (villain && villain === hero) villain = null;
  return {
    spot_key: decision.spot,
    hero_position: hero,
    villain_position: villain,
  };
}
