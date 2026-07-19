import { comboWeight } from "../handMatrix";
import type { GameTreeNode, HandMix, PaintAction } from "./types";

export type BranchStat = {
  action: PaintAction;
  label: string;
  pct: number;
  combos: number;
};

function mixWeight(mix: HandMix, action: PaintAction): number {
  return mix[action] ?? 0;
}

/** Weighted % of total 1326 combos assigned to each action at this node. */
export function branchStats(node: GameTreeNode, raiseLabel = "RAISE"): BranchStat[] {
  let foldW = 0;
  let callW = 0;
  let raiseW = 0;
  let totalW = 0;

  for (const [hand, mix] of Object.entries(node.ranges)) {
    const w = comboWeight(hand);
    totalW += w;
    foldW += w * mixWeight(mix, "FOLD");
    callW += w * mixWeight(mix, "CALL");
    raiseW += w * mixWeight(mix, "RAISE");
  }

  const denom = totalW > 0 ? totalW : 1326;
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
