/**
 * Build a full constructor branch from a session/strategy spot — same lines as
 * style presets (sizings + fold to flop), then open editor like onOpenBranch.
 */
import { putStrategyTree } from "../../api/client";
import {
  fourBetLine,
  openLine,
  seedPresetLine,
  srpLine,
  threeBetLine,
  type PresetLine,
} from "./branchPresets";
import { commitWithAutoFolds, findNode, pathToNode } from "./engine";
import {
  buildPlayedLine,
  type PlayedLine,
  type PlayedLineAction,
} from "./lineMatch";
import { loadTree, saveTree } from "./persist";
import { branchRangeSpots } from "./rangeSpots";
import { seatsFor } from "./seats";
import { standardOpenSize, THREE_BET_MULT, FOUR_BET_MULT } from "./standardSizings";
import type { GameTreeDocument, GameTreeNode, Seat, TableSize } from "./types";
import type { HandRow } from "../../engine/localDb";

export type SpotSeed = {
  spot_key: string;
  hero_position: string;
  villain_position?: string | null;
};

export type SeedFocus = {
  tipNodeId: string;
  paintNodeId: string;
};

export type SeedSpotResult = SeedFocus & {
  doc: GameTreeDocument;
};

function chartPosToSeat(pos: string, tableSize: TableSize): Seat | null {
  const p = pos.trim().toUpperCase();
  if (p === "BTN" || p === "SB" || p === "BB") return p;
  if (tableSize === 2 || tableSize === 3) {
    return null;
  }
  if (p === "UTG" || p === "CO") return p;
  if (p === "MP" || p === "HJ" || p === "UTG1" || p === "UTG+1") {
    if (tableSize === 6) return p === "UTG1" || p === "UTG+1" ? "UTG" : "HJ";
    if (p === "HJ") return "HJ";
    if (p === "UTG1" || p === "UTG+1") return "UTG1";
    return "MP";
  }
  if (p === "MP1" || p === "UTG2" || p === "UTG+2") {
    return tableSize === 9 ? "MP1" : "HJ";
  }
  return null;
}

function countNodes(node: GameTreeNode): number {
  let n = 1;
  for (const child of node.children) n += countNodes(child);
  return n;
}

/**
 * Opener must act before the later seat (3-bettor / caller). If HH roles are
 * reversed, swap so seedPresetLine can close to flop like style presets.
 */
function orderedPair(
  earlierCandidate: Seat,
  laterCandidate: Seat,
  tableSize: TableSize,
): { earlier: Seat; later: Seat } {
  const order = seatsFor(tableSize);
  const a = order.indexOf(earlierCandidate);
  const b = order.indexOf(laterCandidate);
  if (a >= 0 && b >= 0 && a < b) {
    return { earlier: earlierCandidate, later: laterCandidate };
  }
  if (a >= 0 && b >= 0 && b < a) {
    return { earlier: laterCandidate, later: earlierCandidate };
  }
  return { earlier: earlierCandidate, later: laterCandidate };
}

/** Map HH / strategy spot → same PresetLine factories as BranchPanel styles. */
function spotToPresetLine(
  spot: SpotSeed,
  tableSize: TableSize,
): PresetLine | null {
  const hero = chartPosToSeat(spot.hero_position, tableSize);
  if (!hero) return null;
  const key = spot.spot_key.trim().toLowerCase();
  const villain = spot.villain_position
    ? chartPosToSeat(spot.villain_position, tableSize)
    : null;

  if (key === "rfi" || key === "iso") {
    return openLine(hero);
  }

  if (!villain || villain === hero) return null;

  if (key === "vs_open" || key === "squeeze") {
    // Villain open, hero call — opener must be earlier seat.
    const { earlier: opener, later: caller } = orderedPair(
      villain,
      hero,
      tableSize,
    );
    return srpLine(opener, caller);
  }

  if (key === "vs_3bet") {
    // Style preset: open → 3-bet → open call. Matchup tag = 3bettor vs opener.
    // HH: villain = last aggressor (3-bettor), hero = facing (usually opener).
    const { earlier: opener, later: threeBettor } = orderedPair(
      hero,
      villain,
      tableSize,
    );
    return threeBetLine(opener, threeBettor);
  }

  if (key === "vs_4bet") {
    // Style preset: open → 3-bet → 4-bet → call. Opener earlier, 3-bettor later.
    const { earlier: opener, later: threeBettor } = orderedPair(
      villain,
      hero,
      tableSize,
    );
    return fourBetLine(opener, threeBettor);
  }

  return null;
}

