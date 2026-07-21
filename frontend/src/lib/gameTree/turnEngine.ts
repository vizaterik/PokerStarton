import { liveSeats, nextSeat, seatLabel } from "./seats";
import { standardRaiseSize } from "./standardSizings";
import type {
  DecisionButton,
  GameTreeNode,
  Seat,
  SpotContext,
  TableSize,
  TreeAction,
} from "./types";

/** Who acted to create each child along the path. */
export function actorsAlongPath(
  path: GameTreeNode[],
): { player: Seat; action: TreeAction; sizingBB?: number }[] {
  const out: { player: Seat; action: TreeAction; sizingBB?: number }[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const parent = path[i - 1];
    const child = path[i];
    out.push({
      player: parent.activePlayer,
      action: child.actionTaken,
      sizingBB: child.sizingBB,
    });
  }
  return out;
}

/** Second-to-last raiser on the path (opener facing a 3-bet, 3-bettor facing a 4-bet, …). */
export function previousAggressor(path: GameTreeNode[]): Seat | null {
  const raises = actorsAlongPath(path).filter((s) => s.action === "RAISE");
  if (raises.length < 2) return null;
  return raises[raises.length - 2]?.player ?? null;
}

export function deriveContext(path: GameTreeNode[]): SpotContext {
  const folded: Seat[] = [];
  let raiseCount = 0;
  let lastAggressor: Seat | null = null;
  let lastRaiseSize: number | null = null;
  let limpCount = 0;
  let callersAfterRaise = 0;

  for (const step of actorsAlongPath(path)) {
    if (step.action === "FOLD") {
      folded.push(step.player);
      continue;
    }
    if (step.action === "RAISE") {
      raiseCount += 1;
      lastAggressor = step.player;
      lastRaiseSize = step.sizingBB ?? null;
      limpCount = 0;
      callersAfterRaise = 0;
      continue;
    }
    if (step.action === "CALL") {
      if (raiseCount === 0) limpCount += 1;
      else callersAfterRaise += 1;
    }
  }

  let potType: SpotContext["potType"] = "unopened";
  if (raiseCount > 0) potType = "facing_raise";
  else if (limpCount > 0) potType = "facing_limp";

  return {
    potType,
    raiseCount,
    lastRaiseSize,
    lastAggressor,
    folded,
    limpCount,
    callersAfterRaise,
  };
}

export function decisionButtons(
  ctx: SpotContext,
  stackDepth = 100,
  seat: Seat = "BTN",
): DecisionButton[] {
  return wizardAnswerOptions(ctx, seat, stackDepth);
}

/**
 * GTO Wizard Cash (Standard) action-tree answers for one seat.
 * Labels match Wizard: Fold / Call / Raise {size} / All-in — not 3-BET/4-BET words.
 *
 * RFI (UTG–BTN): Fold + Raise only (no limp).
 * SB unopened: Fold + Call + Raise.
 * vs limp: Fold + Call + Raise (BB: Check + Raise).
 * vs open/squeeze: Fold + Call + Raise.
 * vs 3-bet: Fold + Call + Raise + All-in.
 * vs 4-bet+: Fold + Call + All-in.
 */
