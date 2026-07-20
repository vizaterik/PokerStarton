import { produce } from "immer";
import type { HandCode } from "../handMatrix";
import { matrixFromRanges, type RangeBuildSpec } from "../rangeNotation";
import { STRATEGY_PRESETS, type StrategyPreset } from "../strategyPresets";
import type { Position } from "../../types/strategy";
import { collectBranches, nodeHasPaintedRange } from "./branches";
import { actorsAlongPath } from "./turnEngine";
import { commitWithAutoFolds, findNode, pathToNode } from "./engine";
import { SEATS_6 } from "./seats";
import { standardOpenSize, THREE_BET_MULT, FOUR_BET_MULT } from "./standardSizings";
import type { GameTreeDocument, HandMix, Seat } from "./types";

export type PresetAction = {
  seat: Seat;
  action: "FOLD" | "CALL" | "RAISE";
  sizingBB?: number;
};

export type LineKind = "srp" | "3bp" | "4bp";

export type PresetLine = {
  id: string;
  label: string;
  kind: LineKind;
  opener: Seat;
  /** Caller (SRP) or 3-bettor (3bp/4bp) */
  villain: Seat;
  actions: PresetAction[];
};

export type StylePreset = {
  id: string;
  name: string;
  tag: string;
  description: string;
  strategyId: string;
  lines: PresetLine[];
};

const OPENERS: Seat[] = ["UTG", "HJ", "CO", "BTN", "SB"];

const threeBet = (open: number) => Math.round(open * THREE_BET_MULT * 10) / 10;
const fourBet = (tb: number) => Math.round(tb * FOUR_BET_MULT * 10) / 10;

function respondersAfter(opener: Seat): Seat[] {
  // Only seats that still act after the open (earlier seats already folded).
  const order = SEATS_6;
  const oi = order.indexOf(opener);
  if (oi < 0) return [];
  return order.slice(oi + 1);
}

function openSize(opener: Seat): number {
  return standardOpenSize(opener);
}

export function toChartPos(seat: Seat): Position {
  if (seat === "HJ" || seat === "MP") return "MP";
  if (seat === "UTG" || seat === "CO" || seat === "BTN" || seat === "SB" || seat === "BB") {
    return seat;
  }
  return "MP";
}

/** RFI: open → fold rest to flop (tag like `UTG`). */
export function openLine(opener: Seat): PresetLine {
  const size = openSize(opener);
  return {
    id: `open_${opener}`,
    label: `${opener}`,
    kind: "srp",
    opener,
    villain: opener,
    actions: [{ seat: opener, action: "RAISE", sizingBB: size }],
  };
}

/** SRP: open → call → fold to flop (same as style presets). */
export function srpLine(opener: Seat, caller: Seat): PresetLine {
  const size = openSize(opener);
  return {
    id: `srp_${opener}_${caller}`,
    label: `Raise ${opener}vs${caller}`,
    kind: "srp",
    opener,
    villain: caller,
    actions: [
      { seat: opener, action: "RAISE", sizingBB: size },
      { seat: caller, action: "CALL" },
    ],
  };
}

/** 3-bet pot: open → 3-bet → open call (same as style presets). */
export function threeBetLine(opener: Seat, threeBettor: Seat): PresetLine {
  const size = openSize(opener);
  const tb = threeBet(size);
  return {
    id: `3bp_${opener}_${threeBettor}`,
    label: `3-bet ${threeBettor}vs${opener}`,
    kind: "3bp",
    opener,
    villain: threeBettor,
    actions: [
      { seat: opener, action: "RAISE", sizingBB: size },
      { seat: threeBettor, action: "RAISE", sizingBB: tb },
      { seat: opener, action: "CALL" },
    ],
  };
}

/** 4-bet pot: open → 3-bet → 4-bet → call (same as style presets). */
export function fourBetLine(opener: Seat, threeBettor: Seat): PresetLine {
  const size = openSize(opener);
  const tb = threeBet(size);
  const fb = fourBet(tb);
  return {
    id: `4bp_${opener}_${threeBettor}`,
    label: `4-bet ${opener}vs${threeBettor}`,
    kind: "4bp",
    opener,
    villain: threeBettor,
    actions: [
      { seat: opener, action: "RAISE", sizingBB: size },
      { seat: threeBettor, action: "RAISE", sizingBB: tb },
      { seat: opener, action: "RAISE", sizingBB: fb },
      { seat: threeBettor, action: "CALL" },
    ],
  };
}

