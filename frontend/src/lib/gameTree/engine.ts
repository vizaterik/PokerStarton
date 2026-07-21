import { produce } from "immer";
import { HandCode, RANKS } from "../handMatrix";
import { isHandReachable, REACH_EPS } from "./combos";
import { isPureFold } from "./rangesSparse";
import { nextSeat, seatLabel, seatsFor } from "./seats";
import { standardRaiseSize } from "./standardSizings";
import {
  actionBadgeLabel,
  actorsAlongPath,
  deriveContext,
  resolveNextTurn,
} from "./turnEngine";
import type {
  GameTreeDocument,
  GameTreeNode,
  HandMix,
  PaintAction,
  PathStep,
  Seat,
  StackDepth,
  TableSize,
  TreeAction,
} from "./types";

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Sparse empty ranges — pure fold is implied for missing hands.
 * Keeps trees small; UI/matrix treat missing as fold.
 */
export function emptyRanges(): Record<HandCode, HandMix> {
  return {};
}

/**
 * Ranges for the next decision seat: Fold shell for all hands.
 * If that seat already acted on the path, paint is clamped to hands they
 * put on that prior action (`handPaintableOnNode`).
 */
export function rangesInheritedForNextSeat(
  _root: GameTreeNode,
  _parentId: string,
  _nextSeatPlayer: Seat,
): Record<HandCode, HandMix> {
  return emptyRanges();
}

/** Parent of nodeId, or null for root. */
export function findParent(
  root: GameTreeNode,
  nodeId: string,
): GameTreeNode | null {
  if (root.id === nodeId) return null;
  for (const child of root.children) {
    if (child.id === nodeId) return root;
    const hit = findParent(child, nodeId);
    if (hit) return hit;
  }
  return null;
}

/**
 * Prior decision of `seat` on the path to `nodeId`, and the action they took.
 * Used to inherit reachable combos when the same seat acts again.
 */
export function priorSeatDecision(
  root: GameTreeNode,
  nodeId: string,
  seat: Seat,
): { decision: GameTreeNode; via: PaintAction } | null {
  const path = pathToNode(root, nodeId);
  if (!path?.length) return null;
  // Exclude current node — look for an earlier decision by this seat
  for (let i = path.length - 2; i >= 0; i -= 1) {
    const n = path[i];
    if (n.activePlayer !== seat) continue;
    const via = path[i + 1]?.actionTaken;
    if (via !== "FOLD" && via !== "CALL" && via !== "RAISE") continue;
    return { decision: n, via };
  }
  return null;
}

/** Whether `hand` may be painted on `node` (subset of this seat's prior action). */
export function handPaintableOnNode(
  root: GameTreeNode,
  node: GameTreeNode,
  hand: HandCode,
): boolean {
  const prior = priorSeatDecision(root, node.id, node.activePlayer);
  if (!prior) return true;
  // Soft: if prior decision has no painted play mass, allow (legacy trees).
  let parentHasPaint = false;
  for (const mix of Object.values(prior.decision.ranges)) {
    if ((mix.CALL ?? 0) > REACH_EPS || (mix.RAISE ?? 0) > REACH_EPS) {
      parentHasPaint = true;
      break;
    }
  }
  if (!parentHasPaint) return true;
  return isHandReachable(prior.decision, prior.via, hand);
}

export function createRootNode(tableSize: TableSize): GameTreeNode {
  const first = seatsFor(tableSize)[0];
  return {
    id: uid("preflop_root"),
    street: "preflop",
    activePlayer: first,
    actionTaken: "ROOT",
    ranges: emptyRanges(),
    children: [],
  };
}

export function createDocument(
  strategyId: string,
  tableSize: TableSize = 6,
  stackDepth: StackDepth = 100,
): GameTreeDocument {
  return {
    version: 1,
    strategyId,
    tableSize,
    stackDepth,
    root: createRootNode(tableSize),
    updatedAt: new Date().toISOString(),
  };
}

export function findNode(root: GameTreeNode, id: string): GameTreeNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

export function pathToNode(root: GameTreeNode, nodeId: string): GameTreeNode[] | null {
  if (root.id === nodeId) return [root];
  for (const child of root.children) {
    const sub = pathToNode(child, nodeId);
    if (sub) return [root, ...sub];
  }
  return null;
}

/**
 * Flop tip of a finished line that contains `activeId`.
 * Used so range clicks only switch the paint target and never rewind
 * construction through seats on an already-formed branch.
 */
