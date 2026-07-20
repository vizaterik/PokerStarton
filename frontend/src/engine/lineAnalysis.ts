/**
 * Per-hand strategy line analysis against the local constructor tree.
 */
import type { ReplayHand } from "../api/client";
import type { HandCode } from "../lib/handMatrix";
import { branchStats, partitionError, REACH_EPS, type BranchStat } from "../lib/gameTree/combos";
import { findParent } from "../lib/gameTree/engine";
import {
  buildPlayedLine,
  matchLineToTree,
  type LineMatchFound,
  type LineMatchMissing,
  type MatchedPathStep,
  type PlayedLine,
} from "../lib/gameTree/lineMatch";
import type { GameTreeDocument, GameTreeNode, PaintAction } from "../lib/gameTree/types";
import { cardsToHandCode } from "./handCodes";
import type { HandRow } from "./localDb";
import type { ParsedAction, ParsedSeat } from "./types";

/** Minimal HandRow for line matching from a replay snapshot. */
export function handRowFromReplay(hand: ReplayHand): HandRow {
  const seats: ParsedSeat[] = (hand.seats ?? []).map((s) => ({
    seat: s.seat,
    name: s.name,
    stack: s.stack ?? 0,
  }));
  const actions: ParsedAction[] = (hand.actions ?? []).map((a, i) => ({
    street: a.street,
    action_order: a.order ?? i,
    player_name: a.player_name,
    is_hero: a.is_hero,
    action: a.action,
    amount: a.amount,
  }));
  let heroHandCode: string | null = null;
  if (hand.hero_cards?.length >= 2) {
    try {
      heroHandCode = cardsToHandCode(hand.hero_cards[0], hand.hero_cards[1]);
    } catch {
      heroHandCode = null;
    }
  }
  const button = hand.seats?.find((s) => s.is_button)?.seat ?? null;
  return {
    key: hand.id,
    external_hand_id: hand.external_hand_id,
    session_id: "",
    strategy_id: "",
    hero_name: hand.hero_name,
    hero_position: hand.hero_position,
    hero_hand: hand.hero_cards?.join(" ") ?? null,
    hero_hand_code: heroHandCode,
    detected_spot: null,
    villain_position: null,
    hero_preflop_action: null,
    stack_bb: null,
    hero_net: hand.hero_net,
    hero_net_bb: hand.hero_net_bb,
    went_to_showdown: false,
    hero_net_wsd: null,
    hero_net_wsd_bb: null,
    hero_net_wwsd: null,
    hero_net_wwsd_bb: null,
    table_name: hand.table_name,
    table_max: hand.seats?.length ?? null,
    button_seat: button,
    small_blind: hand.small_blind,
    big_blind: hand.big_blind,
    seats,
    actions,
    preflop_actions: actions.filter((a) => (a.street || "").toLowerCase() === "preflop"),
    raw_text: hand.raw_text || "",
    vpip: 0,
    pfr: 0,
    three_bet: 0,
    three_bet_opp: 0,
    played_at: hand.played_at,
    flags: null,
  };
}

export type LineIntegrity = {
  lost: HandCode[];
  overlapping: HandCode[];
  parentReachCount: number;
  childCoveredCount: number;
};

export type HandLineFound = {
  status: "found";
  handId: string;
  line: PlayedLine;
  steps: MatchedPathStep[];
  pathLabels: string[];
  heroAction: PaintAction;
  heroHandCode: string | null;
  /** Hero hand mass on chosen action at decision node. */
  inRange: boolean;
  mixOnHand: { FOLD: number; CALL: number; RAISE: number } | null;
  splits: BranchStat[];
  deviationText: string | null;
  integrity: LineIntegrity | null;
  heroDecisionNodeId: string;
};

export type HandLineMissing = {
  status: "missing_branch";
  handId: string;
  line: PlayedLine;
  steps: MatchedPathStep[];
  pathLabels: string[];
  missingLabel: string;
  parentNodeId: string;
  matchedCount: number;
};

export type HandLineEmpty = {
  status: "empty";
  handId: string;
  line: PlayedLine;
};

export type HandLineAnalysis = HandLineFound | HandLineMissing | HandLineEmpty;

function pathLabelsFromSteps(steps: MatchedPathStep[]): string[] {
  return steps.map((s) => s.label);
}

function mixForHand(
  node: GameTreeNode,
  hand: string | null,
): { FOLD: number; CALL: number; RAISE: number } | null {
  if (!hand) return null;
  const mix = node.ranges[hand as HandCode];
  if (!mix) return null;
  return {
    FOLD: mix.FOLD ?? 0,
    CALL: mix.CALL ?? 0,
    RAISE: mix.RAISE ?? 0,
  };
}

function actionInRange(
  mix: { FOLD: number; CALL: number; RAISE: number } | null,
  action: PaintAction,
): boolean {
  if (!mix) return false;
  return (mix[action] ?? 0) > REACH_EPS;
}

