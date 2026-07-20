import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ReplayAction, ReplayHand, ReplaySeat } from "../api/client";
import PlayingCard, { CardBack } from "./PlayingCard";

export type AmountUnit = "money" | "bb";

type Props = {
  hand: ReplayHand;
  actionIndex: number;
  amountUnit?: AmountUnit;
  /** Cap displayed seat stacks at this many BB (e.g. 100 for cash trainer). */
  maxStackBb?: number | null;
};

/** Fixed slots: hero at bottom, clockwise. */
type Slot = {
  x: number;
  y: number;
  bx: number;
  by: number;
  badge: "left" | "right";
};

type SeatPos = {
  seat: ReplaySeat;
  slot: Slot;
};

/** Seats + bet chips (% of canvas). Each seat has its own bet spot. */
const TABLE_SLOTS: Record<number, Slot[]> = {
  2: [
    { x: 50, y: 78, bx: 50, by: 64, badge: "left" },
    { x: 50, y: 22, bx: 50, by: 34, badge: "right" },
  ],
  3: [
    { x: 50, y: 78, bx: 50, by: 64, badge: "left" },
    { x: 20, y: 36, bx: 32, by: 42, badge: "right" },
    { x: 80, y: 36, bx: 68, by: 42, badge: "left" },
  ],
  4: [
    { x: 50, y: 78, bx: 50, by: 64, badge: "left" },
    { x: 18, y: 50, bx: 30, by: 50, badge: "right" },
    { x: 50, y: 22, bx: 50, by: 34, badge: "right" },
    { x: 82, y: 50, bx: 70, by: 50, badge: "left" },
  ],
  5: [
    { x: 50, y: 78, bx: 50, by: 64, badge: "left" },
    { x: 18, y: 60, bx: 30, by: 56, badge: "right" },
    { x: 26, y: 28, bx: 36, by: 36, badge: "right" },
    { x: 74, y: 28, bx: 64, by: 36, badge: "left" },
    { x: 82, y: 60, bx: 70, by: 56, badge: "left" },
  ],
  6: [
    { x: 50, y: 84, bx: 50, by: 66, badge: "left" },
    { x: 12, y: 62, bx: 28, by: 56, badge: "right" },
    { x: 12, y: 28, bx: 28, by: 36, badge: "right" },
    { x: 50, y: 12, bx: 50, by: 28, badge: "right" },
    { x: 88, y: 28, bx: 72, by: 36, badge: "left" },
    { x: 88, y: 62, bx: 72, by: 56, badge: "left" },
  ],
  7: [
    { x: 50, y: 78, bx: 50, by: 64, badge: "left" },
    { x: 18, y: 66, bx: 30, by: 58, badge: "right" },
    { x: 16, y: 42, bx: 28, by: 44, badge: "right" },
    { x: 30, y: 22, bx: 38, by: 32, badge: "right" },
    { x: 70, y: 22, bx: 62, by: 32, badge: "left" },
    { x: 84, y: 42, bx: 72, by: 44, badge: "left" },
    { x: 82, y: 66, bx: 70, by: 58, badge: "left" },
  ],
  8: [
    { x: 50, y: 78, bx: 50, by: 64, badge: "left" },
    { x: 22, y: 70, bx: 32, by: 60, badge: "right" },
    { x: 14, y: 50, bx: 26, by: 50, badge: "right" },
    { x: 22, y: 28, bx: 32, by: 36, badge: "right" },
    { x: 50, y: 18, bx: 50, by: 30, badge: "right" },
    { x: 78, y: 28, bx: 68, by: 36, badge: "left" },
    { x: 86, y: 50, bx: 74, by: 50, badge: "left" },
    { x: 78, y: 70, bx: 68, by: 60, badge: "left" },
  ],
  9: [
    { x: 50, y: 78, bx: 50, by: 64, badge: "left" },
    { x: 24, y: 72, bx: 34, by: 62, badge: "right" },
    { x: 14, y: 54, bx: 26, by: 52, badge: "right" },
    { x: 18, y: 34, bx: 30, by: 38, badge: "right" },
    { x: 36, y: 20, bx: 40, by: 30, badge: "right" },
    { x: 64, y: 20, bx: 60, by: 30, badge: "left" },
    { x: 82, y: 34, bx: 70, by: 38, badge: "left" },
    { x: 86, y: 54, bx: 74, by: 52, badge: "left" },
    { x: 76, y: 72, bx: 66, by: 62, badge: "left" },
  ],
};

