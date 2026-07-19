/** Constructor-style tags: pot tag + matchup `Raise UTGvsBB`. */

const ACTION: Record<string, string> = {
  rfi: "RFI",
  iso: "ISO",
  vs_open: "vs Open",
  vs_3bet: "vs 3-Bet",
  vs_4bet: "vs 4-Bet",
  squeeze: "Squeeze",
};

/** Pot-style tag aligned with constructor filters. */
export type SpotPotKind = "limp" | "srp" | "3bp" | "4bp" | "allin";

export function spotActionLabel(spotKey: string): string {
  const key = spotKey.trim().toLowerCase();
  return ACTION[key] ?? (key.replace(/_/g, " ") || "spot");
}

/** Map HH spot → pot tag: Raise / 3-bet / 4-bet. */
export function spotPotKind(spotKey: string): SpotPotKind {
  const key = spotKey.trim().toLowerCase();
  if (key === "vs_3bet" || key === "squeeze") return "3bp";
  if (key === "vs_4bet") return "4bp";
  return "srp";
}

export function spotPotTag(spotKey: string): string {
  const kind = spotPotKind(spotKey);
  if (kind === "3bp") return "3-bet";
  if (kind === "4bp") return "4-bet";
  if (kind === "allin") return "All-in";
  if (kind === "limp") return "Limp";
  return "Raise";
}

/**
 * Tree / constructor matchup: raiser vs caller for facing pots (`UTGvsBB`),
 * hero seat alone for opens (`UTG`).
 */
export function treeMatchupLabel(
  spotKey: string,
  hero?: string | null,
  villain?: string | null,
): string {
  const h = (hero ?? "").trim().toUpperCase();
  const v = (villain ?? "").trim().toUpperCase();
  const key = (spotKey || "").trim().toLowerCase();
  if (key === "rfi" || key === "iso" || !v || v === h) return h || "—";
  if (key === "vs_open" || key === "vs_3bet" || key === "vs_4bet" || key === "squeeze") {
    return `${v}vs${h}`;
  }
  if (h && v) return `${h}vs${v}`;
  return h || "—";
}

/** @deprecated Prefer treeMatchupLabel — kept for call sites that pass hero-vs-villain. */
export function matchupLabel(hero?: string | null, villain?: string | null): string {
  const h = (hero ?? "").trim().toUpperCase();
  const v = (villain ?? "").trim().toUpperCase();
  if (h && v && h !== v) return `${h}vs${v}`;
  if (h) return h;
  return "—";
}

/** Full constructor tag: `Raise UTGvsBB`. */
export function branchTag(
  spotKey: string,
  hero?: string | null,
  villain?: string | null,
): string {
  const pot = spotPotTag(spotKey);
  const matchup = treeMatchupLabel(spotKey, hero, villain);
  if (matchup === "—") return pot;
  return `${pot} ${matchup}`;
}

/** Alias used across Trainer / Errors — same as constructor tag. */
export function shortBranchLabel(
  spotKey: string,
  hero?: string | null,
  villain?: string | null,
): string {
  return branchTag(spotKey, hero, villain);
}