function srp(opener: Seat, caller: Seat): PresetLine {
  return srpLine(opener, caller);
}

function threeBetPot(opener: Seat, threeBettor: Seat): PresetLine {
  return threeBetLine(opener, threeBettor);
}

function fourBetPot(opener: Seat, threeBettor: Seat): PresetLine {
  return fourBetLine(opener, threeBettor);
}

/** All HU branches: open-call, 3-bet, 4-bet (no separate all-in pot). */
export function allHuActionBranches(): PresetLine[] {
  const lines: PresetLine[] = [];
  for (const opener of OPENERS) {
    for (const responder of respondersAfter(opener)) {
      lines.push(srp(opener, responder));
      lines.push(threeBetPot(opener, responder));
      lines.push(fourBetPot(opener, responder));
    }
  }
  return lines;
}

const ALL_LINES = allHuActionBranches();

function strategyForStyle(strategyId: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((p) => p.id === strategyId);
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "tag",
    name: "TAG",
    tag: "TAG",
    strategyId: "tag",
    description:
      "Tight-Aggressive: open/call, 3-bet, 4-bet, all-in + чарты стратегии.",
    lines: ALL_LINES,
  },
  {
    id: "lag",
    name: "Агрессивный (LAG)",
    tag: "LAG",
    strategyId: "lag",
    description:
      "Loose-Aggressive: полный набор preflop веток с широкими чартами.",
    lines: ALL_LINES,
  },
  {
    id: "nit",
    name: "NIT",
    tag: "NIT",
    strategyId: "nit",
    description: "Nit: open/call, 3-bet, 4-bet, all-in с узкими чартами.",
    lines: ALL_LINES,
  },
  {
    id: "abc",
    name: "Сбалансированный (ABC)",
    tag: "ABC",
    strategyId: "balanced",
    description: "ABC: все preflop ветки + базовые чарты.",
    lines: ALL_LINES,
  },
];

export function seedPresetLine(
  doc: GameTreeDocument,
  line: PresetLine,
): { doc: GameTreeDocument; tipId: string | null } {
  let current = doc;
  let nodeId = doc.root.id;
  let tipId: string | null = null;

  for (const step of line.actions) {
    const node = findNode(current.root, nodeId);
    if (!node || node.awaitingFlop) break;

    const result = commitWithAutoFolds(
      current,
      nodeId,
      step.seat,
      step.action,
      step.action === "RAISE" ? step.sizingBB : undefined,
    );
    if (!result.childId) break;
    current = result.doc;
    nodeId = result.childId;
    tipId = result.childId;
  }

  // Fold remaining live seats until preflop closes (flop prompt).
  let guard = 0;
  while (guard < 12) {
    const node = findNode(current.root, nodeId);
    if (!node || node.awaitingFlop) break;
    const result = commitWithAutoFolds(
      current,
      nodeId,
      node.activePlayer,
      "FOLD",
    );
    if (!result.childId) break;
    current = result.doc;
    nodeId = result.childId;
    tipId = result.childId;
    guard += 1;
  }

  return { doc: current, tipId };
}

function paintNodeFromCellMatrix(
  ranges: Record<HandCode, HandMix>,
  matrix: ReturnType<typeof matrixFromRanges>,
) {
  for (const [hand, freq] of Object.entries(matrix)) {
    ranges[hand] = {
      RAISE: freq.raise_freq,
      CALL: freq.call_freq,
      FOLD: freq.fold_freq,
    };
  }
}

function cellMatrixToHandMix(
  matrix: ReturnType<typeof matrixFromRanges>,
): Record<string, HandMix> {
  const out: Record<string, HandMix> = {};
  for (const [hand, freq] of Object.entries(matrix)) {
    out[hand] = {
      RAISE: freq.raise_freq,
      CALL: freq.call_freq,
      FOLD: freq.fold_freq,
    };
  }
  return out;
}

/**
 * Full facing chart (fold/call/raise mix) for preview under a raise spot.
 * raiseIndex: 1 = vs open, 2 = vs 3-bet, 3+ = vs 4-bet / jam.
 */
