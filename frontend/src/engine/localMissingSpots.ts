/**
 * Session branches (from local HH) missing from constructor tags.
 * Compare by the same matchup labels as BranchPanel (`UTGvsBB`, `HJ`…).
 */
import type { EnsuredSpotInfo, StrategySpot } from "../api/client";
import { listSpots } from "../api/client";
import { treeMatchupLabel } from "../lib/branchLabel";
import { collectEditorBranches, type SavedBranch } from "../lib/gameTree/branches";
import { resolveConstructorTree } from "../lib/gameTree/syncTreeCharts";
import {
  coveredByConstructorTags,
  normalizeChartPos,
  normalizeMatchupTag,
  spotCoveredByCharts,
  type SpotLike,
} from "../lib/spotCoverage";
import { listHandsForStrategy, type HandRow } from "./localDb";

const KNOWN = new Set(["rfi", "vs_open", "vs_3bet", "vs_4bet", "squeeze", "iso"]);

/** Constructor-style display: MP → HJ (same as seatLabel in the tree). */
function displayMatchup(
  spotKey: string,
  hero: string,
  villain: string | null,
): string {
  return treeMatchupLabel(spotKey, hero, villain).replace(/\bMP\b/g, "HJ");
}

function neededKey(hand: HandRow): SpotLike | null {
  const spot_key = (hand.detected_spot || "").trim().toLowerCase();
  if (!KNOWN.has(spot_key) || !hand.hero_position) return null;
  const hero = normalizeChartPos(hand.hero_position);
  let villain = hand.villain_position
    ? normalizeChartPos(hand.villain_position)
    : null;
  if (spot_key === "rfi" || spot_key === "iso") villain = null;
  if (villain && villain === hero) villain = null;
  return { spot_key, hero_position: hero, villain_position: villain };
}

/** All distinct HH matchup tags in local session, with hand counts / P/L. */
export async function listSessionBranches(
  strategyId: string,
): Promise<EnsuredSpotInfo[]> {
  const hands = await listHandsForStrategy(strategyId);
  // Key by matchup (not pot) so vs_open / vs_3bet with the same seats collapse.
  const acc = new Map<
    string,
    EnsuredSpotInfo & { _hands: number; _pm: number; _pb: number }
  >();

  for (const h of hands) {
    const spot = neededKey(h);
    if (!spot) continue;
    const mu = normalizeMatchupTag(
      treeMatchupLabel(
        spot.spot_key,
        spot.hero_position,
        spot.villain_position,
      ),
    );
    if (!mu || mu === "—") continue;
    let row = acc.get(mu);
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
      acc.set(mu, row);
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

function isCovered(
  spot: SpotLike,
  branches: SavedBranch[],
  charts: StrategySpot[],
): boolean {
  if (branches.length && coveredByConstructorTags(spot, branches)) return true;
  if (charts.length && spotCoveredByCharts(spot, charts)) return true;
  return false;
}

/**
 * HH tags that do not appear among constructor branch matchup labels / DB charts.
 * Pass `branches` from the live editor when available so we never disagree with the UI.
 */
export async function listMissingSpotsLocal(
  strategyId: string,
  branchesOverride?: SavedBranch[],
): Promise<EnsuredSpotInfo[]> {
  const session = await listSessionBranches(strategyId);

  let branches = branchesOverride;
  if (!branches) {
    // Hydrate from server first — empty localStorage must not list every HH tag as missing.
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

  // No constructor signal at all → every session matchup is missing.
  if (!branches.length && !charts.length) return session;

  return session.filter((s) => {
    const spot: SpotLike = {
      spot_key: s.spot_key,
      hero_position: s.hero_position,
      villain_position: s.villain_position,
    };
    return !isCovered(spot, branches!, charts);
  });
}
