/**
 * Action colors by strength (MMO-style tiers), not a free palette.
 * Fold (blue) → Call (green) → Raise/Open (red) → 3-bet (purple) → 4-bet (gold).
 */

import { raiseLabelAtIndex, nextRaiseLabel, type RaiseLabel } from "./raiseLabels";
import { deriveContext } from "./turnEngine";
import type { GameTreeNode, SpotContext } from "./types";

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
  return raiseColorForTier(
    raiseTierFromLabel(nextRaiseLabel(ctx.raiseCount, ctx.callersAfterRaise)),
  );
}

export function raiseColorForTier(tier: RaisePaintTier): string {
  if (tier === "3bet") return PAINT_3BET;
  if (tier === "4bet") return PAINT_4BET;
  return PAINT_RAISE;
}

/**
 * Tier for painting a decision node on a line.
 * If that seat already raised on the line → color of THAT raise (open/3bet/4bet).
 * Otherwise → color of the next raise available at this decision.
 */
export function raiseTierForPaintNode(
  linePath: GameTreeNode[],
  paintNodeId: string,
): RaisePaintTier {
  const idx = linePath.findIndex((n) => n.id === paintNodeId);
  if (idx >= 0 && idx < linePath.length - 1) {
    const child = linePath[idx + 1];
    if (child?.actionTaken === "RAISE") {
      let raiseIndex = 0;
      let callersSince = 0;
      for (let i = 0; i < idx; i += 1) {
        const c = linePath[i + 1];
        if (!c) continue;
        if (c.actionTaken === "RAISE") {
          raiseIndex += 1;
          callersSince = 0;
        } else if (c.actionTaken === "CALL" && raiseIndex > 0) {
          callersSince += 1;
        }
      }
      raiseIndex += 1;
      const wasSqueeze = raiseIndex === 2 && callersSince >= 1;
      return raiseTierFromLabel(raiseLabelAtIndex(raiseIndex, wasSqueeze));
    }
  }
  if (idx >= 0) {
    return raiseTierForContext(deriveContext(linePath.slice(0, idx + 1)));
  }
  return "open";
}

export function raiseBrushLabel(
  ctx: SpotContext,
  actionMode: "standard" | "push_fold" = "standard",
): string {
  if (actionMode === "push_fold") return "All-in";
  const label = nextRaiseLabel(ctx.raiseCount, ctx.callersAfterRaise);
  if (label === "RAISE") return "Raise";
  if (label === "3-BET") return "3-bet";
  if (label === "SQUEEZE") return "Squeeze";
  if (label === "4-BET") return "4-bet";
  return "All-in";
}

export function raiseBrushLabelFromTier(tier: RaisePaintTier): string {
  if (tier === "3bet") return "3-bet";
  if (tier === "4bet") return "4-bet";
  return "Raise";
}

export function raiseTierForContext(ctx: SpotContext): RaisePaintTier {
  return raiseTierFromLabel(
    nextRaiseLabel(ctx.raiseCount, ctx.callersAfterRaise),
  );
}

/** Analysis / strategy chart spot_key → raise color tier. */
export function raiseTierFromSpotKey(
  spotKey: string | null | undefined,
): RaisePaintTier {
  const k = (spotKey || "").toLowerCase();
  if (
    k.includes("4bet") ||
    k.includes("4_bet") ||
    k.includes("allin") ||
    k.includes("all_in")
  ) {
    return "4bet";
  }
  if (
    k.includes("3bet") ||
    k.includes("3_bet") ||
    k.includes("squeeze") ||
    k === "vs_3bet"
  ) {
    return "3bet";
  }
  return "open";
}

export function raiseLegendLabel(tier: RaisePaintTier): string {
  if (tier === "3bet") return "3-bet";
  if (tier === "4bet") return "4-bet";
  return "Raise";
}

/** Quick mix presets: raise% / call% (fold = rest). */
export const MIX_PRESETS: { id: string; raise: number; call: number; short: string }[] =
  [
    { id: "r100", raise: 100, call: 0, short: "100" },
    { id: "r80c20", raise: 80, call: 20, short: "80/20" },
    { id: "r75c25", raise: 75, call: 25, short: "75/25" },
    { id: "r60c40", raise: 60, call: 40, short: "60/40" },
    { id: "r50c50", raise: 50, call: 50, short: "50/50" },
    { id: "r40c60", raise: 40, call: 60, short: "40/60" },
    { id: "r25c75", raise: 25, call: 75, short: "25/75" },
    { id: "r20c80", raise: 20, call: 80, short: "20/80" },
    { id: "c100", raise: 0, call: 100, short: "Call" },
  ];
