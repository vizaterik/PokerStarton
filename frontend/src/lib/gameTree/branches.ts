import { seatLabel } from "./seats";
import { deriveContext } from "./turnEngine";
import type { GameTreeNode, HandMix, Seat } from "./types";

/** Pot type inferred from the preflop line (for branch filters). */
export type BranchPotKind = "limp" | "srp" | "3bp" | "4bp" | "multi";

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
  /** Limp / Raise / 3-bet / 4-bet (no separate all-in pot) */
  potKind: BranchPotKind;
};

/** Legacy trees stored jam lines as `allin` — fold into 4-bet. */
export function normalizeBranchPotKind(kind: string | null | undefined): BranchPotKind {
  const k = String(kind || "").toLowerCase();
  if (k === "limp") return "limp";
  if (k === "multi" || k === "multiway" || k === "multipot") return "multi";
  if (k === "3bp") return "3bp";
  if (k === "4bp" || k === "allin" || k === "all_in") return "4bp";
  return "srp";
}

export function inferPotKind(
  raiseCount: number,
  _raiseSizings: number[] = [],
  _stackDepth = 100,
  coldCallers = 0,
): BranchPotKind {
  if (raiseCount === 0) return "limp";
  // Jam sizings stay in the tree as raises; pot tag stops at 4-bet.
  if (raiseCount >= 3) return "4bp";
  if (raiseCount === 2) return "3bp";
  // Open + 2+ callers → multiway pot (3+ to flop).
  if (raiseCount === 1 && coldCallers >= 2) return "multi";
  return "srp";
}

export function potKindTag(kind: BranchPotKind | string): string {
  const k = normalizeBranchPotKind(kind);
  if (k === "limp") return "Limp";
  if (k === "multi") return "Multi";
  if (k === "3bp") return "3-bet";
  if (k === "4bp") return "4-bet";
  return "Raise";
}