export function closedBranchTip(
  root: GameTreeNode,
  activeId: string,
): GameTreeNode | null {
  const path = pathToNode(root, activeId);
  if (!path?.length) return null;
  const last = path[path.length - 1];
  if (last.awaitingFlop) return last;

  // After «К построению» active sits on the last decision; tip is its child.
  const direct = last.children.find((c) => c.awaitingFlop);
  if (direct) return direct;

  // Mid-line after history/seat resume: walk toward an awaitingFlop tip.
  let node: GameTreeNode = last;
  for (let g = 0; g < 16; g += 1) {
    const tip = node.children.find((c) => c.awaitingFlop);
    if (tip) return tip;
    if (node.children.length === 1) {
      node = node.children[0];
      continue;
    }
    const towardFlop = node.children.find(
      (c) =>
        c.awaitingFlop ||
        c.children.some((x) => x.awaitingFlop || x.children.some((y) => y.awaitingFlop)),
    );
    if (!towardFlop) break;
    if (towardFlop.awaitingFlop) return towardFlop;
    node = towardFlop;
  }
  return null;
}

/**
 * Ribbon badges: completed actions + current turn.
 * Sizing text is always derived from the live path (parent edits update labels).
 */
export function breadcrumbSteps(root: GameTreeNode, nodeId: string): PathStep[] {
  const path = pathToNode(root, nodeId);
  if (!path) return [];

  const steps: PathStep[] = [];
  let raiseIndex = 0;
  let callersSinceRaise = 0;

  for (let i = 0; i < path.length - 1; i += 1) {
    const parent = path[i];
    const child = path[i + 1];
    if (child.actionTaken === "FOLD") continue;
    let wasSqueeze = false;
    if (child.actionTaken === "RAISE") {
      raiseIndex += 1;
      wasSqueeze = raiseIndex === 2 && callersSinceRaise >= 1;
      callersSinceRaise = 0;
    } else if (child.actionTaken === "CALL" && raiseIndex > 0) {
      callersSinceRaise += 1;
    }
    steps.push({
      nodeId: parent.id,
      kind: "action",
      label: actionBadgeLabel(
        parent.activePlayer,
        child.actionTaken,
        child.sizingBB,
        raiseIndex,
        wasSqueeze,
      ),
    });
  }

  const cur = path[path.length - 1];
  steps.push({
    nodeId: cur.id,
    kind: "current",
    label: cur.awaitingFlop
      ? "Ветка"
      : `${seatLabel(cur.activePlayer)} ход`,
  });

  return steps;
}

export function foldedSeats(path: GameTreeNode[]): Set<string> {
  const folded = new Set<string>();
  for (const step of actorsAlongPath(path)) {
    if (step.action === "FOLD") folded.add(step.player);
  }
  return folded;
}

export function setTableSize(doc: GameTreeDocument, tableSize: TableSize): GameTreeDocument {
  return produce(doc, (draft) => {
    draft.tableSize = tableSize;
    draft.root = createRootNode(tableSize);
    draft.updatedAt = new Date().toISOString();
  });
}

export function setStackDepth(doc: GameTreeDocument, stackDepth: StackDepth): GameTreeDocument {
  return produce(doc, (draft) => {
    draft.stackDepth = stackDepth;
    draft.updatedAt = new Date().toISOString();
  });
}

/**
 * Align module meta with the strategy without wiping painted branches.
 * Empty trees may be rebuilt when table size changes.
 */
export function alignDocMeta(
  doc: GameTreeDocument,
  tableSize: TableSize,
  stackDepth: StackDepth,
): GameTreeDocument {
  return produce(doc, (draft) => {
    let touched = false;
    if (draft.stackDepth !== stackDepth) {
      draft.stackDepth = stackDepth;
      touched = true;
    }
    if (draft.tableSize !== tableSize) {
      draft.tableSize = tableSize;
      if (draft.root.children.length === 0) {
        draft.root = createRootNode(tableSize);
      }
      touched = true;
    }
    if (touched) draft.updatedAt = new Date().toISOString();
  });
}

export type CommitActionResult = {
  doc: GameTreeDocument;
  childId: string | null;
  awaitingFlop: boolean;
};

export type CommitActionOptions = {
  /** Mark the created child edge as an injected skip-ahead fold */
  autoFold?: boolean;
};