/**
 * Prefer the HH hero's decision node on the line so "Add to Strategy" opens
 * the matrix the user must paint (not the opener's RFI by default).
 */
function pickHeroPaintNodeId(
  spots: ReturnType<typeof branchRangeSpots>,
  hero: Seat | null,
  spotKey: string,
): string | null {
  if (!hero || !spots.length) return null;
  const heroSpots = spots.filter((s) => s.seat === hero);
  if (!heroSpots.length) return null;
  const key = spotKey.trim().toLowerCase();
  if (key === "rfi" || key === "iso") {
    return (
      heroSpots.find((s) => s.lineAction === "RAISE")?.nodeId ??
      heroSpots[0].nodeId
    );
  }
  if (key === "squeeze") {
    return (
      heroSpots.find((s) => s.lineAction === "RAISE")?.nodeId ??
      heroSpots.find((s) => s.lineAction === "CALL")?.nodeId ??
      heroSpots[0].nodeId
    );
  }
  // vs_open / vs_3bet / vs_4bet — facing decision (call continuum) first.
  return (
    heroSpots.find((s) => s.lineAction === "CALL")?.nodeId ??
    heroSpots.find((s) => s.lineAction === "RAISE")?.nodeId ??
    heroSpots[0].nodeId
  );
}

/** Flop tip + paint node for this spot (hero seat when possible). */
function focusForSpot(
  doc: GameTreeDocument,
  tipId: string,
  spot: SpotSeed,
): SeedFocus | null {
  const tip = findNode(doc.root, tipId);
  if (!tip?.awaitingFlop) return null;
  const tipPath = pathToNode(doc.root, tipId) ?? [];
  const spots = branchRangeSpots(tipPath, doc.stackDepth).filter(
    (s) => s.lineAction === "RAISE" || s.lineAction === "CALL",
  );
  if (spots.length === 0) return null;
  const hero = chartPosToSeat(spot.hero_position, doc.tableSize);
  const paintNodeId =
    pickHeroPaintNodeId(spots, hero, spot.spot_key) ?? spots[0].nodeId;
  return {
    tipNodeId: tipId,
    paintNodeId,
  };
}

function lineLooksReady(
  doc: GameTreeDocument,
  tipId: string,
  line: PresetLine,
): boolean {
  const tip = findNode(doc.root, tipId);
  if (!tip?.awaitingFlop) return false;
  const tipPath = pathToNode(doc.root, tipId) ?? [];
  const spots = branchRangeSpots(tipPath, doc.stackDepth).filter(
    (s) => s.lineAction === "RAISE" || s.lineAction === "CALL",
  );
  // 3-bet pot → open / 3-bet / call; SRP → open / call; open → raise only.
  if (line.kind === "3bp") return spots.length >= 3;
  if (line.kind === "4bp" || line.kind === "allin") return spots.length >= 4;
  if (line.kind === "srp" && line.opener !== line.villain) return spots.length >= 2;
  return spots.length >= 1;
}

/**
 * Build (or extend) the preflop line like style presets, close to flop,
 * and return the same editor focus as opening a saved branch.
 */
export function seedSpotIntoDoc(
  doc: GameTreeDocument,
  spot: SpotSeed,
): SeedSpotResult | null {
  const line = spotToPresetLine(spot, doc.tableSize);
  if (!line) return null;

  const { doc: built, tipId } = seedPresetLine(doc, line);
  if (!tipId || !lineLooksReady(built, tipId, line)) return null;

  const focus = focusForSpot(built, tipId, spot);
  if (!focus) return null;

  return {
    doc: built,
    tipNodeId: focus.tipNodeId,
    paintNodeId: focus.paintNodeId,
  };
}

/**
 * True when the tree already contains this spot's line (seeding would not add nodes).
 */
export function treeAlreadyHasSpotLine(
  doc: GameTreeDocument,
  spot: SpotSeed,
): boolean {
  const clone = JSON.parse(JSON.stringify(doc)) as GameTreeDocument;
  const before = countNodes(clone.root);
  const result = seedSpotIntoDoc(clone, spot);
  if (!result) return false;
  return countNodes(result.doc.root) === before;
}

