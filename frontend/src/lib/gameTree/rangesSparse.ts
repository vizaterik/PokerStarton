/**
 * Sparse hand ranges: omit pure-fold hands to keep trees small in memory/storage.
 */
import type { HandCode } from "../handMatrix";
import type { GameTreeNode, HandMix } from "./types";

export const PURE_FOLD: HandMix = { FOLD: 1, CALL: 0, RAISE: 0 };

export function isPureFold(mix: HandMix | undefined): boolean {
  if (!mix) return true;
  return (mix.CALL ?? 0) < 0.02 && (mix.RAISE ?? 0) < 0.02;
}

export function handMix(
  ranges: Record<string, HandMix>,
  hand: string,
): HandMix {
  return ranges[hand] ?? PURE_FOLD;
}

/** Drop pure-fold entries; keep only painted / partial hands. */
export function compactRanges(
  ranges: Record<string, HandMix>,
): Record<string, HandMix> {
  const out: Record<string, HandMix> = {};
  for (const [hand, mix] of Object.entries(ranges)) {
    if (!isPureFold(mix)) out[hand] = mix;
  }
  return out;
}

export function compactNodeRanges(node: GameTreeNode): void {
  node.ranges = compactRanges(node.ranges) as Record<HandCode, HandMix>;
  for (const ch of node.children) compactNodeRanges(ch);
}

/** In-place compact of a document clone / draft before serialize. */
export function compactDocumentTree(root: GameTreeNode): void {
  compactNodeRanges(root);
}
