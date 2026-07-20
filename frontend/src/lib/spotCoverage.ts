/**
 * Whether a session spot is already covered by strategy charts or tree branches.
 * Matchup is directional for roles, but tree labels (raiser vs caller) are often
 * the reverse of session labels (hero vs villain) for the same line.
 */
import type { ChartErrorCell, ChartErrorSpot } from "../api/client";
import type { StrategySpot } from "../api/client";
import { spotPotKind, treeMatchupLabel, type SpotPotKind } from "./branchLabel";
import type { BranchPotKind, SavedBranch } from "./gameTree/branches";

export type SpotLike = {
  spot_key: string;
  hero_position: string;
  villain_position?: string | null;
};

/** Align HH / tree / chart seats (HJ ≡ MP on 6-max). */
export function normalizeChartPos(pos: string): string {
  const p = pos.trim().toUpperCase();
  // 6-max middle seat aliases only — do not collapse UTG+1 into MP.
  if (p === "HJ" || p === "MP1" || p === "MP+1") return "MP";
  if (p === "UTG1" || p === "UTG+1") return "UTG+1";
  if (p === "UTG2" || p === "UTG+2") return "UTG+2";
  return p;
}

/** Constructor matchup tag → canonical form (`HJvsBB` ≡ `MPvsBB`). */
export function normalizeMatchupTag(label: string): string {
  let raw = label.trim().toUpperCase().replace(/\s+/g, "");
  // Strip pot|matchup keys: "SRP|UTGVSBB".
  raw = raw.replace(/^(LIMP|SRP|3BP|4BP|ALLIN|ALL-IN)\|/, "");
  // Strip leading pot words if a full tag slipped in: "RAISE UTGVSBB".
  const stripped = raw.replace(/^(RAISE|3-BET|4-BET|LIMP|ALL-IN|ALLIN)/, "");
  const m = stripped.match(/^([A-Z0-9+]+)VS([A-Z0-9+]+)$/);
  if (!m) return normalizeChartPos(stripped || raw);
  return `${normalizeChartPos(m[1])}vs${normalizeChartPos(m[2])}`;
}

/** Pot aliases (legacy `allin` → 4bp). */
export function potLookupKinds(pot: string): string[] {
  const p = pot.trim().toLowerCase();
  if (p === "limp") return ["limp", "srp"];
  if (p === "allin" || p === "all_in" || p === "4bp") return ["4bp"];
  if (p === "3bp") return ["3bp"];
  return [p];
}

function reverseMatchup(label: string): string | null {
  const n = normalizeMatchupTag(label);
  const m = n.match(/^([A-Z0-9+]+)vs([A-Z0-9+]+)$/);
  if (!m) return null;
  return `${m[2]}vs${m[1]}`;
}

/** Pot+matchup key as shown in the constructor (`srp|UTGvsBB`). */
export function constructorTagKey(
  potKind: BranchPotKind | SpotPotKind,
  matchupLabel: string,
): string {
  return `${potKind}|${normalizeMatchupTag(matchupLabel)}`;
}

/** Session spot → same tag key the constructor uses. */
export function sessionConstructorTag(spot: SpotLike): string {
  const pot = spotPotKind(spot.spot_key);
  const matchup = treeMatchupLabel(
    spot.spot_key,
    normalizeChartPos(spot.hero_position),
    spot.villain_position
      ? normalizeChartPos(spot.villain_position)
      : null,
  );
  return constructorTagKey(pot, matchup);
}

/**
 * True when constructor already has this matchup tag (BranchPanel labels).
 * Compares normalized matchups (`HJvsBB` ≡ `MPvsBB`); pot is secondary.
 * Open `UTG` is covered by constructor `UTG` or any `UTGvs…` line.
 */