export function wizardAnswerOptions(
  ctx: SpotContext,
  seat: Seat,
  stackDepth = 100,
): DecisionButton[] {
  const fmt = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };

  if (ctx.potType === "unopened") {
    const open = standardRaiseSize(ctx, seat, stackDepth);
    if (seat === "SB") {
      return [
        { id: "fold", action: "FOLD", label: "Fold", tone: "fold" },
        { id: "call", action: "CALL", label: "Call", tone: "call" },
        {
          id: "raise",
          action: "RAISE",
          label: `Raise ${fmt(open)}`,
          defaultSizing: open,
          tone: "raise",
        },
      ];
    }
    // Wizard open: Fold + Raise {size} (no limp from EP/IP).
    return [
      { id: "fold", action: "FOLD", label: "Fold", tone: "fold" },
      {
        id: "raise",
        action: "RAISE",
        label: `Raise ${fmt(open)}`,
        defaultSizing: open,
        tone: "raise",
      },
    ];
  }

  if (ctx.potType === "facing_limp") {
    const iso = standardRaiseSize(ctx, seat, stackDepth);
    if (seat === "BB") {
      // Wizard: Check / Raise (check = complete limps → CALL in our tree).
      return [
        { id: "check", action: "CALL", label: "Check", tone: "call" },
        {
          id: "raise",
          action: "RAISE",
          label: `Raise ${fmt(iso)}`,
          defaultSizing: iso,
          tone: "raise",
        },
      ];
    }
    return [
      { id: "fold", action: "FOLD", label: "Fold", tone: "fold" },
      { id: "call", action: "CALL", label: "Call", tone: "call" },
      {
        id: "raise",
        action: "RAISE",
        label: `Raise ${fmt(iso)}`,
        defaultSizing: iso,
        tone: "raise",
      },
    ];
  }

  const level = ctx.raiseCount;
  const raiseSize = standardRaiseSize(ctx, seat, stackDepth);
  const isSqueeze = level === 1 && ctx.callersAfterRaise >= 1;

  if (level >= 3) {
    const callTo = ctx.lastRaiseSize;
    return [
      { id: "fold", action: "FOLD", label: "Fold", tone: "fold" },
      {
        id: "call",
        action: "CALL",
        label: callTo != null ? `Call ${fmt(callTo)}` : "Call",
        tone: "call",
      },
      {
        id: "allin",
        action: "RAISE",
        label: "All-in",
        defaultSizing: stackDepth,
        tone: "raise",
      },
    ];
  }

  if (level === 2) {
    const callTo = ctx.lastRaiseSize;
    return [
      { id: "fold", action: "FOLD", label: "Fold", tone: "fold" },
      {
        id: "call",
        action: "CALL",
        label: callTo != null ? `Call ${fmt(callTo)}` : "Call",
        tone: "call",
      },
      {
        id: "raise",
        action: "RAISE",
        label: `Raise ${fmt(raiseSize)}`,
        defaultSizing: raiseSize,
        tone: "raise",
      },
      {
        id: "allin",
        action: "RAISE",
        label: "All-in",
        defaultSizing: stackDepth,
        tone: "raise",
      },
    ];
  }

  // vs open → Raise; after open + call(s) → Squeeze (only for the seat that raises).
  // The caller themselves never sees Squeeze — their locked answers use prior context.
  const callTo = ctx.lastRaiseSize;
  return [
    { id: "fold", action: "FOLD", label: "Fold", tone: "fold" },
    {
      id: "call",
      action: "CALL",
      label: callTo != null ? `Call ${fmt(callTo)}` : "Call",
      tone: "call",
    },
    {
      id: isSqueeze ? "squeeze" : "raise",
      action: "RAISE",
      label: isSqueeze
        ? `Squeeze ${fmt(raiseSize)}`
        : `Raise ${fmt(raiseSize)}`,
      defaultSizing: raiseSize,
      tone: "raise",
    },
  ];
}

export type NextTurnResult =
  | {
      kind: "continue";
      nextPlayer: Seat;
      awaitingFlop: false;
    }
  | {
      kind: "flop";
      nextPlayer: null;
      awaitingFlop: true;
    }
  | {
      kind: "dead";
      nextPlayer: null;
      awaitingFlop: false;
    };

/**
 * After a CALL/FOLD facing a raise: preflop is closed when the next live
 * seat is the last aggressor (everyone left has matched) — including
 * multiway pots with 2+ callers (e.g. UTG Raise → HJ Call → BB Call → flop).
 */
function closesFacingRaise(
  tableSize: TableSize,
  actor: Seat,
  folded: Set<Seat>,
  lastAggressor: Seat | null,
): boolean {
  if (!lastAggressor || folded.has(lastAggressor)) return true;
  const next = nextSeat(tableSize, actor, folded);
  return !next || next === lastAggressor;
}

/**
 * After `actor` takes `action`, compute who acts next (or flop / dead hand).
 */
