import type { StrategySpot } from "../api/client";
import type { CellFreq } from "./handMatrix";

/** Mirror backend strategy_match._POS_ALIASES */
const POS_ALIASES: Record<string, string[]> = {
  UTG: ["UTG"],
  "UTG+1": ["UTG1", "UTG+1", "MP"],
  UTG1: ["UTG1", "UTG+1", "MP"],
  "UTG+2": ["UTG2", "UTG+2", "MP1", "MP"],
  UTG2: ["UTG2", "UTG+2", "MP1", "MP"],
  MP: ["MP", "HJ", "UTG1"],
  MP1: ["MP1", "MP", "HJ"],
  HJ: ["HJ", "MP"],
  CO: ["CO"],
  BTN: ["BTN"],
  SB: ["SB"],
  BB: ["BB"],
};

/** Mirror backend strategy_match._SPOT_FALLBACKS */
const SPOT_FALLBACKS: Record<string, string[]> = {
  iso: ["rfi"],
  squeeze: ["vs_open"],
  vs_3bet: ["vs_open"],
  vs_4bet: ["vs_3bet", "vs_open"],
};

function posCandidates(position: string | null | undefined): string[] {
  if (!position) return [];
  const key = position.trim().toUpperCase();
  return POS_ALIASES[key] ?? [key];
}

function findSpot(
  spots: StrategySpot[],
  spotKey: string,
  heroPos: string,
  villainPos: string | null | undefined,
): StrategySpot | null {
  const villains = villainPos ? posCandidates(villainPos) : [null];
  for (const hero of posCandidates(heroPos)) {
    if (villainPos) {
      for (const v of villains) {
        const exact = spots.find(
          (s) =>
            s.spot_key === spotKey &&
            s.hero_position.toUpperCase() === hero &&
            (s.villain_position ?? "").toUpperCase() === (v ?? ""),
        );
        if (exact) return exact;
      }
    }
    const generic = spots.find(
      (s) =>
        s.spot_key === spotKey &&
        s.hero_position.toUpperCase() === hero &&
        (s.villain_position ?? null) == null,
    );
    if (generic) return generic;
  }
  return null;
}

export function isChartPainted(cells: Record<string, CellFreq>): boolean {
  // Match backend strategy_match: any raise/call > 0 counts as painted
  return Object.values(cells).some((c) => c.raise_freq > 0 || c.call_freq > 0);
}

/**
 * Resolve strategy spot like the backend: position aliases, villain→generic,
 * then parent spots (iso→rfi, squeeze→vs_open, …).
 */
export function resolveStrategySpot(
  spots: StrategySpot[],
  spotKey: string,
  heroPos: string,
  villainPos: string | null | undefined,
): StrategySpot | null {
  const keys = [spotKey, ...(SPOT_FALLBACKS[spotKey] ?? [])];
  for (const key of keys) {
    const hit = findSpot(spots, key, heroPos, villainPos);
    if (hit) return hit;
    if (villainPos) {
      const generic = findSpot(spots, key, heroPos, null);
      if (generic) return generic;
    }
  }
  return null;
}

/**
 * Ordered candidates to try when loading cells (skip empty / unpainted charts).
 */
export function strategySpotCandidates(
  spots: StrategySpot[],
  spotKey: string,
  heroPos: string,
  villainPos: string | null | undefined,
): StrategySpot[] {
  const keys = [spotKey, ...(SPOT_FALLBACKS[spotKey] ?? [])];
  const out: StrategySpot[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const ordered: Array<string | null | undefined> = villainPos
      ? [villainPos, null]
      : [null];
    for (const v of ordered) {
      const hit = findSpot(spots, key, heroPos, v);
      if (hit && !seen.has(hit.id)) {
        seen.add(hit.id);
        out.push(hit);
      }
    }
  }
  return out;
}