/** Persist one spot into the local strategy tree; returns focus for the editor. */
export function seedSpotIntoTree(
  strategyId: string,
  spot: SpotSeed,
): SeedFocus | null {
  const result = seedSpotIntoDoc(loadTree(strategyId), spot);
  if (!result) return null;
  const next = { ...result.doc, updatedAt: new Date().toISOString() };
  saveTree(next);
  // Push so editor hydrate does not replace with an older remote tree.
  void putStrategyTree(strategyId, next as unknown as Record<string, unknown>).catch(
    () => undefined,
  );
  return { tipNodeId: result.tipNodeId, paintNodeId: result.paintNodeId };
}

function defaultSizing(action: PlayedLineAction, raiseCount: number, seat: Seat): number | undefined {
  if (action.action !== "RAISE") return undefined;
  if (action.sizingBB != null) return action.sizingBB;
  if (raiseCount <= 0) return standardOpenSize(seat);
  if (raiseCount === 1) return Math.round(standardOpenSize(seat) * THREE_BET_MULT * 10) / 10;
  return Math.round(standardOpenSize(seat) * THREE_BET_MULT * FOUR_BET_MULT * 10) / 10;
}

/**
 * Create missing tree edges for a played HH line (with range inheritance via commitAction).
 * Returns editor focus on the hero decision node.
 */
export function seedPlayedLineIntoDoc(
  doc: GameTreeDocument,
  line: PlayedLine,
): SeedSpotResult | null {
  if (!line.actions.length) return null;

  let current = doc;
  let raiseCount = 0;
  let cursorId = current.root.id;
  let heroPaintId: string | null = null;

  for (const act of line.actions) {
    const parent = findNode(current.root, cursorId);
    if (!parent || parent.awaitingFlop) break;

    const sizing = defaultSizing(act, raiseCount, act.seat);
    const beforeId = cursorId;
    const result = commitWithAutoFolds(
      current,
      cursorId,
      act.seat,
      act.action,
      sizing,
    );
    if (!result.childId) return null;
    current = result.doc;
    if (act.isHero) {
      const p = pathToNode(current.root, result.childId);
      if (p && p.length >= 2) heroPaintId = p[p.length - 2].id;
      else heroPaintId = beforeId;
    }
    cursorId = result.childId;
    if (act.action === "RAISE") raiseCount += 1;
    if (result.awaitingFlop) break;
  }

  const paintNodeId = heroPaintId ?? cursorId;
  if (!findNode(current.root, paintNodeId)) return null;

  let tipNodeId = paintNodeId;
  const path = pathToNode(current.root, paintNodeId) ?? [];
  const flopTip = path.find((n) => n.awaitingFlop);
  if (flopTip) tipNodeId = flopTip.id;
  else {
    const last = findNode(current.root, cursorId);
    if (last?.awaitingFlop) tipNodeId = last.id;
  }

  return { doc: current, tipNodeId, paintNodeId };
}

export function seedPlayedLineIntoTree(
  strategyId: string,
  hand: HandRow,
): SeedFocus | null {
  const line = buildPlayedLine(hand);
  const result = seedPlayedLineIntoDoc(loadTree(strategyId), line);
  if (!result) return null;
  const next = { ...result.doc, updatedAt: new Date().toISOString() };
  saveTree(next);
  void putStrategyTree(strategyId, next as unknown as Record<string, unknown>).catch(
    () => undefined,
  );
  return { tipNodeId: result.tipNodeId, paintNodeId: result.paintNodeId };
}

/** Ensure open (and facing) lines exist after analysis creates spots. */
export function seedTreeOpensFromSpots(strategyId: string, spots: SpotSeed[]) {
  if (spots.length === 0) return;

  let doc = loadTree(strategyId);
  for (const spot of spots) {
    const result = seedSpotIntoDoc(doc, spot);
    if (result) doc = result.doc;
  }
  doc = { ...doc, updatedAt: new Date().toISOString() };
  saveTree(doc);
  void putStrategyTree(strategyId, doc as unknown as Record<string, unknown>).catch(
    () => undefined,
  );
}
