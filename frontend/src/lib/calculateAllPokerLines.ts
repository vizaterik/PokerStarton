/**
 * Hand2Note-style cumulative line engine
 * --------------------------------------
 * Single-pass O(n) calculator for:
 *   1. Amount Won (Net)
 *   2. All-In EV
 *   3. Won without Showdown (non-SD)
 *   4. Won at Showdown (SD)
 *
 * Units are whatever the caller stores on the hand (BB or currency) —
 * keep them consistent across a session.
 */

export type Street = "preflop" | "flop" | "turn" | "river";

/**
 * Minimal hand shape for the tracker formulas.
 * Prefer explicit chipsWon/chipsInvested; otherwise set handNetWon directly.
 */
export type PokerHand = {
  handNumber: number;

  /** Chips collected by hero this hand (pot share + returned uncalled). */
  chipsWon?: number;
  /** Total chips hero put into the pot this hand. */
  chipsInvested?: number;
  /** Shortcut when won/invested are already netted: chipsWon − chipsInvested. */
  handNetWon?: number;

  /**
   * True if hero reached showdown (hole cards shown/mucked at SD).
   * H2N red/blue partition: SD vs non-SD of *hero result*.
   */
  wentToShowdown: boolean;

  /**
   * Street where the decisive all-in closed (all live players all-in / called).
   * Null / undefined ⇒ no all-in EV adjustment (Case A).
   */
  allInStreet?: Street | null;
  /**
   * True when board cards remain after all-in (preflop/flop/turn AI).
   * River all-ins have no cards to come → EV = Net (Case A).
   */
  allInCardsToCome?: boolean;
  /** Pot size at the moment action closed on the all-in. */
  totalPotAtAllIn?: number;
  /** Hero’s total investment into that pot (for EV: pot*eq − investment). */
  playerTotalInvestment?: number;
  /**
   * Hero win equity in [0, 1] vs known opposing hands at that street.
   * Must be supplied by an equity engine (or mock). Required for Case B.
   */
  allInEquity?: number;
};

export type ChartPoint = {
  handNumber: number;
  /** Cumulative Amount Won */
  netWon: number;
  /** Cumulative All-In EV */
  evWon: number;
  /** Cumulative Won at Showdown */
  showdownWon: number;
  /** Cumulative Won without Showdown */
  nonShowdownWon: number;
};

/** Per-hand deltas before accumulation (useful for tests / debugging). */
export type HandLineDelta = {
  handNumber: number;
  handNetWon: number;
  handShowdown: number;
  handNonShowdown: number;
  handEV: number;
};

const EPS = 1e-9;

/** Amount Won: chips won − chips invested (rake already reflected in HH nets). */
export function computeHandNetWon(hand: PokerHand): number {
  if (hand.handNetWon != null && Number.isFinite(hand.handNetWon)) {
    return hand.handNetWon;
  }
  const won = hand.chipsWon ?? 0;
  const invested = hand.chipsInvested ?? 0;
  return won - invested;
}

/**
 * H2N blue/red split.
 *   SD     → all of handNetWon on blue, 0 on red
 *   non-SD → all of handNetWon on red, 0 on blue
 * Invariant: handNetWon === handShowdown + handNonShowdown
 */
export function computeShowdownSplit(
  handNetWon: number,
  wentToShowdown: boolean,
): { handShowdown: number; handNonShowdown: number } {
  if (wentToShowdown) {
    return { handShowdown: handNetWon, handNonShowdown: 0 };
  }
  return { handShowdown: 0, handNonShowdown: handNetWon };
}

/**
 * All-In EV for one hand.
 * Case A — no early all-in (or river AI / missing equity data): EV = Net.
 * Case B — all-in pre-river with equity: EV = (pot − fees) * equity − investment.
 */
export function computeHandAllInEV(hand: PokerHand, handNetWon: number): number {
  const street = hand.allInStreet;
  const cardsToCome = hand.allInCardsToCome === true;
  const pot = hand.totalPotAtAllIn;
  const invest = hand.playerTotalInvestment;
  const eq = hand.allInEquity;

  const earlyAi =
    street != null &&
    street !== "river" &&
    cardsToCome &&
    pot != null &&
    Number.isFinite(pot) &&
    invest != null &&
    Number.isFinite(invest) &&
    eq != null &&
    Number.isFinite(eq);

  if (!earlyAi) return handNetWon;
  return pot! * eq! - invest!;
}

function assertNetEqualsSdPlusNsd(
  handNetWon: number,
  handShowdown: number,
  handNonShowdown: number,
  handNumber: number,
): void {
  const sum = handShowdown + handNonShowdown;
  if (Math.abs(handNetWon - sum) > EPS) {
    throw new Error(
      `[H2N] Hand #${handNumber}: netWon (${handNetWon}) !== ` +
        `showdown (${handShowdown}) + nonShowdown (${handNonShowdown})`,
    );
  }
}

/** Compute four per-hand deltas (no accumulation). */
export function calculateHandLineDeltas(hand: PokerHand): HandLineDelta {
  const handNetWon = computeHandNetWon(hand);
  const { handShowdown, handNonShowdown } = computeShowdownSplit(
    handNetWon,
    hand.wentToShowdown,
  );
  assertNetEqualsSdPlusNsd(handNetWon, handShowdown, handNonShowdown, hand.handNumber);

  return {
    handNumber: hand.handNumber,
    handNetWon,
    handShowdown,
    handNonShowdown,
    handEV: computeHandAllInEV(hand, handNetWon),
  };
}

/** Single-pass cumulative runner for 20k+ hands. */
export function calculateAllPokerLines(hands: PokerHand[]): ChartPoint[] {
  let netWon = 0;
  let evWon = 0;
  let showdownWon = 0;
  let nonShowdownWon = 0;

  const out: ChartPoint[] = new Array(hands.length);

  for (let i = 0; i < hands.length; i += 1) {
    const hand = hands[i];
    const d = calculateHandLineDeltas(hand);

    netWon += d.handNetWon;
    evWon += d.handEV;
    showdownWon += d.handShowdown;
    nonShowdownWon += d.handNonShowdown;

    if (Math.abs(netWon - (showdownWon + nonShowdownWon)) > EPS) {
      throw new Error(
        `[H2N] Cumulative drift at hand #${hand.handNumber}: ` +
          `net=${netWon} sd=${showdownWon} nsd=${nonShowdownWon}`,
      );
    }

    out[i] = {
      handNumber: hand.handNumber,
      netWon,
      evWon,
      showdownWon,
      nonShowdownWon,
    };
  }

  return out;
}

export const MOCK_ALL_IN_HANDS: PokerHand[] = [
  {
    handNumber: 1,
    handNetWon: 3,
    wentToShowdown: false,
  },
  {
    handNumber: 2,
    handNetWon: 50,
    wentToShowdown: true,
    allInStreet: "flop",
    allInCardsToCome: true,
    totalPotAtAllIn: 100,
    playerTotalInvestment: 50,
    allInEquity: 0.3,
  },
  {
    handNumber: 3,
    handNetWon: -2,
    wentToShowdown: true,
    allInStreet: null,
  },
];

export const MOCK_ALL_POKER_LINES = calculateAllPokerLines(MOCK_ALL_IN_HANDS);
