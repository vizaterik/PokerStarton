import { raiseLabelAtIndex, shortRaiseWord, type RaiseLabel } from "./raiseLabels";
import { seatLabel } from "./seats";
import { actorsAlongPath } from "./turnEngine";
import type { GameTreeNode, Seat } from "./types";

/** One decision seat on the line — full Fold/Call/Raise mix lives on this node. */
export type BranchRangeSpot = {
  seat: Seat;
  /** Action taken on this line (tree edge) — does not limit which mix you paint. */
  lineAction: "FOLD" | "CALL" | "RAISE";
  nodeId: string;
  /** Seat + line action, e.g. `CO · 3-bet` / `BB · Call`. */
  label: string;
  raiseLabel?: RaiseLabel;
  sizingBB?: number;
};

/** Human label for dual-range headers and spot chips. */
export function formatSpotLabel(
  seat: Seat,
  lineAction: "FOLD" | "CALL" | "RAISE",
  opts?: { raiseLabel?: RaiseLabel; sizingBB?: number; stackDepth?: number },
): string {
  const pos = seatLabel(seat);
  if (lineAction === "CALL") return `${pos} · Call`;
  if (lineAction === "FOLD") return `${pos} · Fold`;
  const rl = opts?.raiseLabel ?? "RAISE";
  const word = shortRaiseWord(rl);
  if (rl === "ALL-IN") {
    const stack = opts?.sizingBB ?? opts?.stackDepth;
    return stack != null ? `${pos} · All-in ${stack}bb` : `${pos} · All-in`;
  }
  if (opts?.sizingBB != null && opts.sizingBB > 0) {
    return `${pos} · ${word} ${opts.sizingBB}bb`;
  }
  return `${pos} · ${word}`;
}

/**
 * Decision seats along a path (one row per seat).
 * Auto-folds are skipped. Matrix always edits the full F/C/R mix on that node.
 */
export function branchRangeSpots(
  path: GameTreeNode[],
  stackDepth = 100,
): BranchRangeSpot[] {
  const actors = actorsAlongPath(path);
  const spots: BranchRangeSpot[] = [];
  let raiseIndex = 0;
  let callersSinceRaise = 0;

  for (let i = 0; i < actors.length; i += 1) {
    const step = actors[i];
    const parent = path[i];
    const child = path[i + 1];
    if (step.action === "ROOT" || step.action === "CHECK") continue;

    if (step.action === "FOLD") {
      if (child?.autoFold) continue;
      spots.push({
        seat: step.player,
        lineAction: "FOLD",
        nodeId: parent.id,
        label: formatSpotLabel(step.player, "FOLD"),
      });
      continue;
    }

    if (step.action === "RAISE") {
      raiseIndex += 1;
      const wasSqueeze = raiseIndex === 2 && callersSinceRaise >= 1;
      const rl = raiseLabelAtIndex(raiseIndex, wasSqueeze);
      const sz = step.sizingBB ?? (rl === "ALL-IN" ? stackDepth : undefined);
      spots.push({
        seat: step.player,
        lineAction: "RAISE",
        nodeId: parent.id,
        label: formatSpotLabel(step.player, "RAISE", {
          raiseLabel: rl,
          sizingBB: sz,
          stackDepth,
        }),
        raiseLabel: rl,
        sizingBB: sz,
      });
      callersSinceRaise = 0;
      continue;
    }

    if (step.action === "CALL") {
      if (raiseIndex > 0) callersSinceRaise += 1;
      spots.push({
        seat: step.player,
        lineAction: "CALL",
        nodeId: parent.id,
        label: formatSpotLabel(step.player, "CALL"),
      });
    }
  }

  return spots;
}