export function buildCallPreviewRanges(
  strategy: StrategyPreset,
  raiseIndex: number,
  callerSeat: Seat,
): { ranges: Record<string, HandMix>; chartLabel: string } | null {
  const pos = toChartPos(callerSeat);
  let spec: RangeBuildSpec | undefined;
  let chartLabel = "";

  if (raiseIndex <= 1) {
    spec = strategy.chart.vs_open?.[pos];
    chartLabel = `vs Open · ${pos}`;
  } else if (raiseIndex === 2) {
    spec = strategy.chart.vs_3bet?.[pos];
    chartLabel = `vs 3-Bet · ${pos}`;
  } else {
    spec = strategy.chart.vs_4bet?.[pos] ?? strategy.chart.vs_3bet?.[pos];
    chartLabel = `vs 4-Bet · ${pos}`;
  }

  if (!spec) return null;
  return {
    ranges: cellMatrixToHandMix(matrixFromRanges(spec)),
    chartLabel,
  };
}

/**
 * Paint full charts along the line (fold + call + raise mix on every spot).
 * RFI / vs Open / vs 3-bet / vs 4-bet — same whether the line took Call or Raise.
 */
export function paintLineCharts(
  doc: GameTreeDocument,
  tipId: string,
  line: PresetLine,
  strategy: StrategyPreset,
): GameTreeDocument {
  const path = pathToNode(doc.root, tipId);
  if (!path) return doc;

  const actors = actorsAlongPath(path);
  const openPos = toChartPos(line.opener);
  const villPos = toChartPos(line.villain);

  const rfi = strategy.chart.rfi?.[openPos];
  const vsOpen = strategy.chart.vs_open?.[villPos];
  const vs3 = strategy.chart.vs_3bet?.[openPos];
  const vs4Villain = strategy.chart.vs_4bet?.[villPos];
  const vs4Opener = strategy.chart.vs_4bet?.[openPos];

  /** One full chart per decision node (last write wins, same full mix). */
  const jobs = new Map<string, RangeBuildSpec>();

  let raiseIndex = 0;
  for (let i = 0; i < actors.length; i += 1) {
    const step = actors[i];
    const nodeId = path[i].id;

    if (step.action === "RAISE") {
      raiseIndex += 1;

      if (raiseIndex === 1 && step.player === line.opener && rfi) {
        jobs.set(nodeId, rfi);
      } else if (raiseIndex === 2 && step.player === line.villain && vsOpen) {
        jobs.set(nodeId, vsOpen);
      } else if (raiseIndex === 3 && step.player === line.opener && vs3) {
        jobs.set(nodeId, vs3);
      } else if (raiseIndex >= 4 && vs4Opener) {
        jobs.set(nodeId, vs4Opener);
      }
    }

    if (step.action === "CALL") {
      if (line.kind === "srp" && step.player === line.villain && vsOpen) {
        jobs.set(nodeId, vsOpen);
      } else if (line.kind === "3bp" && step.player === line.opener && vs3) {
        jobs.set(nodeId, vs3);
      } else if (line.kind === "4bp" && step.player === line.villain) {
        const callSpec = vs4Villain ?? vs3;
        if (callSpec) jobs.set(nodeId, callSpec);
      }
    }
  }

  return produce(doc, (draft) => {
    for (const [nodeId, spec] of jobs) {
      const node = findNode(draft.root, nodeId);
      // Never overwrite a chart the user (or a prior fill) already painted.
      if (node && !nodeHasPaintedRange(node)) {
        paintNodeFromCellMatrix(node.ranges, matrixFromRanges(spec));
      }
    }
    draft.updatedAt = new Date().toISOString();
  });
}

export function applyStylePreset(
  doc: GameTreeDocument,
  preset: StylePreset,
): { doc: GameTreeDocument; created: number; total: number } {
  const strategy = strategyForStyle(preset.strategyId);
  const before = collectBranches(doc.root).length;
  let current = doc;

  for (const line of preset.lines) {
    const seeded = seedPresetLine(current, line);
    current = seeded.doc;
    if (seeded.tipId && strategy) {
      current = paintLineCharts(current, seeded.tipId, line, strategy);
    }
  }

  const after = collectBranches(current.root).length;
  return {
    doc: current,
    created: Math.max(0, after - before),
    total: preset.lines.length,
  };
}

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.id === id);
}