/**
 * Commit an action at parentId: create/reuse child, advance turn automatically.
 * Ranges on the parent node are already the painted matrix (saved in place).
 */
export function commitAction(
  doc: GameTreeDocument,
  parentId: string,
  action: Exclude<TreeAction, "ROOT" | "CHECK">,
  sizingBB?: number,
  options?: CommitActionOptions,
): CommitActionResult {
  let childId: string | null = null;
  let awaitingFlop = false;
  const markAuto = Boolean(options?.autoFold && action === "FOLD");

  const next = produce(doc, (draft) => {
    const parent = findNode(draft.root, parentId);
    if (!parent || parent.awaitingFlop) return;

    // Reuse same action edge (Fold ≡ Auto-Fold) so identical lines don't fork
    const existing = parent.children.find(
      (c) =>
        c.actionTaken === action &&
        (action !== "RAISE" || Math.abs((c.sizingBB ?? 0) - (sizingBB ?? 0)) < 0.001),
    );
    if (existing) {
      childId = existing.id;
      awaitingFlop = Boolean(existing.awaitingFlop);
      return;
    }

    const path = pathToNode(draft.root, parentId);
    if (!path) return;

    const turn = resolveNextTurn(draft.tableSize, path, parent.activePlayer, action);

    if (turn.kind === "dead") {
      // Still create a terminal marker child so the ribbon shows the fold
      const child: GameTreeNode = {
        id: uid("preflop_dead"),
        street: "preflop",
        activePlayer: parent.activePlayer,
        actionTaken: action,
        sizingBB: action === "RAISE" ? sizingBB : undefined,
        ranges: rangesInheritedForNextSeat(draft.root, parentId, parent.activePlayer),
        children: [],
        awaitingFlop: false,
        autoFold: markAuto || undefined,
      };
      parent.children.push(child);
      childId = child.id;
      draft.updatedAt = new Date().toISOString();
      return;
    }

    if (turn.kind === "flop") {
      const child: GameTreeNode = {
        id: uid("flop_prompt"),
        street: "flop",
        activePlayer: parent.activePlayer,
        actionTaken: action,
        sizingBB: action === "RAISE" ? sizingBB : undefined,
        ranges: emptyRanges(),
        children: [],
        awaitingFlop: true,
        autoFold: markAuto || undefined,
      };
      parent.children.push(child);
      childId = child.id;
      awaitingFlop = true;
      draft.updatedAt = new Date().toISOString();
      return;
    }

    const child: GameTreeNode = {
      id: uid(`preflop_${turn.nextPlayer.toLowerCase()}_${action.toLowerCase()}`),
      street: "preflop",
      activePlayer: turn.nextPlayer,
      actionTaken: action,
      sizingBB: action === "RAISE" ? sizingBB : undefined,
      ranges: rangesInheritedForNextSeat(draft.root, parentId, turn.nextPlayer),
      children: [],
      autoFold: markAuto || undefined,
    };
    parent.children.push(child);
    childId = child.id;
    draft.updatedAt = new Date().toISOString();
  });

  return { doc: next, childId, awaitingFlop };
}

/**
 * Live seats from the current actor through `targetSeat` (inclusive).
 * Walks clockwise and may wrap past BB (e.g. CO → … → BB → UTG after a 3-bet)
 * so the prior aggressor can answer without seat-by-seat clicking.
 * Empty if target is not reachable before a full loop.
 */
export function seatsFromActiveToTarget(
  tableSize: TableSize,
  path: GameTreeNode[],
  activeSeat: Seat,
  targetSeat: Seat,
): Seat[] {
  const folded = new Set(deriveContext(path).folded);
  if (folded.has(targetSeat)) return [];
  const chain: Seat[] = [];
  let cursor: Seat | null = activeSeat;

  for (let guard = 0; guard < 16 && cursor; guard += 1) {
    if (!folded.has(cursor)) {
      chain.push(cursor);
      if (cursor === targetSeat) return chain;
    }
    const nxt = nextSeat(tableSize, cursor, folded);
    // Full loop without hitting target
    if (!nxt || (nxt === activeSeat && cursor !== activeSeat)) break;
    cursor = nxt;
  }
  return [];
}

/**
 * Single-batch skip-ahead: auto-fold every waiting seat before `targetSeat`,
 * then commit `action` for that seat. One React state update wraps the result.
 */