function slotsForCount(n: number): Slot[] {
  if (n <= 2) return TABLE_SLOTS[2];
  if (n >= 9) return TABLE_SLOTS[9];
  return TABLE_SLOTS[n] ?? TABLE_SLOTS[6];
}

function shortName(name: string) {
  if (name.toLowerCase() === "hero") return "Hero";
  return name.length > 12 ? `${name.slice(0, 10)}…` : name;
}

export function formatAmount(
  n: number,
  unit: AmountUnit,
  bigBlind: number | null | undefined,
  maxBb?: number | null,
) {
  if (unit === "bb" && bigBlind != null && bigBlind > 0) {
    let bb = n / bigBlind;
    if (maxBb != null && Number.isFinite(maxBb)) {
      bb = Math.min(bb, maxBb);
    }
    const abs = Math.abs(bb);
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    const rounded = Number(bb.toFixed(digits));
    return `${rounded} BB`;
  }
  return `$${n.toFixed(2)}`;
}

function actionBadge(
  a: ReplayAction | null,
  unit: AmountUnit,
  bigBlind: number | null,
): { text: string; kind: string } | null {
  if (!a) return null;
  if (a.action === "fold") return { text: "FOLD", kind: "fold" };
  if (a.action === "call") {
    if (a.amount == null || a.amount === 0) return { text: "CHECK", kind: "check" };
    return { text: `CALL ${formatAmount(a.amount, unit, bigBlind)}`, kind: "call" };
  }
  if (a.action === "raise") {
    if (a.amount == null) return { text: "BET", kind: "bet" };
    return { text: `RAISE ${formatAmount(a.amount, unit, bigBlind)}`, kind: "bet" };
  }
  return { text: a.action.toUpperCase(), kind: "check" };
}

function seatLayout(seats: ReplaySeat[]): SeatPos[] {
  const n = seats.length;
  if (n === 0) return [];
  const heroIdx = Math.max(
    0,
    seats.findIndex((s) => s.is_hero),
  );
  const slots = slotsForCount(n);
  return seats.map((seat, i) => {
    const rel = (i - heroIdx + n) % n;
    return { seat, slot: slots[rel] ?? slots[0] };
  });
}

function isAtHandEnd(hand: ReplayHand, actionIndex: number) {
  if (hand.actions.length === 0) return actionIndex >= 0;
  return actionIndex >= hand.actions.length - 1;
}

function boardCardsForStreet(hand: ReplayHand, street: string): string[] {
  const st = (street || "preflop").toLowerCase();
  if (st === "preflop") return [];
  if (st === "flop") return hand.board.slice(0, 3);
  if (st === "turn") return hand.board.slice(0, 4);
  return hand.board.slice(0, 5);
}

function boardForStep(hand: ReplayHand, actionIndex: number): string[] {
  if (isAtHandEnd(hand, actionIndex) && actionIndex >= 0) {
    return hand.board.slice(0, 5);
  }
  // Prefer street of the player about to act so flop appears when turn moves there.
  const next = hand.actions[actionIndex + 1];
  if (next) return boardCardsForStreet(hand, next.street);
  if (actionIndex < 0) return [];
  let street = "preflop";
  for (let i = 0; i <= actionIndex && i < hand.actions.length; i += 1) {
    street = hand.actions[i].street;
  }
  return boardCardsForStreet(hand, street);
}

