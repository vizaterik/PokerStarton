/**
 * Action colors by strength (MMO-style tiers), not a free palette.
 * Fold (weak) → Call → Raise/Open → 3-bet → 4-bet+ (strong).
 */

import type { SpotContext } from "./types";
import { nextRaiseLabel, type RaiseLabel } from "./raiseLabels";

export const PAINT_FOLD = "#2563eb";
export const PAINT_CALL = "#22c55e";
export const PAINT_RAISE = "#ef4444";
export const PAINT_3BET = "#a855f7";
export const PAINT_4BET = "#eab308";

export type RaisePaintTier = "open" | "3bet" | "4bet";

export function raiseTierFromLabel(label: RaiseLabel): RaisePaintTier {
  if (label === "3-BET" || label === "SQUEEZE") return "3bet";
  if (label === "4-BET" || label === "ALL-IN") return "4bet";
  return "open";
}

/** Color for the RAISE brush / RAISE band at this decision node. */
export function raiseColorForContext(ctx: SpotContext): string {
  return raiseColorForTier(raiseTierFromLabel(nextRaiseLabel(ctx.raiseCount, ctx.callersAfterRaise)));
}

export function raiseColorForTier(tier: RaisePaintTier): string {
  if (tier === "3bet") return PAINT_3BET;
  if (tier === "4bet") return PAINT_4BET;
  return PAINT_RAISE;
}

export function raiseBrushLabel(
  ctx: SpotContext,
  actionMode: "standard" | "push_fold" = "standard",
): string {
  if (actionMode === "push_fold") return "ALL-IN";
  const label = nextRaiseLabel(ctx.raiseCount, ctx.callersAfterRaise);
  if (label === "RAISE") return "OPEN";
  return label;
}

export function raiseTierForContext(ctx: SpotContext): RaisePaintTier {
  return raiseTierFromLabel(nextRaiseLabel(ctx.raiseCount, ctx.callersAfterRaise));
}
