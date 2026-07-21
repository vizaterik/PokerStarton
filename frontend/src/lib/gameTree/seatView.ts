import { shortSavedBranchLabel, potKindTag, inferPotKind } from "./branches";
import {
  formatRaiseLabel,
  nextRaiseLabel,
  raiseLabelAtIndex,
  shortRaiseWord,
  type RaiseLabel,
} from "./raiseLabels";
import { seatLabel, seatsFor } from "./seats";
import { actorsAlongPath, deriveContext } from "./turnEngine";
import type { GameTreeNode, Seat, TableSize, TreeAction } from "./types";

export type WindowStatus =
  | "active"
  | "auto-folded"
  | "folded"
  | "locked"
  | "waiting"
  | "next";

export type SeatWindow = {
  seat: Seat;
  label: string;
  status: WindowStatus;
  statusLabel: string;
  /** Decision node where this seat paints / rewinds */
  nodeId: string | null;
  /**
   * Действие на ТЕКУЩЕЙ линии для этой позиции.
   * У active всегда null — игрок выбирает ответ на новую ситуацию
   * (например UTG уже открыл, но сейчас решает vs 3-bet).
   */
  lockedAction: TreeAction | null;
  lockedSizing: number | null;
  autoFold: boolean;
  /** Метка агрессии для кнопки Raise: RAISE / 3-BET / SQUEEZE / 4-BET / ALL-IN */
  raiseLabel: RaiseLabel;
  /** Текст кнопки Raise под контекст линии */
  raisePillText: string;
  /** Текст кнопки Call: LIMP или CALL */
  callPillText: string;
  /** Сколько рейзов уже было на линии (для подписей) */
  facingRaiseCount: number;
  /** High-contrast border tone for the window chrome */
  borderTone: "none" | "fold" | "call" | "raise" | "active";
};

function raisePillText(label: RaiseLabel, sizingBB?: number | null): string {
  if (label === "ALL-IN") return "ALL-IN";
  if (label === "4-BET") return "4-BET";
  if (label === "SQUEEZE") return "SQUEEZE";
  if (label === "3-BET") return "3-BET";
  if (sizingBB != null) return `RAISE`;
  return "RAISE";
}

function lockedStatusLabel(
  action: TreeAction,
  raiseIndex: number,
  sizingBB?: number,
  stackDepth?: number,
  wasSqueeze = false,
): string {
  if (action === "RAISE") {
    if (sizingBB != null && stackDepth != null && sizingBB >= stackDepth - 0.5) {
      return formatRaiseLabel("ALL-IN", sizingBB, stackDepth);
    }
    const rl = raiseLabelAtIndex(raiseIndex, wasSqueeze);
    return formatRaiseLabel(rl, sizingBB);
  }
  if (action === "CALL") return raiseIndex === 0 ? "Limp" : "Call";
  if (action === "FOLD") return "Fold";
  return "Locked";
}

/**
 * Окна позиций по живой линии.
 * Кнопки Fold / Call / Raise (3-bet / 4-bet) подстраиваются под ответы оппонентов.
 */