function holeCards(hand: ReplayHand): string[] {
  if (hand.hero_cards.length >= 2) return [hand.hero_cards[0], hand.hero_cards[1]];
  const seat = hand.seats.find((s) => s.is_hero);
  const raw = seat?.cards || "";
  if (raw.length >= 4) return [raw.slice(0, 2), raw.slice(2, 4)];
  const m = hand.raw_text.match(
    /Dealt to .+?\[([2-9TJQKA][shdc])\s+([2-9TJQKA][shdc])\]/i,
  );
  return m ? [m[1], m[2]] : [];
}

/** Parse shown/mucked hole cards from HH (showdown / summary). */
function parseShownCards(raw: string): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  const card = "([2-9TJQKA][shdc])";
  const patterns = [
    new RegExp(`^([^:\\n]+?):\\s*shows?\\s*\\[${card}\\s+${card}\\]`, "gim"),
    new RegExp(
      `Seat\\s+\\d+:\\s*(.+?)\\s+(?:\\([^)]*\\)\\s+)?(?:showed|mucked)\\s*\\[${card}\\s+${card}\\]`,
      "gim",
    ),
  ];
  for (const re of patterns) {
    for (const m of raw.matchAll(re)) {
      const name = m[1].replace(/\s+\([^)]*\)\s*$/, "").trim().toLowerCase();
      if (!name || name.includes("***")) continue;
      out.set(name, [m[2], m[3]]);
    }
  }
  return out;
}

/** Posted blinds (posts are not stored as replay actions). */
function seedBlindBets(hand: ReplayHand): Map<string, number> {
  const bets = new Map<string, number>();
  const sbAmt = hand.small_blind;
  const bbAmt = hand.big_blind;
  for (const seat of hand.seats) {
    const pos = (seat.position || "").toUpperCase();
    const key = seat.name.toLowerCase();
    if (pos === "SB" && sbAmt != null && sbAmt > 0) bets.set(key, sbAmt);
    if (pos === "BB" && bbAmt != null && bbAmt > 0) bets.set(key, bbAmt);
  }
  if (bets.size === 0 && hand.raw_text) {
    const re =
      /^([^:\n]+?):\s*posts\s+(small blind|big blind)\s+\$?([\d.]+)/gim;
    for (const m of hand.raw_text.matchAll(re)) {
      const key = m[1].trim().toLowerCase();
      const amt = Number(m[3]);
      if (key && Number.isFinite(amt) && amt > 0) bets.set(key, amt);
    }
  }
  // Last resort: blinds exist on hand but seats lack SB/BB labels.
  if (bets.size === 0) {
    const sb = hand.seats.find((s) => (s.position || "").toUpperCase() === "SB");
    const bb = hand.seats.find((s) => (s.position || "").toUpperCase() === "BB");
    if (sb && sbAmt != null && sbAmt > 0) bets.set(sb.name.toLowerCase(), sbAmt);
    if (bb && bbAmt != null && bbAmt > 0) bets.set(bb.name.toLowerCase(), bbAmt);
  }
  return bets;
}

function blindPotFallback(hand: ReplayHand) {
  const sb = hand.small_blind != null && hand.small_blind > 0 ? hand.small_blind : 0;
  const bb = hand.big_blind != null && hand.big_blind > 0 ? hand.big_blind : 0;
  return sb + bb;
}

function streetBetsAndPot(hand: ReplayHand, actionIndex: number) {
  const streetBets = seedBlindBets(hand);
  let committed = 0;
  let street = "preflop";

  const commit = () => {
    for (const v of streetBets.values()) committed += v;
    streetBets.clear();
  };

  if (actionIndex < 0) {
    let pot = committed;
    for (const v of streetBets.values()) pot += v;
    if (pot <= 0) pot = blindPotFallback(hand);
    return { streetBets, pot, street };
  }

  for (let i = 0; i <= actionIndex && i < hand.actions.length; i += 1) {
    const a = hand.actions[i];
    if (a.street !== street) {
      commit();
      street = a.street;
    }
    if (a.action === "fold") continue;
    if (a.amount == null || a.amount <= 0) continue;
    const key = a.player_name.toLowerCase();
    if (a.action === "raise") {
      streetBets.set(key, a.amount);
    } else {
      streetBets.set(key, (streetBets.get(key) || 0) + a.amount);
    }
  }

  let pot = committed;
  for (const v of streetBets.values()) pot += v;
  if (pot <= 0) pot = blindPotFallback(hand);
  return { streetBets, pot, street };
}

