import { seatLabel } from "./seats";
import { deriveContext } from "./turnEngine";
import type { GameTreeNode, HandMix, Seat } from "./types";

/** Pot type inferred from the preflop line (for branch filters). */
export type BranchPotKind = "limp" | "srp" | "3bp" | "4bp" | "allin";

export type SavedBranch = {
  /** Tip node id (navigate here to open the line) */
  id: string;
  index: number;
  /** Matchup only: `HJvsBB`, `SBvsBTN` (pot kind is a separate hashtag) */
  label: string;
  tipNodeId: string;
  /** Best node to paint first (last decision with a painted range, else tip) */
  paintNodeId: string;
  depth: number;
  paintedCount: number;
  awaitingFlop: boolean;
  /** How many sibling alternatives exist under the parent of the tip */
  siblingCount: number;
  /** Limp / Raise / 3-bet / 4-bet / all-in */
  potKind: BranchPotKind;
};

export function inferPotKind(
  raiseCount: number,
  raiseSizings: number[],
  stackDepth = 100,
): BranchPotKind {
  if (raiseCount === 0) return "limp";
  const jam = raiseSizings.some((sz) => sz >= stackDepth - 0.5);
  if (jam || raiseCount >= 4) return "allin";
  if (raiseCount >= 3) return "4bp";
  if (raiseCount === 2) return "3bp";
  return "srp";
}

export function potKindTag(kind: BranchPotKind | string): string {
  if (kind === "limp") return "Limp";
  if (kind === "3bp") return "3-bet";
  if (kind === "4bp") return "4-bet";
  if (kind === "allin") return "All-in";
  return "Raise";
}

function isPainted(mix: HandMix): boolean {
  return mix.CALL > 0.02 || mix.RAISE > 0.02 || mix.FOLD < 0.98;
}

export function nodeHasPaintedRange(node: GameTreeNode): boolean {
  for (const mix of Object.values(node.ranges)) {
    if (isPainted(mix)) return true;
  }
  return false;
}

function countPaintedHands(node: GameTreeNode): number {
  let n = 0;
  for (const mix of Object.values(node.ranges)) {
    if (isPainted(mix)) n += 1;
  }
  return n;
}

/** Compact matchup: last raiser vs last caller → `HJvsBB`; limp → first limper vs BB. */
function matchupFromPath(path: GameTreeNode[]): string {
  let raiseIndex = 0;
  let lastRaiser: Seat | null = null;
  let lastCaller: Seat | null = null;
  let firstLimper: Seat | null = null;

  for (let i = 0; i < path.length - 1; i += 1) {
    const parent = path[i];
    const child = path[i + 1];
    const seat = parent.activePlayer;
    if (child.actionTaken === "RAISE") {
      raiseIndex += 1;
      lastRaiser = seat;
    } else if (child.actionTaken === "CALL") {
      if (raiseIndex === 0) {
        if (!firstLimper) firstLimper = seat;
        lastCaller = seat;
      } else {
        lastCaller = seat;
      }
    }
  }

  if (raiseIndex === 0 && firstLimper) {
    const vs =
      lastCaller && lastCaller !== firstLimper
        ? seatLabel(lastCaller)
        : "BB";
    return `${seatLabel(firstLimper)}vs${vs}`;
  }

  const a = lastRaiser ? seatLabel(lastRaiser) : null;
  const b = lastCaller ? seatLabel(lastCaller) : null;
  if (a && b && a !== b) return `${a}vs${b}`;
  if (a) return a;
  if (b) return b;
  return "линия";
}

/** Short saved-branch title: who vs whom (`HJvsBB`). Pot is a separate hashtag. */
export function shortSavedBranchLabel(path: GameTreeNode[]): string {
  return matchupFromPath(path);
}

/** Canonical line key — Auto-Fold ≡ Fold so the same line isn't listed twice. */
function edgeKey(parent: GameTreeNode, child: GameTreeNode): string {
  const seat = parent.activePlayer;
  const act = child.actionTaken;
  if (act === "RAISE") {
    const sz = child.sizingBB != null ? String(Math.round(child.sizingBB * 10) / 10) : "";
    return `${seat}:RAISE:${sz}`;
  }
  return `${seat}:${act}`;
}

/**
 * Collect saved lines that have closed preflop (reached postflop / flop prompt).
 * Incomplete preflop leaves are not listed — only awaitingFlop tips count.
 * Duplicate action-lines are merged (one entry per unique sequence).
 */
