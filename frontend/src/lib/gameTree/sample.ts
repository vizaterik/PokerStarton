/**
 * Sample initial state for the GTO-style preflop tree.
 * Matches the recursive GameTreeNode architecture.
 */
import { createDocument } from "./engine";
import type { GameTreeDocument } from "./types";

export const SAMPLE_TREE: GameTreeDocument = createDocument("sample-strategy", 6, 100);

export type {
  GameTreeNode,
  GameTreeDocument,
  HandMix,
  Seat,
  TreeAction,
  Street,
} from "./types";