export default function PokerTable({
  hand,
  actionIndex,
  amountUnit = "money",
  maxStackBb = null,
}: Props) {
  const layout = useMemo(() => seatLayout(hand.seats), [hand.seats]);
  const atEnd = isAtHandEnd(hand, actionIndex);
  const board = boardForStep(hand, actionIndex);
  const holes = useMemo(() => holeCards(hand), [hand]);
  const shown = useMemo(() => parseShownCards(hand.raw_text || ""), [hand.raw_text]);
  // One step = apply action + highlight who acts next (no empty intermediate).
  const last = actionIndex >= 0 ? hand.actions[actionIndex] : null;
  const next =
    actionIndex + 1 >= 0 && actionIndex + 1 < hand.actions.length
      ? hand.actions[actionIndex + 1]
      : null;
  const toActKey = !atEnd && next ? next.player_name.toLowerCase() : null;
  const bb = hand.big_blind;
  const unit: AmountUnit =
    amountUnit === "bb" && bb != null && bb > 0 ? "bb" : "money";
  const amt = (n: number) => formatAmount(n, unit, bb);
  const stackAmt = (n: number) => formatAmount(n, unit, bb, maxStackBb);
  const { streetBets, pot, street } = useMemo(
    () => streetBetsAndPot(hand, actionIndex),
    [hand, actionIndex],
  );

  // When the next action is on a new street (board dealt), street bets go to pot.
  const nextStreet = (next?.street || street || "preflop").toLowerCase();
  const bettingStreet = (street || "preflop").toLowerCase();
  const chipsToPot =
    !atEnd && next != null && nextStreet !== bettingStreet && streetBets.size > 0;

  const [collectBurst, setCollectBurst] = useState<{
    key: string;
    bets: Map<string, number>;
  } | null>(null);

  useEffect(() => {
    if (!chipsToPot) return;
    const token = `${actionIndex}:${nextStreet}`;
    setCollectBurst({ key: token, bets: new Map(streetBets) });
    const t = window.setTimeout(() => {
      setCollectBurst((cur) => (cur?.key === token ? null : cur));
    }, 520);
    return () => window.clearTimeout(t);
  }, [chipsToPot, actionIndex, nextStreet, streetBets]);

  const folded = new Set<string>();
  for (let i = 0; i <= actionIndex && i < hand.actions.length; i += 1) {
    if (hand.actions[i].action === "fold") {
      folded.add(hand.actions[i].player_name.toLowerCase());
    }
  }
  const justFoldedKey =
    last?.action === "fold" ? last.player_name.toLowerCase() : null;

  const streetLabel = atEnd
    ? "showdown"
    : next
      ? next.street || street
      : street;

  const seatCount = layout.length;
  const visibleBets = atEnd || chipsToPot ? new Map<string, number>() : streetBets;
  const animBets = collectBurst?.bets ?? null;

  return (
    <div
      className={`pr-canvas poker-ok${seatCount === 2 ? " is-hu" : ""}`}
    >
      <div className="pr-table">
        <div className="pr-table-inner" aria-hidden />
        <div className="pr-table-rail" aria-hidden />
        <div className="pr-table-felt-line" aria-hidden />

        <div className="pr-center">
          <div className={`pr-pot${chipsToPot || collectBurst ? " is-collecting" : ""}`}>
            <span>
              Банк : <strong>{amt(pot)}</strong>
            </span>
          </div>

          <div className="pr-board" aria-label="Community cards">
            {[0, 1, 2, 3, 4].map((i) => {
              const code = board[i];
              return (
                <div key={i} className={`pr-board-slot${code ? " filled" : ""}`}>
                  {code ? <PlayingCard code={code} size="md" /> : null}
                </div>
              );
            })}
          </div>

          <div className="pr-street">{streetLabel}</div>
        </div>

        {layout.map(({ seat, slot }) => {
          const key = seat.name.toLowerCase();
          const bet = visibleBets.get(key) || 0;
          const collectAmt = animBets?.get(key) || 0;
          if (bet <= 0 && collectAmt <= 0) return null;
          const showCollect = collectAmt > 0 && bet <= 0;
          const amount = showCollect ? collectAmt : bet;
          return (
            <div
              key={`bet-${seat.seat}-${showCollect ? collectBurst?.key : "live"}`}
              className={`pr-street-bet${showCollect ? " is-to-pot" : ""}`}
              style={
                {
                  left: `${slot.bx}%`,
                  top: `${slot.by}%`,
                  ["--bx"]: slot.bx,
                  ["--by"]: slot.by,
                } as CSSProperties
              }
            >
              <span className="pr-chip" aria-hidden>
                <span className="pr-chip-ring" />
                <span className="pr-chip-core" />
              </span>
              <span>{amt(amount)}</span>
            </div>
          );
        })}

        {layout.map(({ seat, slot }) => {
          const key = seat.name.toLowerCase();
          const isFolded = folded.has(key);
          const isJustFolded = justFoldedKey === key;
          const isActor = !atEnd && toActKey != null && toActKey === key;
          const justActed =
            last != null && last.player_name.toLowerCase() === key;
          const isHero = seat.is_hero;
          const isPlaceholder = /^seat\s+\d+$/i.test(seat.name);
          const shownCards = atEnd && !isFolded ? shown.get(key) : undefined;
          const badge = justActed
            ? actionBadge(last, unit, bb)
            : isFolded
              ? { text: "FOLD", kind: "fold" as const }
              : shownCards
                ? { text: "SHOW", kind: "show" as const }
                : null;
          const revealed: [string, string] | undefined =
            isHero && holes.length === 2 && !isFolded
              ? [holes[0], holes[1]]
              : shownCards;
          const cardSize = isHero ? "md" : "sm";

          return (
            <div
              key={seat.seat}
              className="pr-seat-anchor"
              style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            >
              {seat.is_button ? (
                <span
                  className={`pr-dealer-chip badge-${slot.badge}`}
                  aria-label="Dealer"
                >
                  D
                </span>
              ) : null}

              <div
                className={[
                  "pr-seat",
                  isHero ? "is-hero" : "",
                  isFolded ? "is-folded" : "",
                  isJustFolded ? "is-folding" : "",
                  isPlaceholder ? "is-placeholder" : "",
                  isActor ? "is-turn" : "",
                  atEnd && revealed ? "is-showdown" : "",
                  `badge-${slot.badge}`,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div
                  className="pr-seat-cards"
                  style={
                    {
                      ["--mx"]: 50 - slot.x,
                      ["--my"]: 48 - slot.y,
                    } as CSSProperties
                  }
                >
                  {!isPlaceholder && !isFolded ? (
                    revealed ? (
                      <>
                        <PlayingCard code={revealed[0]} size={cardSize} />
                        <PlayingCard code={revealed[1]} size={cardSize} />
                      </>
                    ) : (
                      <>
                        <CardBack size={cardSize} />
                        <CardBack size={cardSize} />
                      </>
                    )
                  ) : null}
                  {!isPlaceholder && isFolded ? (
                    <div
                      className={`pr-muck-cards${isJustFolded ? " is-animating" : ""}`}
                      aria-hidden
                    >
                      <CardBack size={cardSize} />
                      <CardBack size={cardSize} />
                    </div>
                  ) : null}
                </div>

                <div className="pr-seat-name" title={seat.name}>
                  {seat.position ? (
                    <span className="pr-pos-badge">{seat.position}</span>
                  ) : null}
                  <span>{shortName(seat.name)}</span>
                </div>
                <div className="pr-seat-stack">
                  <strong>{seat.stack != null ? stackAmt(seat.stack) : "—"}</strong>
                </div>

                <div className="pr-seat-action">
                  {badge ? (
                    <span className={`pr-action-pill ${badge.kind}`}>{badge.text}</span>
                  ) : (
                    <span className="pr-action-pill ghost" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
