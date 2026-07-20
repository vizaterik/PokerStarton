/**
 * Build played preflop lines from HH and match them to the constructor tree.
 */
import type { HandRow } from "../../engine/localDb";
import { normalizeChartPos } from "../spotCoverage";
import { findNode, pathToNode } from "./engine";
import { seatsFor } from "./seats";
import type { GameTreeDocument, GameTreeNode, Seat, TableSize, TreeAction } from "./types";

export type LineActionKind = "FOLD" | "CALL" | "RAISE";

export type PlayedLineAction = {
  seat: Seat;
  seatLabel: string;
  action: LineActionKind;
  sizingBB: number | null;
  isHero: boolean;
  playerName: string;
};

export type PlayedLine = {
  actions: PlayedLineAction[];
  heroSeat: Seat | null;
  heroAction: LineActionKind | null;
  heroHandCode: string | null;
  tableSize: TableSize;
};

export type MatchedPathStep = {
  nodeId: string;
  seat: Seat;
  action: TreeAction;
  sizingBB?: number;
  label: string;
};

export type LineMatchFound = {
  status: "found";
  path: GameTreeNode[];
  steps: MatchedPathStep[];
  /** Decision node where hero acted (parent of hero edge). */
  heroDecisionNode: GameTreeNode;
  heroAction: LineActionKind;
  /** Node after hero's action (child edge). */
  heroEdgeNode: GameTreeNode;
};

export type LineMatchMissing = {
  status: "missing";
  path: GameTreeNode[];
  steps: MatchedPathStep[];
  /** Deepest matched node (create child from here). */
  parentNode: GameTreeNode;
  /** Next HH action that has no tree edge. */
  missingAction: PlayedLineAction;
  matchedCount: number;
};

export type LineMatchResult = LineMatchFound | LineMatchMissing | { status: "empty" };

const SIZE_EPS = 0.35;

function guessTableSize(hand: HandRow): TableSize {
  const n = hand.table_max ?? hand.seats?.length ?? 6;
  if (n <= 2) return 2;
  if (n === 3) return 3;
  if (n <= 6) return 6;
  if (n === 8) return 8;
  return 9;
}

/** Map HH position label → tree Seat for table size. */
export function hhPosToSeat(pos: string, tableSize: TableSize): Seat | null {
  const p = normalizeChartPos(pos).replace(/\s+/g, "");
  const order = seatsFor(tableSize);
  if (p === "BTN" || p === "SB" || p === "BB" || p === "CO" || p === "UTG") {
    return order.includes(p as Seat) ? (p as Seat) : null;
  }
  if (p === "HJ" || p === "MP") {
    if (tableSize === 6) return order.includes("HJ") ? "HJ" : "MP";
    return order.includes("MP") ? "MP" : order.includes("HJ") ? "HJ" : null;
  }
  if (p === "UTG+1" || p === "UTG1") {
    return order.includes("UTG1") ? "UTG1" : "UTG";
  }
  if (p === "UTG+2" || p === "UTG2" || p === "MP1" || p === "MP+1") {
    if (order.includes("MP1")) return "MP1";
    if (order.includes("MP")) return "MP";
    return order.includes("HJ") ? "HJ" : null;
  }
  return order.includes(p as Seat) ? (p as Seat) : null;
}

function seatsEqual(a: Seat, b: Seat, tableSize: TableSize): boolean {
  if (a === b) return true;
  const na = hhPosToSeat(a, tableSize);
  const nb = hhPosToSeat(b, tableSize);
  return Boolean(na && nb && na === nb);
}

function assignSeatLabels(hand: HandRow): Map<string, string> {
  const nameToPos = new Map<string, string>();
  const seats = hand.seats ?? [];
  if (!seats.length) {
    if (hand.hero_name && hand.hero_position) {
      nameToPos.set(hand.hero_name, hand.hero_position);
    }
    return nameToPos;
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
    const six = ["BTN", "SB", "BB", "UTG", "HJ", "CO"];
    labels = six.slice(0, n);
  } else {
    const extra = ["UTG+1", "UTG+2", "MP", "HJ", "CO"];
    labels = ["BTN", "SB", "BB", "UTG", ...extra.slice(0, n - 4)];
  }
  const seatToLabel = new Map<number, string>();
  rotated.forEach((seat, i) => seatToLabel.set(seat, labels[i]));
  for (const s of seats) {
    const lab = seatToLabel.get(s.seat);
    if (lab) nameToPos.set(s.name, lab);
  }
  return nameToPos;
}

function toLineAction(action: string): LineActionKind | null {
  const a = action.trim().toLowerCase();
  if (a === "fold") return "FOLD";
  if (a === "call" || a === "check") return a === "check" ? null : "CALL";
  if (a === "raise" || a === "bet") return "RAISE";
  return null;
}

