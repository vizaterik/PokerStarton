/**
 * Session branches (from local HH) missing from constructor paint.
 * Compare by the same matchup labels as BranchPanel (`UTGvsBB`, `HJ`…).
 */
import type { EnsuredSpotInfo, StrategySpot } from "../api/client";
import { listSpots } from "../api/client";
import { spotPotKind, treeMatchupLabel } from "../lib/branchLabel";
import { collectEditorBranches, type SavedBranch } from "../lib/gameTree/branches";
import {
  loadBranchPaintMatrix,
  resolveConstructorTree,
} from "../lib/gameTree/syncTreeCharts";
import {
  normalizeChartPos,
  normalizeMatchupTag,
  potLookupKinds,
  reverseMatchupTag,
  type SpotLike,
} from "../lib/spotCoverage";
import { handToSessionSpot } from "./handSpot";
import { listHandsForStrategy } from "./localDb";

/** Constructor-style display: MP → HJ (same as seatLabel in the tree). */
function displayMatchup(
  spotKey: string,
  hero: string,
  villain: string | null,
): string {
  return treeMatchupLabel(spotKey, hero, villain).replace(/\bMP\b/g, "HJ");
}

/** All distinct HH matchup tags in local session, with hand counts / P/L. */
export async function listSessionBranches(
  strategyId: string,
): Promise<EnsuredSpotInfo[]> {
  const hands = await listHandsForStrategy(strategyId);
  // Key by pot+matchup so Raise UTGvsBB and 3-bet UTGvsBB stay separate.
  const acc = new Map<
    string,
    EnsuredSpotInfo & { _hands: number; _pm: number; _pb: number }
  >();

  for (const h of hands) {
    // Re-resolve from actions so limp/BB-check/multiway aren't lost on old imports.
    const spot = handToSessionSpot(h);
    if (!spot) continue;
    const mu = normalizeMatchupTag(
      treeMatchupLabel(
        spot.spot_key,
        spot.hero_position,
        spot.villain_position,
      ),
    );
    if (!mu || mu === "—") continue;
    const pot = spotPotKind(spot.spot_key);
    const accKey = `${pot}|${mu}`;
    let row = acc.get(accKey);
    if (!row) {
      row = {
        spot_key: spot.spot_key,
        hero_position: spot.hero_position,
        villain_position: spot.villain_position ?? null,
        label: displayMatchup(
          spot.spot_key,
          spot.hero_position,
          spot.villain_position ?? null,
        ),
        hands_count: 0,
        profit_money: 0,
        profit_bb: 0,
        _hands: 0,
        _pm: 0,
        _pb: 0,
      };
      acc.set(accKey, row);
    }
    row._hands += 1;
    row._pm += h.hero_net ?? 0;
    row._pb += h.hero_net_bb ?? 0;
    // Prefer a facing spot_key when merging into the same matchup tag.
    if (spot.villain_position && !row.villain_position) {
      row.spot_key = spot.spot_key;
      row.hero_position = spot.hero_position;
      row.villain_position = spot.villain_position;
      row.label = displayMatchup(
        spot.spot_key,
        spot.hero_position,
        spot.villain_position ?? null,
      );
    }
  }

  return [...acc.values()]
    .map((r) => ({
      spot_key: r.spot_key,
      hero_position: r.hero_position,
      villain_position: r.villain_position,
      label: r.label,
      hands_count: r._hands,
      profit_money: Math.round(r._pm * 100) / 100,
      profit_bb: Math.round(r._pb * 100) / 100,
    }))
    .sort(
      (a, b) =>
        (a.profit_money ?? 0) - (b.profit_money ?? 0) ||
        (b.hands_count ?? 0) - (a.hands_count ?? 0),
    );
}

/**
 * Covered only when constructor has real paint for this pot|matchup
 * (or reverse seat-pair label). Orphan DB spots without paint do NOT cover —
 * empty constructor must list every session branch with «+».
 */
function isCovered(
  strategyId: string,
  spot: SpotLike,
  branches: SavedBranch[],
  _charts: StrategySpot[],
): boolean {
  const pot = spotPotKind(spot.spot_key);
  const hero = normalizeChartPos(spot.hero_position);
  const villain = spot.villain_position
    ? normalizeChartPos(spot.villain_position)
    : null;
  const mu = normalizeMatchupTag(
    treeMatchupLabel(spot.spot_key, hero, villain),
  );
  if (!mu || mu === "—") return false;
  const rev = reverseMatchupTag(mu);

  if (loadBranchPaintMatrix(strategyId, pot, mu)) return true;
  if (rev && loadBranchPaintMatrix(strategyId, pot, rev)) return true;

  for (const b of branches) {
    if (b.paintedCount <= 0) continue;
    if (!potLookupKinds(pot).includes(b.potKind) && b.potKind !== pot) continue;
    const bMu = normalizeMatchupTag(b.label);
    if (bMu === mu || (rev != null && bMu === rev)) return true;
  }

  return false;
}

/**
 * HH tags that do not have constructor paint yet.
 * Pass `branches` from the live editor when available so we never disagree with the UI.
 */
export async function listMissingSpotsLocal(
  strategyId: string,
  branchesOverride?: SavedBranch[],
): Promise<EnsuredSpotInfo[]> {
  const session = await listSessionBranches(strategyId);

  let branches = branchesOverride;
  if (!branches) {
    branches = collectEditorBranches(
      (await resolveConstructorTree(strategyId)).root,
    );
  }

  let charts: StrategySpot[] = [];
  try {
    charts = await listSpots(strategyId);
  } catch {
    charts = [];
  }

  const anyPaint = branches.some((b) => b.paintedCount > 0);
  // Empty constructor (no paint) → every session matchup is addable.
  if (!anyPaint) return session;

  return session.filter((s) => {
    const spot: SpotLike = {
      spot_key: s.spot_key,
      hero_position: s.hero_position,
      villain_position: s.villain_position,
    };
    return !isCovered(strategyId, spot, branches!, charts);
  });
}
