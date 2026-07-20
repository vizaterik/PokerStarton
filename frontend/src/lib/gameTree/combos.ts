import { comboWeight, type HandCode } from "../handMatrix";
import type { GameTreeNode, HandMix, PaintAction } from "./types";

export type BranchStat = {
  action: PaintAction;
  label: string;
  pct: number;
  combos: number;
};

const REACH_EPS = 0.02;

function mixWeight(mix: HandMix, action: PaintAction): number {
  return mix[action] ?? 0;
}

/** Weighted % of total 1326 combos assigned to each action at this node. */
export function branchStats(node: GameTreeNode, raiseLabel = "RAISE"): BranchStat[] {
  let foldW = 0;
  let callW = 0;
  let raiseW = 0;
  let listedW = 0;

  for (const [hand, mix] of Object.entries(node.ranges)) {
    const w = comboWeight(hand);
    listedW += w;
    foldW += w * mixWeight(mix, "FOLD");
    callW += w * mixWeight(mix, "CALL");
    raiseW += w * mixWeight(mix, "RAISE");
  }
  // Sparse ranges: missing hands are pure fold.
  foldW += Math.max(0, 1326 - listedW);

  const denom = 1326;
  const pct = (x: number) => Math.round((1000 * x) / denom) / 10;
  const combos = (x: number) => Math.round(x * 10) / 10;

  return [
    { action: "FOLD", label: "FOLD", pct: pct(foldW), combos: combos(foldW) },
    { action: "CALL", label: "CALL", pct: pct(callW), combos: combos(callW) },
    {
      action: "RAISE",
      label: raiseLabel,
      pct: pct(raiseW),
      combos: combos(raiseW),
    },
  ];
}

/** Hands with mass on `viaAction` at parent (reach into child). */
export function reachableCombos(
  parent: GameTreeNode,
  viaAction: PaintAction,
): Set<HandCode> {
  const out = new Set<HandCode>();
  for (const [hand, mix] of Object.entries(parent.ranges)) {
    if (mixWeight(mix, viaAction) > REACH_EPS) out.add(hand as HandCode);
  }
  return out;
}

export function isHandReachable(
  parent: GameTreeNode,
  viaAction: PaintAction,
  hand: HandCode,
): boolean {
  const mix = parent.ranges[hand];
  if (!mix) return false;
  return mixWeight(mix, viaAction) > REACH_EPS;
}

/** True when every painted (non-pure-fold) hand on child is in parent reach. */
export function isSubset(
  child: GameTreeNode,
  parentReach: Set<HandCode>,
): boolean {
  for (const [hand, mix] of Object.entries(child.ranges)) {
    const play = (mix.CALL ?? 0) + (mix.RAISE ?? 0);
    if (play <= REACH_EPS) continue;
    if (!parentReach.has(hand as HandCode)) return false;
  }
  return true;
}

export type PartitionError = {
  lost: HandCode[];
  overlapping: HandCode[];
  parentReachCount: number;
  childCoveredCount: number;
};

/**
 * Among siblings of a fork: parent reach via each child's inbound action should
 * partition without loss/duplication of playable mass.
 * Compares children decision nodes that share the same parent.
 */
export function partitionError(
  parent: GameTreeNode,
  children: GameTreeNode[],
): PartitionError {
  const byAction = new Map<PaintAction, GameTreeNode[]>();
  for (const ch of children) {
    const act = ch.actionTaken;
    if (act !== "FOLD" && act !== "CALL" && act !== "RAISE") continue;
    const list = byAction.get(act) ?? [];
    list.push(ch);
    byAction.set(act, list);
  }

  const parentReach = new Set<HandCode>();
  for (const act of ["FOLD", "CALL", "RAISE"] as PaintAction[]) {
    for (const h of reachableCombos(parent, act)) parentReach.add(h);
  }

  // Hands that appear as playable in more than one sibling decision node
  const playCount = new Map<HandCode, number>();
  const covered = new Set<HandCode>();
  for (const ch of children) {
    if (ch.awaitingFlop) continue;
    for (const [hand, mix] of Object.entries(ch.ranges)) {
      const play = (mix.CALL ?? 0) + (mix.RAISE ?? 0);
      if (play <= REACH_EPS) continue;
      const code = hand as HandCode;
      covered.add(code);
      playCount.set(code, (playCount.get(code) ?? 0) + 1);
    }
  }

  // Lost = in parent's playable RAISE∪CALL mass but not covered by any child's playable
  const parentPlay = new Set<HandCode>([
    ...reachableCombos(parent, "CALL"),
    ...reachableCombos(parent, "RAISE"),
  ]);
  const lost: HandCode[] = [];
  for (const h of parentPlay) {
    if (!covered.has(h)) lost.push(h);
  }
  const overlapping: HandCode[] = [];
  for (const [h, n] of playCount) {
    if (n > 1) overlapping.push(h);
  }

  return {
    lost,
    overlapping,
    parentReachCount: parentPlay.size,
    childCoveredCount: covered.size,
  };
}

export { REACH_EPS };