/** Reconstruct preflop line through hero's voluntary decision. */
export function buildPlayedLine(hand: HandRow): PlayedLine {
  const tableSize = guessTableSize(hand);
  const nameToPos = assignSeatLabels(hand);
  const bb = hand.big_blind && hand.big_blind > 0 ? hand.big_blind : null;
  const actions: PlayedLineAction[] = [];

  const rawActs = hand.preflop_actions?.length ? hand.preflop_actions : hand.actions ?? [];
  for (const a of rawActs) {
    if ((a.street || "").toLowerCase() !== "preflop") break;
    const kind = toLineAction(a.action);
    if (!kind) continue;
    const seatLabel =
      nameToPos.get(a.player_name) ||
      (a.is_hero ? hand.hero_position : null) ||
      "";
    if (!seatLabel) continue;
    const seat = hhPosToSeat(seatLabel, tableSize);
    if (!seat) continue;
    let sizingBB: number | null = null;
    if (kind === "RAISE" && a.amount != null && bb) {
      sizingBB = Math.round((a.amount / bb) * 10) / 10;
    }
    actions.push({
      seat,
      seatLabel,
      action: kind,
      sizingBB,
      isHero: Boolean(a.is_hero),
      playerName: a.player_name,
    });
  }

  // Score / match through hero's last voluntary preflop decision.
  const heroAct = [...actions].reverse().find((x) => x.isHero) ?? null;
  if (heroAct) {
    const cut = actions.lastIndexOf(heroAct);
    if (cut >= 0) actions.splice(cut + 1);
  }
  return {
    actions,
    heroSeat: heroAct?.seat ?? (hand.hero_position ? hhPosToSeat(hand.hero_position, tableSize) : null),
    heroAction: heroAct?.action ?? null,
    heroHandCode: hand.hero_hand_code,
    tableSize,
  };
}

function findMatchingChild(
  parent: GameTreeNode,
  seat: Seat,
  action: LineActionKind,
  sizingBB: number | null,
  tableSize: TableSize,
): GameTreeNode | null {
  if (!seatsEqual(parent.activePlayer, seat, tableSize)) return null;
  const candidates = parent.children.filter((c) => c.actionTaken === action);
  if (!candidates.length) return null;
  if (action !== "RAISE" || sizingBB == null) return candidates[0];
  let best: GameTreeNode | null = null;
  let bestDiff = Infinity;
  for (const c of candidates) {
    const sz = c.sizingBB ?? 0;
    const diff = Math.abs(sz - sizingBB);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  if (best && bestDiff <= Math.max(SIZE_EPS, (sizingBB || 1) * 0.15)) return best;
  return candidates[0];
}

function stepLabel(seat: Seat, action: TreeAction, sizingBB?: number): string {
  if (action === "FOLD") return `${seat} Fold`;
  if (action === "CALL") return `${seat} Call`;
  if (action === "RAISE") {
    return sizingBB != null ? `${seat} Raise ${sizingBB}` : `${seat} Raise`;
  }
  return `${seat} ${action}`;
}

/**
 * Walk the constructor tree along the played HH line.
 * Folds that exist in the tree as auto-folds are followed when seats match.
 */
export function matchLineToTree(doc: GameTreeDocument, line: PlayedLine): LineMatchResult {
  if (!line.actions.length) return { status: "empty" };

  const tableSize = doc.tableSize || line.tableSize;
  let node = doc.root;
  const steps: MatchedPathStep[] = [];
  let heroDecisionNode: GameTreeNode | null = null;
  let heroEdgeNode: GameTreeNode | null = null;
  let heroAction: LineActionKind | null = null;

  for (let i = 0; i < line.actions.length; i += 1) {
    const act = line.actions[i];
    // Skip ahead via fold edges when tree actor is behind HH actor
    let guard = 0;
    while (
      !seatsEqual(node.activePlayer, act.seat, tableSize) &&
      !node.awaitingFlop &&
      guard < 12
    ) {
      guard += 1;
      const foldChild =
        node.children.find((c) => c.actionTaken === "FOLD") ?? null;
      if (!foldChild) break;
      steps.push({
        nodeId: node.id,
        seat: node.activePlayer,
        action: "FOLD",
        label: stepLabel(node.activePlayer, "FOLD"),
      });
      node = foldChild;
      if (foldChild.awaitingFlop) break;
    }

    if (node.awaitingFlop) {
      return {
        status: "missing",
        path: pathToNode(doc.root, node.id) ?? [doc.root],
        steps,
        parentNode: node,
        missingAction: act,
        matchedCount: i,
      };
    }

    const child = findMatchingChild(node, act.seat, act.action, act.sizingBB, tableSize);
    if (!child) {
      return {
        status: "missing",
        path: pathToNode(doc.root, node.id) ?? [doc.root],
        steps,
        parentNode: node,
        missingAction: act,
        matchedCount: i,
      };
    }

    if (act.isHero && !heroDecisionNode) {
      heroDecisionNode = node;
      heroEdgeNode = child;
      heroAction = act.action;
    }

    steps.push({
      nodeId: node.id,
      seat: node.activePlayer,
      action: act.action,
      sizingBB: act.sizingBB ?? child.sizingBB,
      label: stepLabel(node.activePlayer, act.action, act.sizingBB ?? child.sizingBB),
    });
    node = child;
  }

  if (!heroDecisionNode || !heroEdgeNode || !heroAction) {
    return {
      status: "missing",
      path: pathToNode(doc.root, node.id) ?? [doc.root],
      steps,
      parentNode: node,
      missingAction: line.actions[line.actions.length - 1],
      matchedCount: line.actions.length,
    };
  }

  const path = pathToNode(doc.root, heroEdgeNode.id) ?? [doc.root];
  return {
    status: "found",
    path,
    steps,
    heroDecisionNode,
    heroAction,
    heroEdgeNode,
  };
}

/** Ensure a node still exists after doc edits. */
export function resolveNode(doc: GameTreeDocument, id: string): GameTreeNode | null {
  return findNode(doc.root, id);
}