export function buildSeatWindows(
  path: GameTreeNode[],
  activeNode: GameTreeNode,
  stackDepth = 100,
  tableSize: TableSize = 6,
): SeatWindow[] {
  const ctx = deriveContext(path);
  const folded = new Set(ctx.folded);
  const actors = actorsAlongPath(path);
  const seats = seatsFor(tableSize);

  const acted = new Map<
    Seat,
    {
      nodeId: string;
      action: TreeAction;
      sizingBB?: number;
      raiseIndex: number;
      wasSqueeze: boolean;
      autoFold: boolean;
    }
  >();

  let raiseIndex = 0;
  let callersSinceRaise = 0;
  for (let i = 0; i < actors.length; i += 1) {
    const step = actors[i];
    const parent = path[i];
    const child = path[i + 1];
    let wasSqueeze = false;
    if (step.action === "RAISE") {
      raiseIndex += 1;
      wasSqueeze = raiseIndex === 2 && callersSinceRaise >= 1;
      callersSinceRaise = 0;
    } else if (step.action === "CALL" && raiseIndex > 0) {
      callersSinceRaise += 1;
    }
    // Последнее действие позиции на линии (если ходила дважды — берём последнее)
    acted.set(step.player, {
      nodeId: parent.id,
      action: step.action,
      sizingBB: step.sizingBB,
      raiseIndex,
      wasSqueeze,
      autoFold: Boolean(child?.autoFold),
    });
  }

  const activeSeat = activeNode.awaitingFlop ? null : activeNode.activePlayer;
  // Какой агрессивный ответ доступен СЕЙЧАС (для active / waiting)
  const upcoming = nextRaiseLabel(ctx.raiseCount, ctx.callersAfterRaise);

  return seats.map((seat) => {
    const info = acted.get(seat);
    let status: WindowStatus = "waiting";

    /**
     * Prior raiser/caller still live after a later re-raise — show facing
     * Fold/Call/4-bet pills instead of locking the old open/3-bet.
     * (UTG open → HJ 3-bet → UTG needs vs-3bet buttons while CO would be next.)
     */
    const facesReRaise =
      Boolean(info) &&
      !folded.has(seat) &&
      seat !== activeSeat &&
      seat !== ctx.lastAggressor &&
      ((info!.action === "RAISE" && info!.raiseIndex < ctx.raiseCount) ||
        (info!.action === "CALL" &&
          info!.raiseIndex > 0 &&
          info!.raiseIndex < ctx.raiseCount));

    if (info?.autoFold || (info?.action === "FOLD" && info.autoFold)) {
      status = "auto-folded";
    } else if (folded.has(seat) || info?.action === "FOLD") {
      status = "folded";
    } else if (activeSeat === seat) {
      // Ход этой позиции СЕЙЧАС — даже если раньше она уже рейзила/коллила
      status = "active";
    } else if (facesReRaise) {
      status = "waiting";
    } else if (info) {
      status = "locked";
    }

    /**
     * Active / waiting (incl. facesReRaise): нет lockedAction — новый ответ
     * (UTG open уже в истории; сейчас UTG выбирает Fold/Call/4-bet vs 3-bet).
     */
    const lockedAction: TreeAction | null =
      status === "active" || status === "waiting" ? null : (info?.action ?? null);

    let raiseLabel: RaiseLabel = upcoming;
    if (status === "locked" && info?.action === "RAISE") {
      // Пуш по стеку всегда ALL-IN, даже если это 3-я агрессия (vs 3-bet)
      const isAllIn =
        info.sizingBB != null && info.sizingBB >= stackDepth - 0.5;
      raiseLabel = isAllIn
        ? "ALL-IN"
        : raiseLabelAtIndex(info.raiseIndex, info.wasSqueeze);
    } else if (status === "active" || status === "waiting") {
      raiseLabel = upcoming;
    }

    const raiseText =
      status === "locked" && info?.action === "RAISE"
        ? raisePillText(raiseLabel, info.sizingBB)
        : raisePillText(raiseLabel);

    const callText =
      status === "active" || status === "waiting"
        ? ctx.raiseCount === 0 && ctx.limpCount === 0
          ? "LIMP"
          : "CALL"
        : info?.action === "CALL" && info.raiseIndex === 0
          ? "LIMP"
          : "CALL";

    const statusLabel =
      status === "active" || (status === "waiting" && facesReRaise)
        ? ctx.raiseCount === 0
          ? "Active"
          : ctx.raiseCount === 1
            ? ctx.callersAfterRaise >= 1
              ? "vs Open+Call · SQUEEZE"
              : "vs Open · 3-BET"
            : ctx.raiseCount === 2
              ? "vs 3-bet · 4-BET / ALL-IN"
              : `vs 4-bet · ${upcoming}`
        : status === "auto-folded"
          ? "Auto-Folded"
          : status === "folded"
            ? "Folded"
            : status === "locked" && info
              ? lockedStatusLabel(
                  info.action,
                  info.raiseIndex,
                  info.sizingBB,
                  stackDepth,
                  info.wasSqueeze,
                )
              : "Waiting";

    let borderTone: SeatWindow["borderTone"] = "none";
    if (status === "active" || facesReRaise) borderTone = "active";
    else if (info?.action === "RAISE") borderTone = "raise";
    else if (info?.action === "CALL") borderTone = "call";
    else if (info?.action === "FOLD" || status === "auto-folded") borderTone = "fold";

    return {
      seat,
      label: seatLabel(seat),
      status,
      statusLabel,
      nodeId:
        status === "active"
          ? activeNode.id
          : facesReRaise
            ? null
            : (info?.nodeId ?? null),
      lockedAction,
      lockedSizing: lockedAction === "RAISE" ? (info?.sizingBB ?? null) : null,
      autoFold: Boolean(info?.autoFold),
      raiseLabel,
      raisePillText: raiseText,
      callPillText: callText,
      facingRaiseCount: ctx.raiseCount,
      borderTone,
    };
  });
}

/** @deprecated alias — prefer buildSeatWindows */
export function buildSeatColumns(
  path: GameTreeNode[],
  activeNode: GameTreeNode,
  stackDepth = 100,
  tableSize: TableSize = 6,
) {
  return buildSeatWindows(path, activeNode, stackDepth, tableSize).map((w) => ({
    seat: w.seat,
    label: w.label,
    state:
      w.status === "auto-folded"
        ? ("folded" as const)
        : w.status === "next"
          ? ("waiting" as const)
          : (w.status as "active" | "locked" | "folded" | "waiting"),
    nodeId: w.nodeId,
    lockedAction: w.lockedAction,
    lockedSizing: w.lockedSizing,
    raiseLabel: w.raiseLabel,
  }));
}