export function resolveNextTurn(
  tableSize: TableSize,
  pathToParent: GameTreeNode[],
  actor: Seat,
  action: Exclude<TreeAction, "ROOT" | "CHECK">,
): NextTurnResult {
  const ctx = deriveContext(pathToParent);
  const folded = new Set<Seat>(ctx.folded);

  if (action === "FOLD") {
    folded.add(actor);
    const alive = liveSeats(tableSize, folded);

    // Facing a raise/open: folds that leave only the aggressor (or return
    // action to them) close a paint-ready branch — not a dead hand.
    // Solo RFI (open → everyone folds) must end awaitingFlop so «+» can seed.
    if (ctx.raiseCount > 0) {
      if (
        alive.length <= 1 ||
        closesFacingRaise(tableSize, actor, folded, ctx.lastAggressor)
      ) {
        return { kind: "flop", nextPlayer: null, awaitingFlop: true };
      }
      const next = nextSeat(tableSize, actor, folded);
      if (!next) return { kind: "flop", nextPlayer: null, awaitingFlop: true };
      return { kind: "continue", nextPlayer: next, awaitingFlop: false };
    }

    // Unopened: only one seat left → no voluntary pot (walk / dead).
    if (alive.length <= 1) {
      return { kind: "dead", nextPlayer: null, awaitingFlop: false };
    }

    // Unopened: keep folding until a live seat acts (BB still gets option)
    const next = nextSeat(tableSize, actor, folded);
    if (!next) return { kind: "dead", nextPlayer: null, awaitingFlop: false };
    return { kind: "continue", nextPlayer: next, awaitingFlop: false };
  }

  if (action === "RAISE") {
    const next = nextSeat(tableSize, actor, folded);
    if (!next) return { kind: "dead", nextPlayer: null, awaitingFlop: false };
    return { kind: "continue", nextPlayer: next, awaitingFlop: false };
  }

  // CALL / limp
  if (ctx.raiseCount === 0) {
    // Limped pots: BB completes the round → postflop (1 limp, 2 limps, …)
    if (actor === "BB") {
      return { kind: "flop", nextPlayer: null, awaitingFlop: true };
    }
    const next = nextSeat(tableSize, actor, folded);
    if (!next) return { kind: "flop", nextPlayer: null, awaitingFlop: true };
    return { kind: "continue", nextPlayer: next, awaitingFlop: false };
  }

  // Facing a raise: Call (including the 2nd+ cold-call) closes when
  // action would return to the aggressor → saved postflop branch.
  if (closesFacingRaise(tableSize, actor, folded, ctx.lastAggressor)) {
    return { kind: "flop", nextPlayer: null, awaitingFlop: true };
  }
  const next = nextSeat(tableSize, actor, folded);
  if (!next) return { kind: "flop", nextPlayer: null, awaitingFlop: true };
  return { kind: "continue", nextPlayer: next, awaitingFlop: false };
}

export function actionBadgeLabel(
  player: Seat,
  action: TreeAction,
  _sizingBB: number | undefined,
  raiseIndex: number,
  wasSqueeze = false,
): string {
  const seat = seatLabel(player);
  if (action === "FOLD") return `${seat} Fold`;
  if (action === "CALL") return raiseIndex === 0 ? `${seat} Limp` : `${seat} Call`;
  if (action === "RAISE") {
    if (raiseIndex <= 1) return `${seat} Raise`;
    if (raiseIndex === 2) return wasSqueeze ? `${seat} Squeeze` : `${seat} 3-bet`;
    if (raiseIndex === 3) return `${seat} 4-bet`;
    return `${seat} All-in`;
  }
  return `${seat} ${action}`;
}

export function contextHeadline(ctx: SpotContext, player: Seat): string {
  const seat = seatLabel(player);
  if (ctx.potType === "unopened") return `Action for: ${seat}`;
  if (ctx.potType === "facing_limp") {
    return `Action for: ${seat} · facing limp`;
  }
  const lvl =
    ctx.raiseCount === 1
      ? ctx.callersAfterRaise >= 1
        ? "open + call (squeeze)"
        : "open raise"
      : ctx.raiseCount === 2
        ? "3-bet"
        : ctx.raiseCount === 3
          ? "4-bet"
          : "all-in";
  const sz = ctx.lastRaiseSize != null ? ` ${ctx.lastRaiseSize}bb` : "";
  const vs = ctx.lastAggressor ? ` from ${seatLabel(ctx.lastAggressor)}` : "";
  return `Action for: ${seat} · facing ${lvl}${sz}${vs}`;
}