/** Real play paint only (raise/call) — pure Fold shells do not count. */
function isPainted(mix: HandMix): boolean {
  return (mix.CALL ?? 0) > 0.02 || (mix.RAISE ?? 0) > 0.02;
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
      // Paint = last RAISE/CALL decision (open / call / 3bet), not trailing folds.
      // Open → fold-to-flop used to point paint at the last folder.
      let paintNodeId = (path[path.length - 2] ?? node).id;
      for (let i = path.length - 1; i >= 1; i -= 1) {
        const act = path[i].actionTaken;
        if (act === "RAISE" || act === "CALL") {
          paintNodeId = path[i - 1].id;
          break;
        }
      }
      const paintNode = path.find((n) => n.id === paintNodeId) ?? path[path.length - 2] ?? node;
      const paintedCount =
        paintNode.awaitingFlop || paintNode.street !== "preflop"
          ? 0
          : countPaintedHands(paintNode);
      const signature = keys.join("|");
      let coldCallers = 0;
      let raisesSeen = 0;
      for (let i = 1; i < path.length; i += 1) {
        if (path[i].actionTaken === "RAISE") raisesSeen += 1;
        else if (path[i].actionTaken === "CALL" && raisesSeen >= 1) coldCallers += 1;
      }
      const potKind = inferPotKind(raiseIndex, raiseSizings, 100, coldCallers);
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

function raiseSizingsAlongPath(path: GameTreeNode[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < path.length; i += 1) {
    if (path[i].actionTaken === "RAISE") {
      out.push(path[i].sizingBB ?? 0);
    }
  }
  return out;
}

/**
 * Painted facing decisions (vs open / 3bet / 4bet…) even if the line is not
 * closed to flop. Without this, 3bp+ errors disappear whenever the tip decision
 * shell is empty but the real chart lives on an earlier facing node.
 */
export function collectFacingBranches(root: GameTreeNode): SavedBranch[] {
  const byKey = new Map<string, SavedBranch>();

  function visit(node: GameTreeNode, path: GameTreeNode[]) {
    if (node.street === "preflop" && !node.awaitingFlop && nodeHasPlayRange(node)) {
      const ctx = deriveContext(path);
      if (ctx.raiseCount >= 1 && ctx.lastAggressor) {
        let coldCallers = 0;
        let raisesSeen = 0;
        for (let i = 1; i < path.length; i += 1) {
          if (path[i].actionTaken === "RAISE") raisesSeen += 1;
          else if (path[i].actionTaken === "CALL" && raisesSeen >= 1) coldCallers += 1;
        }
        const potKind = inferPotKind(
          ctx.raiseCount,
          raiseSizingsAlongPath(path),
          100,
          coldCallers,
        );
        const label = `${seatLabel(ctx.lastAggressor)}vs${seatLabel(node.activePlayer)}`;
        const paintedCount = countPaintedHands(node);
        const key = `${potKind}|${label}`;
        const prev = byKey.get(key);
        if (!prev || paintedCount > prev.paintedCount) {
          byKey.set(key, {
            id: `facing:${node.id}`,
            index: 0,
            label,
            tipNodeId: node.id,
            paintNodeId: node.id,
            depth: Math.max(1, path.length - 1),
            paintedCount,
            awaitingFlop: false,
            siblingCount: 1,
            potKind,
          });
        }
      } else if (ctx.raiseCount === 0 && ctx.limpCount > 0) {
        // ISO / limp facing decision
        const potKind: BranchPotKind = "limp";
        let limper: Seat | null = null;
        for (let i = 1; i < path.length; i += 1) {
          if (path[i].actionTaken === "CALL") {
            limper = path[i - 1].activePlayer;
            break;
          }
        }
        const label = limper
          ? `${seatLabel(limper)}vs${seatLabel(node.activePlayer)}`
          : seatLabel(node.activePlayer);
        const paintedCount = countPaintedHands(node);
        const key = `${potKind}|${label}`;
        const prev = byKey.get(key);
        if (!prev || paintedCount > prev.paintedCount) {
          byKey.set(key, {
            id: `limp:${node.id}`,
            index: 0,
            label,
            tipNodeId: node.id,
            paintNodeId: node.id,
            depth: Math.max(1, path.length - 1),
            paintedCount,
            awaitingFlop: false,
            siblingCount: 1,
            potKind,
          });
        }
      }
    }
    for (const child of node.children) {
      visit(child, [...path, child]);
    }
  }

  visit(root, [root]);
  return [...byKey.values()];
}

/** Matchup key for merge: `HJvsBB` ≡ `MPvsBB` (same as analysis normalize). */
function matchupMergeKey(label: string): string {
  const raw = label.trim().toUpperCase().replace(/\s+/g, "");
  const alias = (p: string) =>
    p === "HJ" || p === "MP1" || p === "MP+1" ? "MP" : p;
  const m = raw.match(/^([A-Z0-9+]+)VS([A-Z0-9+]+)$/);
  if (!m) return alias(raw);
  return `${alias(m[1])}vs${alias(m[2])}`;
}

function mergeBranchesByMatchup(branches: SavedBranch[]): SavedBranch[] {
  const byKey = new Map<string, SavedBranch>();
  for (const raw of branches) {
    const b = {
      ...raw,
      potKind: normalizeBranchPotKind(raw.potKind),
    };
    const key = `${b.potKind}|${matchupMergeKey(b.label)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, b);
      continue;
    }
    const richerPaint =
      b.paintedCount > prev.paintedCount
        ? { paintNodeId: b.paintNodeId, paintedCount: b.paintedCount }
        : {
            paintNodeId: prev.paintNodeId,
            paintedCount: Math.max(b.paintedCount, prev.paintedCount),
          };
    // Prefer closed-to-flop tip for navigation, but never drop the real paint node.
    if (b.awaitingFlop && !prev.awaitingFlop) {
      byKey.set(key, { ...b, ...richerPaint });
    } else if (!b.awaitingFlop && prev.awaitingFlop) {
      byKey.set(key, { ...prev, ...richerPaint });
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
    ...collectFacingBranches(root),
    ...collectBranches(root),
  ]);
}

/**
 * Analysis: painted opens + painted facing (3bp/4bp…) + closed lines with a
 * real play chart on paintNodeId (may come from a facing node after merge).
 */
export function collectAnalysisBranches(root: GameTreeNode): SavedBranch[] {
  const merged = mergeBranchesByMatchup([
    ...collectOpenBranches(root),
    ...collectFacingBranches(root),
    ...collectBranches(root).filter((b) => b.paintedCount > 0),
  ]);
  return merged.filter((b) => {
    if (b.paintedCount <= 0) return false;
    const node = findBranchNode(root, b.paintNodeId);
    return Boolean(node && nodeHasPlayRange(node));
  });
}

function findBranchNode(root: GameTreeNode, id: string): GameTreeNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = findBranchNode(child, id);
    if (hit) return hit;
  }
  return null;
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
