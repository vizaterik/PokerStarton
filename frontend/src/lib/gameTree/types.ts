import type { HandCode } from "../handMatrix";

export type Street = "preflop" | "flop" | "turn" | "river";
export type TableSize = 2 | 3 | 6 | 8 | 9;
/** Effective stack in bb (module presets: 10…200). */
export type StackDepth = number;

/** 6-max GTO Wizard order uses HJ (not MP). */
export type Seat6 = "UTG" | "HJ" | "CO" | "BTN" | "SB" | "BB";
export type Seat8 = "UTG" | "UTG1" | "MP" | "HJ" | "CO" | "BTN" | "SB" | "BB";
export type Seat9 = "UTG" | "UTG1" | "MP" | "MP1" | "HJ" | "CO" | "BTN" | "SB" | "BB";
export type Seat3 = "BTN" | "SB" | "BB";
export type Seat2 = "BTN" | "BB";
export type Seat = Seat6 | Seat8 | Seat9 | Seat3 | Seat2 | "MP"; // MP kept for legacy trees

export type TreeAction = "ROOT" | "FOLD" | "CALL" | "RAISE" | "CHECK";

export type HandMix = {
  FOLD: number;
  CALL: number;
  RAISE: number;
};

export type GameTreeNode = {
  id: string;
  street: Street;
  activePlayer: Seat;
  /** Action from parent that created this decision node */
  actionTaken: TreeAction;
  sizingBB?: number;
  /** Strategy for the active player at this node (sums to 1 per hand) */
  ranges: Record<HandCode, HandMix>;
  children: GameTreeNode[];
  /** Set when this node is the flop prompt after preflop closes */
  awaitingFlop?: boolean;
  /**
   * True when this edge was created by skip-ahead auto-fold
   * (user acted from a later seat without manually folding earlier ones).
   */
  autoFold?: boolean;
};

export type GameTreeDocument = {
  version: 1;
  strategyId: string;
  tableSize: TableSize;
  stackDepth: StackDepth;
  root: GameTreeNode;
  updatedAt: string;
  /** Last applied style preset id (TAG / LAG / …), if any. */
  stylePresetId?: string | null;
};

export type PaintAction = "FOLD" | "CALL" | "RAISE";

export type PathStep = {
  nodeId: string;
  label: string;
  kind: "meta" | "action" | "current";
};

export type PotType = "unopened" | "facing_limp" | "facing_raise";

export type SpotContext = {
  potType: PotType;
  raiseCount: number;
  lastRaiseSize: number | null;
  lastAggressor: Seat | null;
  folded: Seat[];
  limpCount: number;
  /** Коллы после последнего рейза (open + call → squeeze). */
  callersAfterRaise: number;
};

export type DecisionButton = {
  action: "FOLD" | "CALL" | "RAISE";
  label: string;
  sublabel?: string;
  defaultSizing?: number;
  tone: "fold" | "call" | "raise";
};