export function coveredByConstructorTags(
  spot: SpotLike,
  branches: SavedBranch[],
): boolean {
  if (!branches.length) return false;
  const wantMu = normalizeMatchupTag(
    treeMatchupLabel(
      spot.spot_key,
      normalizeChartPos(spot.hero_position),
      spot.villain_position
        ? normalizeChartPos(spot.villain_position)
        : null,
    ),
  );
  if (!wantMu || wantMu === "—") return false;
  const wantRev = reverseMatchup(wantMu);
  const wantPot = spotPotKind(spot.spot_key);
  const isOpen = !wantMu.includes("vs");

  const constructorMus = new Set<string>();
  for (const b of branches) {
    constructorMus.add(normalizeMatchupTag(b.label));
  }

  // 1) Exact / reversed matchup present in constructor (any pot).
  if (constructorMus.has(wantMu)) return true;
  if (wantRev && constructorMus.has(wantRev)) return true;

  // 2) Open seat covered by facing line with that opener (`UTG` ← `UTGvsBB`).
  if (isOpen) {
    for (const mu of constructorMus) {
      if (mu === wantMu || mu.startsWith(`${wantMu}vs`) || mu.endsWith(`vs${wantMu}`)) {
        return true;
      }
    }
  }

  // 3) Facing line covered by open of the raiser (`UTGvsBB` ← `UTG`).
  if (!isOpen) {
    const raiser = wantMu.split("vs")[0];
    if (raiser && constructorMus.has(raiser)) return true;
  }

  // 4) Per-branch: single-seat tip (`BB`) covers `BBvsUTG`; pot soft-match.
  for (const b of branches) {
    const haveMu = normalizeMatchupTag(b.label);
    if (haveMu === wantMu || (wantRev && haveMu === wantRev)) return true;
    if (!haveMu.includes("vs") && wantMu.startsWith(`${haveMu}vs`)) return true;
    if (
      isOpen &&
      (haveMu === wantMu ||
        haveMu.startsWith(`${wantMu}vs`) ||
        haveMu.endsWith(`vs${wantMu}`)) &&
      (b.potKind === wantPot || b.potKind === "srp" || wantPot === "srp")
    ) {
      return true;
    }
  }
  return false;
}

/** Spot → which tree pot kinds count as the same situation. */
function potsForSpot(spotKey: string, strictPot?: boolean): BranchPotKind[] {
  const kind = spotPotKind(spotKey) as BranchPotKind;
  // Analysis / Errors: keep pots distinct; limp↔iso/srp soft match only.
  if (strictPot) {
    if (kind === "srp") {
      const key = spotKey.trim().toLowerCase();
      // HH limp pots are often tagged iso/vs_open — allow limp branches to cover.
      if (key === "iso" || key === "vs_open") return ["srp", "limp"];
      return ["srp"];
    }
    if (kind === "limp") return ["limp", "srp"];
    if (kind === "3bp") return ["3bp"];
    if (kind === "4bp") return ["4bp"];
    return [kind];
  }
  // Softer set only for missing-spot discovery in the editor.
  if (kind === "3bp") return ["3bp"];
  if (kind === "4bp") return ["4bp"];
  if (kind === "srp") {
    const key = spotKey.trim().toLowerCase();
    if (key === "rfi" || key === "iso") {
      return ["srp", "3bp", "4bp", "limp"];
    }
    return ["srp", "limp"];
  }
  if (kind === "limp") return ["limp", "srp"];
  return [kind];
}

/**
 * Chart covers this session spot when:
 * - exact (spot, hero, villain), or
 * - generic (spot, hero, null) — same hero action chart (BBvsCO covered by vs_3bet BB).
 * Opposite hero (SBvsBB) is NOT covered by BBvsSB chart.
 */
export function spotCoveredByCharts(spot: SpotLike, charts: StrategySpot[]): boolean {
  const key = spot.spot_key.trim().toLowerCase();
  const hero = normalizeChartPos(spot.hero_position);
  const villain = spot.villain_position
    ? normalizeChartPos(spot.villain_position)
    : null;

  return charts.some((s) => {
    if (s.spot_key.trim().toLowerCase() !== key) return false;
    if (normalizeChartPos(s.hero_position) !== hero) return false;
    const sv = s.villain_position ? normalizeChartPos(s.villain_position) : null;
    return sv === villain || sv === null;
  });
}

export type BranchCoverOpts = {
  /**
   * For RFI/ISO: only exact open seat (`UTG`) counts.
   * Default false also treats `UTGvsBB` as covering open UTG (Errors grouping).
   * Missing-spots lists should pass `true` so every HH line not painted shows up.
   */
  strictOpen?: boolean;
  /**
   * Exact pot only (`srp` ≠ `3bp`). Use for analysis / Errors so one matchup
   * tag cannot steal decisions from another pot.
   */
  strictPot?: boolean;
};

/**
 * Tree branch covers session spot when pot tag matches and matchup is the same
 * pair of seats: session `HvsV` matches tree `HvsV` or `VvsH` (raiser vs caller).
 */
export function spotCoveredByBranches(
  spot: SpotLike,
  branches: SavedBranch[],
  opts?: BranchCoverOpts,
): boolean {
  const key = spot.spot_key.trim().toLowerCase();
  const pots = potsForSpot(key, opts?.strictPot === true);
  const hero = normalizeChartPos(spot.hero_position);
  const villain = spot.villain_position
    ? normalizeChartPos(spot.villain_position)
    : null;
  // Same orientation as constructor tags: raiser vs caller (`UTGvsBB`).
  const sessionMu = normalizeMatchupTag(treeMatchupLabel(key, hero, villain));
  const sessionRev = reverseMatchup(sessionMu);
  const strictOpen = opts?.strictOpen === true;

  for (const b of branches) {
    if (!pots.includes(b.potKind)) continue;
    const treeMu = normalizeMatchupTag(b.label);

    if (!villain) {
      // RFI/ISO: exact open seat, optionally any line with that opener.
      if (treeMu === hero) return true;
      if (
        !strictOpen &&
        (treeMu.startsWith(`${hero}vs`) || treeMu.endsWith(`vs${hero}`))
      ) {
        return true;
      }
      continue;
    }

    if (treeMu === sessionMu || (sessionRev && treeMu === sessionRev)) {
      return true;
    }
  }
  return false;
}

