import type { ShareStreet } from "../api/client";
import type { ReplayHand } from "../api/client";

export const SHARE_STREET_ORDER: ShareStreet[] = [
  "preflop",
  "flop",
  "turn",
  "river",
];

export const SHARE_STREET_LABELS: Record<ShareStreet, string> = {
  preflop: "Префлоп",
  flop: "Флоп",
  turn: "Терн",
  river: "Ривер",
};

function asStreet(raw: string | null | undefined): ShareStreet | null {
  const s = (raw || "").trim().toLowerCase();
  if (s === "preflop" || s === "flop" || s === "turn" || s === "river") return s;
  return null;
}

/** Streets that actually appear in this hand (actions / board). */
export function streetsPlayedInHand(hand: ReplayHand | null | undefined): ShareStreet[] {
  if (!hand) return ["preflop"];
  const seen = new Set<ShareStreet>(["preflop"]);
  for (const a of hand.actions || []) {
    const st = asStreet(a.street);
    if (st) seen.add(st);
  }
  const board = hand.board?.length ?? 0;
  if (board >= 3) seen.add("flop");
  if (board >= 4) seen.add("turn");
  if (board >= 5) seen.add("river");
  return SHARE_STREET_ORDER.filter((s) => seen.has(s));
}

/** Street at the current replay step (−1 = before first action → preflop). */
export function streetAtAction(
  hand: ReplayHand | null | undefined,
  actionIdx: number,
): ShareStreet {
  if (!hand?.actions?.length) return "preflop";
  if (actionIdx < 0) return "preflop";
  const idx = Math.min(actionIdx, hand.actions.length - 1);
  return asStreet(hand.actions[idx]?.street) || "preflop";
}

/** Played streets unlocked up to (and including) the current replay street. */
export function unlockedCommentStreets(
  hand: ReplayHand | null | undefined,
  actionIdx: number,
): ShareStreet[] {
  const played = streetsPlayedInHand(hand);
  const current = streetAtAction(hand, actionIdx);
  const curRank = SHARE_STREET_ORDER.indexOf(current);
  return played.filter((s) => SHARE_STREET_ORDER.indexOf(s) <= curRank);
}