export function commitWithAutoFolds(
  doc: GameTreeDocument,
  activeId: string,
  targetSeat: Seat,
  action: Exclude<TreeAction, "ROOT" | "CHECK">,
  sizingBB?: number,
): CommitActionResult {
  const start = findNode(doc.root, activeId);
  if (!start || start.awaitingFlop) {
    return { doc, childId: null, awaitingFlop: false };
  }

  const path = pathToNode(doc.root, activeId);
  if (!path) return { doc, childId: null, awaitingFlop: false };

  const chain = seatsFromActiveToTarget(
    doc.tableSize,
    path,
    start.activePlayer,
    targetSeat,
  );
  if (chain.length === 0) {
    return { doc, childId: null, awaitingFlop: false };
  }

  let current = doc;
  let nodeId = activeId;
  let childId: string | null = null;
  let awaitingFlop = false;

  for (let i = 0; i < chain.length; i += 1) {
    const isTarget = i === chain.length - 1;
    const stepAction = isTarget ? action : "FOLD";
    let raiseSize = isTarget && stepAction === "RAISE" ? sizingBB : undefined;
    // Стандартный сайз GTOW, если пользователь не передал свой
    if (isTarget && stepAction === "RAISE" && raiseSize == null) {
      const node = findNode(current.root, nodeId);
      const nodePath = pathToNode(current.root, nodeId) ?? [];
      if (node) {
        raiseSize = standardRaiseSize(
          deriveContext(nodePath),
          targetSeat,
          current.stackDepth,
        );
      }
    }
    const result = commitAction(
      current,
      nodeId,
      stepAction,
      raiseSize,
      isTarget ? undefined : { autoFold: true },
    );
    current = result.doc;
    childId = result.childId;
    awaitingFlop = result.awaitingFlop;
    if (!childId) break;
    nodeId = childId;
  }

  return { doc: current, childId, awaitingFlop };
}

/**
 * Focus a later seat for range editing: batch auto-fold everyone before it,
 * leave that seat as the current actor (no action committed for them yet).
 */
export function focusSeatWithAutoFolds(
  doc: GameTreeDocument,
  activeId: string,
  targetSeat: Seat,
): { doc: GameTreeDocument; nodeId: string } {
  const start = findNode(doc.root, activeId);
  if (!start || start.awaitingFlop) {
    return { doc, nodeId: activeId };
  }
  if (start.activePlayer === targetSeat) {
    return { doc, nodeId: activeId };
  }

  const path = pathToNode(doc.root, activeId);
  if (!path) return { doc, nodeId: activeId };

  const chain = seatsFromActiveToTarget(
    doc.tableSize,
    path,
    start.activePlayer,
    targetSeat,
  );
  // chain includes target — fold everyone except the last (target)
  if (chain.length < 2) return { doc, nodeId: activeId };

  let current = doc;
  let nodeId = activeId;

  for (let i = 0; i < chain.length - 1; i += 1) {
    const result = commitAction(current, nodeId, "FOLD", undefined, {
      autoFold: true,
    });
    if (!result.childId) break;
    current = result.doc;
    nodeId = result.childId;
  }

  return { doc: current, nodeId };
}

/** @deprecated use commitAction */
export function addActionBranch(
  doc: GameTreeDocument,
  parentId: string,
  action: Exclude<TreeAction, "ROOT">,
  sizingBB?: number,
): { doc: GameTreeDocument; childId: string | null } {
  if (action === "CHECK") return { doc, childId: null };
  const r = commitAction(doc, parentId, action, sizingBB);
  return { doc: r.doc, childId: r.childId };
}

export type PaintBrush =
  | { mode: "action"; action: PaintAction; weight: number }
  | { mode: "mix"; raise: number; call: number };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Dual-slider mix: Raise% + Call%, Fold fills the rest. */
export function mixFromDual(raise: number, call: number): HandMix {
  let r = clamp01(raise);
  let c = clamp01(call);
  if (r + c > 1) {
    const s = r + c;
    r /= s;
    c /= s;
  }
  return { RAISE: r, CALL: c, FOLD: clamp01(1 - r - c) };
}

/**
 * Layered single-action brush: set one action to weight, keep the other if
 * Raise+Call ≤ 1 (otherwise shrink the other), Fold fills remainder.
 */