export function historyChainText(
  path: GameTreeNode[],
  activeNode: GameTreeNode,
  stackDepth = 100,
): { nodeId: string; text: string; current: boolean; potTag?: string }[] {
  // Finished branch: only seats that reached the flop (Raise / Call), no folds.
  if (activeNode.awaitingFlop && path.length > 1) {
    let raiseCount = 0;
    let callersSinceRaise = 0;
    const raiseSizings: number[] = [];
    const parts: { nodeId: string; text: string; current: boolean; potTag?: string }[] =
      [];

    for (let i = 0; i < path.length - 1; i += 1) {
      const parent = path[i];
      const child = path[i + 1];
      if (child.actionTaken === "FOLD") continue;

      const seat = seatLabel(parent.activePlayer);
      let text = `${seat} ${child.actionTaken}`;
      if (child.actionTaken === "RAISE") {
        raiseCount += 1;
        raiseSizings.push(child.sizingBB ?? 0);
        const wasSqueeze = raiseCount === 2 && callersSinceRaise >= 1;
        const rl = raiseLabelAtIndex(raiseCount, wasSqueeze);
        text = `${seat} ${shortRaiseWord(rl)}`;
        callersSinceRaise = 0;
      } else if (child.actionTaken === "CALL") {
        if (raiseCount > 0) callersSinceRaise += 1;
        text = `${seat} ${raiseCount === 0 ? "Limp" : "Call"}`;
      }
      parts.push({ nodeId: parent.id, text, current: false });
    }

    const pot = inferPotKind(raiseCount, raiseSizings, stackDepth);
    if (parts.length === 0) {
      const paintTarget =
        path.length >= 2 ? path[path.length - 2] : path[0];
      return [
        {
          nodeId: paintTarget.id,
          text: shortSavedBranchLabel(path),
          potTag: potKindTag(pot),
          current: true,
        },
      ];
    }

    parts[0] = { ...parts[0], potTag: potKindTag(pot) };
    parts[parts.length - 1] = { ...parts[parts.length - 1], current: true };
    return parts;
  }

  const parts: { nodeId: string; text: string; current: boolean }[] = [];
  let raiseIndex = 0;
  let callersSinceRaise = 0;

  for (let i = 0; i < path.length - 1; i += 1) {
    const parent = path[i];
    const child = path[i + 1];
    if (child.actionTaken === "FOLD") continue;

    const seat = seatLabel(parent.activePlayer);
    let text = `${seat} ${child.actionTaken}`;
    if (child.actionTaken === "RAISE") {
      raiseIndex += 1;
      const wasSqueeze = raiseIndex === 2 && callersSinceRaise >= 1;
      const rl = raiseLabelAtIndex(raiseIndex, wasSqueeze);
      text = `${seat} ${shortRaiseWord(rl)}`;
      callersSinceRaise = 0;
    } else if (child.actionTaken === "CALL") {
      if (raiseIndex > 0) callersSinceRaise += 1;
      text = `${seat} ${raiseIndex === 0 ? "Limp" : "Call"}`;
    }
    parts.push({ nodeId: parent.id, text, current: false });
  }

  // Текущий ход: подпись vs Open / squeeze / vs 3-bet …
  const ctx = deriveContext(path);
  const facing =
    ctx.raiseCount <= 0
      ? "ход"
      : ctx.raiseCount === 1
        ? ctx.callersAfterRaise >= 1
          ? "vs open+call · squeeze"
          : "vs open"
        : ctx.raiseCount === 2
          ? "vs 3-bet"
          : "vs 4-bet";
  parts.push({
    nodeId: activeNode.id,
    text: `${seatLabel(activeNode.activePlayer)} ${facing}`,
    current: true,
  });
  return parts;
}

/**
 * Клик по прошлой позиции → вернуться к построению ветки.
 * RAISE/CALL: active = узел сразу после их действия → у следующих снова F/C/R.
 * FOLD: active = узел решения этой позиции → выбирает новый ответ.
 */
export function resumeNodeAfterSeat(
  path: GameTreeNode[],
  seat: Seat,
  decisionNodeId: string | null,
): string | null {
  let idx = -1;
  if (decisionNodeId) {
    idx = path.findIndex((n) => n.id === decisionNodeId);
  }
  if (idx < 0) {
    idx = path.findIndex(
      (n, i) => i < path.length - 1 && n.activePlayer === seat,
    );
  }
  if (idx < 0) return decisionNodeId;
  if (idx >= path.length - 1) return path[idx]?.id ?? decisionNodeId;

  const decision = path[idx];
  const child = path[idx + 1];
  if (!child) return decision.id;

  // Фолл — не «ответ» на линию: позиция снова выбирает действие
  if (child.actionTaken === "FOLD") {
    return decision.id;
  }

  // Raise / Call остаются на линии; следующие позиции снова отвечают
  return child.id;
}
