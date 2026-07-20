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
  if (ctx.potType === "unopened") {
    const open = standardRaiseSize(ctx, seat, stackDepth);
    return [
      { action: "FOLD", label: "FOLD", tone: "fold" },
      { action: "CALL", label: "CALL / LIMP", tone: "call" },
      {
        action: "RAISE",
        label: "RAISE",
        sublabel: `Open ${open}bb`,
        defaultSizing: open,
        tone: "raise",
      },
    ];
  }

  if (ctx.potType === "facing_limp") {
    const iso = standardRaiseSize(ctx, seat, stackDepth);
    return [
      { action: "FOLD", label: "FOLD", tone: "fold" },
      { action: "CALL", label: "CALL", tone: "call" },
      {
        action: "RAISE",
        label: "RAISE",
        sublabel: `ISO ${iso}bb`,
        defaultSizing: iso,
        tone: "raise",
      },
    ];
  }

  // facing raise: 3-bet / squeeze → 4-bet → all-in
  const level = ctx.raiseCount;
  const defaultSizing = standardRaiseSize(ctx, seat, stackDepth);
  let raiseLabel = "3-BET";
  if (level === 1 && ctx.callersAfterRaise >= 1) raiseLabel = "SQUEEZE";
  else if (level === 2) raiseLabel = "4-BET";
  else if (level >= 3) raiseLabel = "ALL-IN";

  return [
    { action: "FOLD", label: "FOLD", tone: "fold" },
    { action: "CALL", label: "CALL", tone: "call" },
    {
      action: "RAISE",
      label: raiseLabel,
      sublabel:
        level >= 3
          ? `Stack ${stackDepth}bb`
          : `${defaultSizing}bb`,
      defaultSizing,
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