export function collectBranches(root: GameTreeNode): SavedBranch[] {
  const byKey = new Map<string, SavedBranch>();

  type Frame = {
    node: GameTreeNode;
    path: GameTreeNode[];
    raiseIndex: number;
    raiseSizings: number[];
    keys: string[];
  };

  const stack: Frame[] = [
    {
      node: root,
      path: [root],
      raiseIndex: 0,
      raiseSizings: [],
      keys: [],
    },
  ];

  while (stack.length) {
    const frame = stack.pop()!;
    const { node, path, raiseIndex, raiseSizings, keys } = frame;

    if (node.children.length === 0) {
      // Save only when preflop action is mathematically closed → flop
      if (!node.awaitingFlop || keys.length === 0) continue;
      let paintNodeId = path[path.length - 2]?.id ?? node.id;
      let paintedCount = 0;
      for (const n of path) {
        if (n.awaitingFlop) continue;
        const c = countPaintedHands(n);
        paintedCount += c;
        if (c > 0) paintNodeId = n.id;
      }
      const signature = keys.join("|");
      const potKind = inferPotKind(raiseIndex, raiseSizings);
      const candidate: SavedBranch = {
        id: node.id,
        index: 0,
        label: shortSavedBranchLabel(path),
        tipNodeId: node.id,
        paintNodeId,
        depth: keys.length,
        paintedCount,
        awaitingFlop: true,
        siblingCount: 1,
        potKind,
      };
      const prev = byKey.get(signature);
      // Keep the copy with more painted hands (or first seen)
      if (!prev || candidate.paintedCount > prev.paintedCount) {
        byKey.set(signature, candidate);
      }
      continue;
    }

    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      const child = node.children[i];
      let nextRaise = raiseIndex;
      let nextSizings = raiseSizings;
      if (child.actionTaken === "RAISE") {
        nextRaise = raiseIndex + 1;
        nextSizings = [...raiseSizings, child.sizingBB ?? 0];
      }
      stack.push({
        node: child,
        path: [...path, child],
        raiseIndex: nextRaise,
        raiseSizings: nextSizings,
        keys: [...keys, edgeKey(node, child)],
      });
    }
  }

  const out = [...byKey.values()];
  out.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth;
    return a.label.localeCompare(b.label);
  });

  return out.map((b, i) => ({ ...b, index: i + 1 }));
}

/** True when the node has a real open/play range (not an all-fold shell). */
export function nodeHasPlayRange(node: GameTreeNode): boolean {
  for (const mix of Object.values(node.ranges)) {
    if ((mix.RAISE ?? 0) > 0.02 || (mix.CALL ?? 0) > 0.02) return true;
  }
  return false;
}

/**
 * Painted RFI/open decision seats (`UTG`, `CO`…) even if the line is not
 * closed to flop yet. Needed so analysis can score opens strictly by branch.
 */
export function collectOpenBranches(root: GameTreeNode): SavedBranch[] {
  const bySeat = new Map<string, SavedBranch>();

  function visit(node: GameTreeNode, path: GameTreeNode[]) {
    if (node.street === "preflop" && !node.awaitingFlop && nodeHasPlayRange(node)) {
      const ctx = deriveContext(path);
      if (ctx.raiseCount === 0 && ctx.limpCount === 0) {
        const label = seatLabel(node.activePlayer);
        const paintedCount = countPaintedHands(node);
        const prev = bySeat.get(label);
        if (!prev || paintedCount > prev.paintedCount) {
          bySeat.set(label, {
            id: `open:${node.id}`,
            index: 0,
            label,
            tipNodeId: node.id,
            paintNodeId: node.id,
            depth: Math.max(1, path.length - 1),
            paintedCount,
            awaitingFlop: false,
            siblingCount: 1,
            potKind: "srp",
          });
        }
      }
    }
    for (const child of node.children) {
      visit(child, [...path, child]);
    }
  }

  visit(root, [root]);
  return [...bySeat.values()].sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

function mergeBranchesByMatchup(branches: SavedBranch[]): SavedBranch[] {
  const byKey = new Map<string, SavedBranch>();
  for (const b of branches) {
    const key = `${b.potKind}|${b.label}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, b);
      continue;
    }
    // Prefer closed-to-flop tips when labels collide; keep richer paint.
    if (b.awaitingFlop && !prev.awaitingFlop) {
      byKey.set(key, {
        ...b,
        paintedCount: Math.max(b.paintedCount, prev.paintedCount),
      });
    } else if (
      !b.awaitingFlop &&
      prev.awaitingFlop &&
      b.paintedCount > prev.paintedCount
    ) {
      byKey.set(key, {
        ...prev,
        paintedCount: b.paintedCount,
        paintNodeId: b.paintNodeId,
      });
    } else if (b.paintedCount > prev.paintedCount) {
      byKey.set(key, b);
    }
  }
  const out = [...byKey.values()];
  out.sort((a, b) => {
    if (a.potKind !== b.potKind) return a.potKind.localeCompare(b.potKind);
    return a.label.localeCompare(b.label, "ru");
  });
  return out.map((b, i) => ({ ...b, index: i + 1 }));
}

/**
 * Editor list: all closed lines (incl. empty) + painted open seats (`UTG`…).
 */
export function collectEditorBranches(root: GameTreeNode): SavedBranch[] {
  return mergeBranchesByMatchup([
    ...collectOpenBranches(root),
    ...collectBranches(root),
  ]);
}

/**
 * Analysis gate: painted opens + painted closed lines only.
 */
export function collectAnalysisBranches(root: GameTreeNode): SavedBranch[] {
  return mergeBranchesByMatchup([
    ...collectOpenBranches(root),
    ...collectBranches(root).filter((b) => b.paintedCount > 0),
  ]);
}

/** Find which saved branch (if any) contains the active tip. */
export function activeBranchId(
  branches: SavedBranch[],
  activeId: string,
  root: GameTreeNode,
): string | null {
  const direct = branches.find((b) => b.tipNodeId === activeId);
  if (direct) return direct.id;

  // Active is mid-path: pick the branch whose tip is a descendant of active,
  // or whose path goes through active (prefer deepest matching tip).
  function isDescendant(node: GameTreeNode, targetId: string): boolean {
    if (node.id === targetId) return true;
    return node.children.some((c) => isDescendant(c, targetId));
  }

  const activeNode = (function find(n: GameTreeNode): GameTreeNode | null {
    if (n.id === activeId) return n;
    for (const c of n.children) {
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  })(root);

  if (!activeNode) return null;

  for (const b of branches) {
    if (isDescendant(activeNode, b.tipNodeId)) return b.id;
  }
  return null;
}