export function layeredActionMix(
  prev: HandMix | undefined,
  action: PaintAction,
  weight: number,
): HandMix {
  if (action === "FOLD") return { FOLD: 1, CALL: 0, RAISE: 0 };
  const w = clamp01(weight);
  const base = prev ?? { FOLD: 1, CALL: 0, RAISE: 0 };
  let raise = base.RAISE;
  let call = base.CALL;
  if (action === "RAISE") {
    raise = w;
    if (raise + call > 1) call = clamp01(1 - raise);
  } else {
    call = w;
    if (raise + call > 1) raise = clamp01(1 - call);
  }
  return { RAISE: raise, CALL: call, FOLD: clamp01(1 - raise - call) };
}

export function applyBrushToMix(
  prev: HandMix | undefined,
  brush: PaintBrush,
): HandMix {
  if (brush.mode === "mix") return mixFromDual(brush.raise, brush.call);
  return layeredActionMix(prev, brush.action, brush.weight);
}

function writeHandMix(
  node: GameTreeNode,
  hand: HandCode,
  mix: HandMix,
): boolean {
  if (isPureFold(mix)) {
    if (hand in node.ranges) {
      delete node.ranges[hand];
      return true;
    }
    return false;
  }
  node.ranges[hand] = mix;
  return true;
}

export function paintHand(
  doc: GameTreeDocument,
  nodeId: string,
  hand: HandCode,
  action: PaintAction,
  weight = 1,
  erase = false,
): GameTreeDocument {
  return paintHandWithBrush(
    doc,
    nodeId,
    hand,
    { mode: "action", action, weight },
    erase,
  );
}

export function paintHandWithBrush(
  doc: GameTreeDocument,
  nodeId: string,
  hand: HandCode,
  brush: PaintBrush,
  erase = false,
): GameTreeDocument {
  return produce(doc, (draft) => {
    const node = findNode(draft.root, nodeId);
    if (!node || node.awaitingFlop) return;
    if (erase || (brush.mode === "action" && brush.action === "FOLD")) {
      if (hand in node.ranges) {
        delete node.ranges[hand];
        draft.updatedAt = new Date().toISOString();
      }
      return;
    }
    if (!handPaintableOnNode(draft.root, node, hand)) return;
    const mix = applyBrushToMix(node.ranges[hand], brush);
    if (writeHandMix(node, hand, mix)) {
      draft.updatedAt = new Date().toISOString();
    }
  });
}

/** True when this hand already matches the brush (re-click → erase to fold). */
export function handMatchesBrush(
  mix: HandMix | undefined,
  action: PaintAction,
  weight = 1,
): boolean {
  return handMatchesPaintBrush(mix, { mode: "action", action, weight });
}

export function handMatchesPaintBrush(
  mix: HandMix | undefined,
  brush: PaintBrush,
): boolean {
  const m = mix ?? { FOLD: 1, CALL: 0, RAISE: 0 };
  if (brush.mode === "mix") {
    const target = mixFromDual(brush.raise, brush.call);
    return (
      Math.abs(m.RAISE - target.RAISE) <= 0.02 &&
      Math.abs(m.CALL - target.CALL) <= 0.02
    );
  }
  if (brush.action === "FOLD") {
    return m.FOLD >= 0.98 && m.CALL < 0.02 && m.RAISE < 0.02;
  }
  const w = clamp01(brush.weight);
  return Math.abs(m[brush.action] - w) <= 0.02 && m[brush.action] >= 0.05;
}

export function paintHands(
  doc: GameTreeDocument,
  nodeId: string,
  hands: HandCode[],
  action: PaintAction,
  weight = 1,
): GameTreeDocument {
  return paintHandsWithBrush(doc, nodeId, hands, {
    mode: "action",
    action,
    weight,
  });
}

export function paintHandsWithBrush(
  doc: GameTreeDocument,
  nodeId: string,
  hands: HandCode[],
  brush: PaintBrush,
): GameTreeDocument {
  return produce(doc, (draft) => {
    const node = findNode(draft.root, nodeId);
    if (!node || node.awaitingFlop) return;
    let changed = false;
    for (const hand of hands) {
      if (brush.mode === "action" && brush.action === "FOLD") {
        if (hand in node.ranges) {
          delete node.ranges[hand];
          changed = true;
        }
        continue;
      }
      if (!handPaintableOnNode(draft.root, node, hand)) continue;
      const mix = applyBrushToMix(node.ranges[hand], brush);
      if (writeHandMix(node, hand, mix)) changed = true;
    }
    if (changed) draft.updatedAt = new Date().toISOString();
  });
}