export function spotAlreadyCovered(
  spot: SpotLike,
  charts: StrategySpot[],
  branches: SavedBranch[],
): boolean {
  return spotCoveredByCharts(spot, charts) || spotCoveredByBranches(spot, branches);
}

/** One Errors-sidebar row = one constructor branch (not every DB spot). */
export type BranchChartGroup = {
  matchup: string;
  potKind: BranchPotKind;
  /** Primary chart for matrix / cell loading. */
  primary: ChartErrorSpot;
  charts: ChartErrorSpot[];
  cells: ChartErrorCell[];
};

function mergeErrorCells(charts: ChartErrorSpot[]): ChartErrorCell[] {
  const map = new Map<string, ChartErrorCell>();
  for (const c of charts) {
    for (const cell of c.cells) {
      const prev = map.get(cell.hand_code);
      if (!prev) {
        map.set(cell.hand_code, {
          ...cell,
          hand_ids: cell.hand_ids ? [...cell.hand_ids] : undefined,
        });
        continue;
      }
      prev.errors += cell.errors;
      prev.raise_count = (prev.raise_count ?? 0) + (cell.raise_count ?? 0);
      prev.call_count = (prev.call_count ?? 0) + (cell.call_count ?? 0);
      prev.fold_count = (prev.fold_count ?? 0) + (cell.fold_count ?? 0);
      if (cell.hand_ids?.length) {
        const ids = new Set([...(prev.hand_ids ?? []), ...cell.hand_ids]);
        prev.hand_ids = [...ids];
      }
    }
  }
  return [...map.values()].sort((a, b) => b.errors - a.errors);
}

/**
 * Collapse DB spot charts (RFI UTG + vs_open BB…) into constructor matchups
 * (`UTGvsBB`). Orphan spots not in the tree are dropped.
 */
export function groupChartErrorsByTreeBranches(
  charts: ChartErrorSpot[],
  branches: SavedBranch[],
  opts?: BranchCoverOpts,
): BranchChartGroup[] {
  // Analysis default: never let Raise claim 3-bet errors (or reverse).
  const coverOpts: BranchCoverOpts = {
    strictOpen: true,
    strictPot: true,
    ...opts,
  };
  const painted = branches.filter((b) => b.paintedCount > 0);
  if (!painted.length) {
    // No painted constructor branches — nothing to group (strict mode).
    return [];
  }

  // Prefer facing pots in natural order so soft leftovers cannot race.
  const potOrder = ["limp", "srp", "3bp", "4bp"] as const;
  const ordered = [...painted].sort((a, b) => {
    const ia = potOrder.indexOf(a.potKind as (typeof potOrder)[number]);
    const ib = potOrder.indexOf(b.potKind as (typeof potOrder)[number]);
    if (ia !== ib) return ia - ib;
    return a.label.localeCompare(b.label, "ru");
  });

  const groups: BranchChartGroup[] = [];
  const used = new Set<string>();
  for (const b of ordered) {
    const related = charts.filter((c) => {
      const key = `${c.spot_key}|${c.hero_position}|${c.villain_position ?? ""}`;
      if (used.has(key)) return false;
      // Never map vs_open (srp) into 3bp.
      const pots = potsForSpot(c.spot_key, true);
      if (!pots.includes(b.potKind)) return false;
      return spotCoveredByBranches(
        {
          spot_key: c.spot_key,
          hero_position: c.hero_position,
          villain_position: c.villain_position,
        },
        [b],
        coverOpts,
      );
    });
    if (!related.length) continue;
    for (const c of related) {
      used.add(`${c.spot_key}|${c.hero_position}|${c.villain_position ?? ""}`);
    }
    // Prefer facing chart (has villain) for the strategy matrix; keep its spot_id.
    const primary =
      related.find((c) => c.villain_position) ||
      related.find((c) => c.spot_key !== "rfi") ||
      related[0];
    groups.push({
      matchup: b.label,
      potKind: b.potKind,
      primary: {
        ...primary,
        label: b.label,
        pot_kind: b.potKind,
        cells: mergeErrorCells(related),
      },
      charts: related,
      cells: mergeErrorCells(related),
    });
  }
  return groups;
}

export type { SpotPotKind };