function deviationMessage(
  handCode: string | null,
  heroAction: PaintAction,
  mix: { FOLD: number; CALL: number; RAISE: number } | null,
  inRange: boolean,
): string | null {
  if (!handCode) return "Нет кода руки героя для сверки.";
  if (!mix) return `${handCode}: рука отсутствует в чарте ветки.`;
  if (inRange) return null;
  const parts = (
    [
      ["FOLD", mix.FOLD],
      ["CALL", mix.CALL],
      ["RAISE", mix.RAISE],
    ] as const
  )
    .filter(([, v]) => v > REACH_EPS)
    .map(([a, v]) => `${a} ${Math.round(v * 100)}%`);
  const strat = parts.length ? parts.join(" · ") : "100% FOLD";
  return `${handCode}: сыграно ${heroAction}, в стратегии — ${strat}.`;
}

function integrityAtNode(doc: GameTreeDocument, decision: GameTreeNode): LineIntegrity | null {
  const parent = findParent(doc.root, decision.id);
  // Integrity of the hero fork = siblings of hero's outgoing edges from decision
  const children = decision.children.filter(
    (c) => c.actionTaken === "FOLD" || c.actionTaken === "CALL" || c.actionTaken === "RAISE",
  );
  if (!children.length) return null;
  // Soft: only warn when decision has painted play mass
  let painted = false;
  for (const mix of Object.values(decision.ranges)) {
    if ((mix.CALL ?? 0) > REACH_EPS || (mix.RAISE ?? 0) > REACH_EPS) {
      painted = true;
      break;
    }
  }
  if (!painted) return null;
  const err = partitionError(decision, children);
  if (!err.lost.length && !err.overlapping.length) return null;
  void parent;
  return err;
}

function analyzeFound(
  hand: HandRow,
  line: PlayedLine,
  match: LineMatchFound,
  doc: GameTreeDocument,
): HandLineFound {
  const mix = mixForHand(match.heroDecisionNode, line.heroHandCode);
  const inRange = actionInRange(mix, match.heroAction);
  const raiseLabel =
    match.heroAction === "RAISE"
      ? match.steps.find((s) => s.nodeId === match.heroDecisionNode.id && s.action === "RAISE")
          ?.label?.replace(/^[A-Z0-9+]+\s/, "") || "RAISE"
      : "RAISE";
  return {
    status: "found",
    handId: hand.key,
    line,
    steps: match.steps,
    pathLabels: pathLabelsFromSteps(match.steps),
    heroAction: match.heroAction,
    heroHandCode: line.heroHandCode,
    inRange,
    mixOnHand: mix,
    splits: branchStats(match.heroDecisionNode, raiseLabel),
    deviationText: deviationMessage(line.heroHandCode, match.heroAction, mix, inRange),
    integrity: integrityAtNode(doc, match.heroDecisionNode),
    heroDecisionNodeId: match.heroDecisionNode.id,
  };
}

function analyzeMissing(
  hand: HandRow,
  line: PlayedLine,
  match: LineMatchMissing,
): HandLineMissing {
  const m = match.missingAction;
  const size =
    m.action === "RAISE" && m.sizingBB != null ? ` ${m.sizingBB}` : "";
  return {
    status: "missing_branch",
    handId: hand.key,
    line,
    steps: match.steps,
    pathLabels: pathLabelsFromSteps(match.steps),
    missingLabel: `${m.seatLabel || m.seat} ${m.action}${size}`,
    parentNodeId: match.parentNode.id,
    matchedCount: match.matchedCount,
  };
}

/** Analyze one hand against the constructor tree. */
export function analyzeHandLine(
  doc: GameTreeDocument,
  hand: HandRow,
): HandLineAnalysis {
  const line = buildPlayedLine(hand);
  if (!line.actions.length) {
    return { status: "empty", handId: hand.key, line };
  }
  const match = matchLineToTree(doc, line);
  if (match.status === "empty") {
    return { status: "empty", handId: hand.key, line };
  }
  if (match.status === "missing") {
    return analyzeMissing(hand, line, match);
  }
  return analyzeFound(hand, line, match, doc);
}

export function analyzeReplayHand(
  doc: GameTreeDocument,
  hand: ReplayHand,
): HandLineAnalysis {
  return analyzeHandLine(doc, handRowFromReplay(hand));
}

export type LineAnalysisSummary = {
  total: number;
  found: number;
  missing: number;
  empty: number;
  inRange: number;
  deviations: number;
  integrityWarnings: number;
  hands: HandLineAnalysis[];
};

/** Batch analyze session hands (capped for UI). */
export function analyzeHandsAgainstTree(
  doc: GameTreeDocument,
  hands: HandRow[],
  limit = 200,
): LineAnalysisSummary {
  const slice = hands.slice(0, limit);
  const results = slice.map((h) => analyzeHandLine(doc, h));
  let found = 0;
  let missing = 0;
  let empty = 0;
  let inRange = 0;
  let deviations = 0;
  let integrityWarnings = 0;
  for (const r of results) {
    if (r.status === "empty") empty += 1;
    else if (r.status === "missing_branch") missing += 1;
    else {
      found += 1;
      if (r.inRange) inRange += 1;
      else deviations += 1;
      if (r.integrity && (r.integrity.lost.length || r.integrity.overlapping.length)) {
        integrityWarnings += 1;
      }
    }
  }
  return {
    total: results.length,
    found,
    missing,
    empty,
    inRange,
    deviations,
    integrityWarnings,
    hands: results,
  };
}