/** One immer pass for a drag stroke (paint + erase mixed). */
export function paintHandBatch(
  doc: GameTreeDocument,
  nodeId: string,
  strokes: Array<{ hand: HandCode; erase?: boolean }>,
  action: PaintAction,
  weight = 1,
): GameTreeDocument {
  return paintHandBatchWithBrush(doc, nodeId, strokes, {
    mode: "action",
    action,
    weight,
  });
}

export function paintHandBatchWithBrush(
  doc: GameTreeDocument,
  nodeId: string,
  strokes: Array<{ hand: HandCode; erase?: boolean }>,
  brush: PaintBrush,
): GameTreeDocument {
  if (!strokes.length) return doc;
  return produce(doc, (draft) => {
    const node = findNode(draft.root, nodeId);
    if (!node || node.awaitingFlop) return;
    let changed = false;
    for (const { hand, erase } of strokes) {
      if (erase || (brush.mode === "action" && brush.action === "FOLD")) {
        if (hand in node.ranges) {
          delete node.ranges[hand];
          changed = true;
        }
        continue;
      }
      if (!handPaintableOnNode(draft.root, node, hand)) continue;
      const mix = applyBrushToMix(node.ranges[hand], brush);
      if (writeHandMix(node, hand, mix)) changed = true;
    }
    if (changed) draft.updatedAt = new Date().toISOString();
  });
}

/** Update raise sizing on a branch edge; child contextual text re-derives from path. */
export function updateBranchSizing(
  doc: GameTreeDocument,
  parentId: string,
  childId: string,
  sizingBB: number,
): GameTreeDocument {
  return produce(doc, (draft) => {
    const parent = findNode(draft.root, parentId);
    if (!parent) return;
    const child = parent.children.find((c) => c.id === childId);
    if (!child || child.actionTaken !== "RAISE") return;
    child.sizingBB = sizingBB;
    draft.updatedAt = new Date().toISOString();
  });
}

/**
 * Time-travel: jump to nodeId and prune all subsequent branches
 * so the user can pick a different action from that seat.
 */
export function rewindAndPrune(doc: GameTreeDocument, nodeId: string): GameTreeDocument {
  return produce(doc, (draft) => {
    const node = findNode(draft.root, nodeId);
    if (!node) return;
    node.children = [];
    draft.updatedAt = new Date().toISOString();
  });
}

function nodeHasPaint(node: GameTreeNode): boolean {
  for (const mix of Object.values(node.ranges)) {
    if (mix.CALL > 0.02 || mix.RAISE > 0.02 || mix.FOLD < 0.98) return true;
  }
  return false;
}

/**
 * Delete a saved branch tip. Removes the tip edge and prunes empty
 * unpainted ancestors so sibling lines stay intact.
 */
export function deleteBranch(
  doc: GameTreeDocument,
  tipNodeId: string,
): { doc: GameTreeDocument; rootId: string } {
  const next = produce(doc, (draft) => {
    const path = pathToNode(draft.root, tipNodeId);
    if (!path || path.length < 2) return;

    const parent = path[path.length - 2];
    parent.children = parent.children.filter((c) => c.id !== tipNodeId);

    for (let i = path.length - 2; i >= 1; i -= 1) {
      const node = path[i];
      const grand = path[i - 1];
      if (node.children.length === 0 && !nodeHasPaint(node)) {
        grand.children = grand.children.filter((c) => c.id !== node.id);
      } else {
        break;
      }
    }
    draft.updatedAt = new Date().toISOString();
  });
  return { doc: next, rootId: next.root.id };
}

/** Wipe every branch; keep strategy id / table / stack. */
export function resetBranches(doc: GameTreeDocument): GameTreeDocument {
  return createDocument(doc.strategyId, doc.tableSize, doc.stackDepth);
}

export { deriveContext } from "./turnEngine";

export function allHandCodes(): HandCode[] {
  const codes: HandCode[] = [];
  for (let r = 0; r < 13; r += 1) {
    for (let c = 0; c < 13; c += 1) {
      const a = RANKS[r];
      const b = RANKS[c];
      if (r === c) codes.push(`${a}${b}`);
      else if (r < c) codes.push(`${a}${b}s`);
      else codes.push(`${b}${a}o`);
    }
  }
  return codes;
}
