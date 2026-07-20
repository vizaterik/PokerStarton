/**
 * Push painted tree ranges into strategy DB spots so Trainer / Preflop analysis
 * see the same charts as the GTO editor.
 *
 * Tree is source of truth: spots not painted in the constructor are deleted so
 * analysis never scores against leftover / preset / orphan branches.
 */
import {
  createSpot,
  deleteSpot,
  getStrategyTree,
  listSpots,
  upsertCells,
} from "../../api/client";
import { markAnalysisChartsStale } from "../analysisCache";
import { setChartsRevision } from "../chartsRevision";
import { branchTag } from "../branchLabel";
import type { CellFreq, HandCode } from "../handMatrix";
import { matrixToPayload } from "../rangeNotation";
import type { Position, SpotKey } from "../../types/strategy";
import { toChartPos } from "./branchPresets";
import {
  collectAnalysisBranches,
  collectEditorBranches,
  type BranchPotKind,
} from "./branches";
import { findNode, pathToNode } from "./engine";
import { loadTree, normalizeTree, saveTree } from "./persist";
import { deriveContext } from "./turnEngine";
import type { GameTreeDocument, GameTreeNode, HandMix } from "./types";
import { normalizeMatchupTag } from "../spotCoverage";

/** Prefer richer trees: branch count first, then painted chart jobs. */
function treeRichness(doc: GameTreeDocument): number {
  const branches = collectEditorBranches(doc.root).length;
  const jobs = collectJobs(doc.root).length;
  return branches * 1000 + jobs;
}

function mixToCell(mix: HandMix): CellFreq {
  const r = mix.RAISE ?? 0;
  const c = mix.CALL ?? 0;
  const f = mix.FOLD ?? 0;
  const sum = r + c + f;
  if (sum <= 0) return { raise_freq: 0, call_freq: 0, fold_freq: 1 };
  return {
    raise_freq: r / sum,
    call_freq: c / sum,
    fold_freq: f / sum,
  };
}

function rangesToMatrix(ranges: Record<string, HandMix>): Record<HandCode, CellFreq> {
  const out: Record<HandCode, CellFreq> = {};
  for (const [hand, mix] of Object.entries(ranges)) {
    out[hand as HandCode] = mixToCell(mix);
  }
  return out;
}

function isPainted(matrix: Record<string, CellFreq>): boolean {
  return Object.values(matrix).some((c) => c.raise_freq > 0.02 || c.call_freq > 0.02);
}

function spotKeyForContext(ctx: ReturnType<typeof deriveContext>): SpotKey | null {
  if (ctx.raiseCount === 0 && ctx.limpCount === 0) return "rfi";
  if (ctx.raiseCount === 0 && ctx.limpCount > 0) return "iso";
  if (ctx.raiseCount === 1) {
    return ctx.callersAfterRaise >= 1 ? "squeeze" : "vs_open";
  }
  if (ctx.raiseCount === 2) return "vs_3bet";
  if (ctx.raiseCount >= 3) return "vs_4bet";
  return null;
}

type ChartJob = {
  spotKey: SpotKey;
  hero: Position;
  /** Last aggressor for facing pots — keeps UTGvsBB separate from COvsBB. */
  villain: Position | null;
  matrix: Record<HandCode, CellFreq>;
};

function collectJobs(root: GameTreeNode): ChartJob[] {
  const best = new Map<string, ChartJob>();

  function visit(node: GameTreeNode) {
    if (node.street !== "preflop" || node.awaitingFlop) {
      for (const ch of node.children) visit(ch);
      return;
    }
    const path = pathToNode(root, node.id);
    if (!path) {
      for (const ch of node.children) visit(ch);
      return;
    }
    const ctx = deriveContext(path);
    const spotKey = spotKeyForContext(ctx);
    if (spotKey) {
      const matrix = rangesToMatrix(node.ranges);
      if (isPainted(matrix)) {
        const hero = toChartPos(node.activePlayer);
        const villain =
          spotKey !== "rfi" && spotKey !== "iso" && ctx.lastAggressor
            ? toChartPos(ctx.lastAggressor)
            : null;
        const key = `${spotKey}|${hero}|${villain ?? ""}`;
        const play = Object.values(matrix).reduce(
          (n, c) => n + c.raise_freq + c.call_freq,
          0,
        );
        const prev = best.get(key);
        const prevPlay = prev
          ? Object.values(prev.matrix).reduce((n, c) => n + c.raise_freq + c.call_freq, 0)
          : -1;
        if (play >= prevPlay) {
          best.set(key, { spotKey, hero, villain, matrix });
        }
      }
    }
    for (const ch of node.children) visit(ch);
  }

  visit(root);
  return [...best.values()];
}

/** Compact fingerprint so we skip no-op syncs (avoids freezing the tab). */
function jobsFingerprint(jobs: ChartJob[]): string {
  return jobs
    .map((j) => {
      const play = Object.entries(j.matrix)
        .filter(([, c]) => c.raise_freq > 0 || c.call_freq > 0)
        .map(
          ([h, c]) =>
            `${h}:${c.raise_freq.toFixed(2)}/${c.call_freq.toFixed(2)}`,
        )
        .sort()
        .join(",");
      return `${j.spotKey}|${j.hero}|${j.villain ?? ""}|${play}`;
    })
    .sort()
    .join(";");
}

const lastSyncFp = new Map<string, string>();

/**
 * Pick local vs remote constructor tree.
 * Never replace a richer local tree (more branches / paints) with a newer-but-empty remote —
 * that made analysis ask to «add branches» that already exist in the editor.
 */
export async function resolveConstructorTree(
  strategyId: string,
): Promise<GameTreeDocument> {
  let doc = loadTree(strategyId);
  const localScore = treeRichness(doc);
  try {
    const remote = await getStrategyTree(strategyId);
    const remoteDoc = normalizeTree(remote.tree, strategyId);
    if (remoteDoc) {
      const remoteScore = treeRichness(remoteDoc);
      const localEmpty = doc.root.children.length === 0;
      const remoteHasData = remoteDoc.root.children.length > 0;
      const remoteNewer =
        Boolean(remoteDoc.updatedAt) &&
        (!doc.updatedAt || remoteDoc.updatedAt >= doc.updatedAt);
      if (remoteScore > localScore) {
        doc = remoteDoc;
      } else if (
        remoteScore === localScore &&
        remoteHasData &&
        (localEmpty || remoteNewer)
      ) {
        doc = remoteDoc;
      }
      // Else keep local — more (or equal) branches / paints.
    }
  } catch {
    /* offline — keep local */
  }
  saveTree(doc);
  return doc;
}

/**
 * Painted matrix for a constructor branch (source of truth for Errors «Стратегия»).
 */
export function loadBranchPaintMatrix(
  strategyId: string,
  potKind: BranchPotKind | string,
  matchup: string,
): Record<string, CellFreq> | null {
  try {
    const doc = loadTree(strategyId);
    const wantMu = normalizeMatchupTag(matchup);
    const pot = String(potKind || "").toLowerCase();
    const potAliases =
      pot === "limp"
        ? ["limp"]
        : pot === "multi" || pot === "multiway" || pot === "multipot"
          ? ["multi"]
          : pot === "allin" || pot === "all_in" || pot === "4bp"
            ? ["4bp"]
            : pot === "3bp"
              ? ["3bp"]
              : [pot];
    // Prefer exact label; fall back to reverse seat-pair (`BTNvsBB` ↔ `BBvsBTN`)
    // so Errors/compare can use the line that already has hero ranges.
    const rev = (() => {
      const m = wantMu.match(/^([A-Z0-9+]+)vs([A-Z0-9+]+)$/);
      return m ? `${m[2]}vs${m[1]}` : null;
    })();
    const painted = collectAnalysisBranches(doc.root);
    const branch =
      painted.find(
        (b) =>
          potAliases.includes(b.potKind) &&
          normalizeMatchupTag(b.label) === wantMu,
      ) ||
      (rev
        ? painted.find(
            (b) =>
              potAliases.includes(b.potKind) &&
              normalizeMatchupTag(b.label) === rev,
          )
        : undefined);
    if (!branch) return null;
    const node = findNode(doc.root, branch.paintNodeId);
    if (!node) return null;
    const matrix = rangesToMatrix(node.ranges);
    return isPainted(matrix) ? matrix : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the constructor tree and sync DB spots to match.
 * Prefers the tree with more painted charts (never wipe local paints with a
 * newer-but-empty remote). Persists the chosen tree so analysis matches sync.
 */
export async function ensureConstructorChartsSynced(
  strategyId: string,
  opts?: { force?: boolean },
): Promise<GameTreeDocument> {
  const doc = await resolveConstructorTree(strategyId);
  // Default: skip upsert when constructor fingerprint unchanged (fast tab open).
  await syncTreeChartsToDb(strategyId, doc, { force: opts?.force === true });
  return doc;
}

/** Debounced in the editor — sync painted tree ranges into DB strategy cells. */
export async function syncTreeChartsToDb(
  strategyId: string,
  doc: GameTreeDocument,
  opts?: { force?: boolean },
) {
  const jobs = collectJobs(doc.root);
  const fp = jobsFingerprint(jobs) || "empty";
  if (!opts?.force && lastSyncFp.get(strategyId) === fp) return;

  let spots = await listSpots(strategyId);
  let sortOrder = spots.length;
  const keepIds = new Set<string>();

  // Empty tree must not wipe existing DB charts (stale resolve / empty remote).
  const editorBranchCount = collectEditorBranches(doc.root).length;
  if (jobs.length === 0 && editorBranchCount === 0 && spots.length > 0) {
    lastSyncFp.set(strategyId, fp);
    return;
  }

  for (const job of jobs) {
    let spot = spots.find(
      (s) =>
        s.spot_key === job.spotKey &&
        s.hero_position === job.hero &&
        (s.villain_position ?? null) === (job.villain ?? null),
    );
    if (!spot) {
      spot = await createSpot(strategyId, {
        spot_key: job.spotKey,
        hero_position: job.hero,
        villain_position: job.villain,
        label: branchTag(job.spotKey, job.hero, job.villain),
        sort_order: sortOrder,
      });
      sortOrder += 1;
      spots = [...spots, spot];
    }
    await upsertCells(spot.id, matrixToPayload(job.matrix));
    keepIds.add(spot.id);
  }

  // Delete every spot not painted in the constructor (presets / old ensures / orphans).
  for (const spot of spots) {
    if (keepIds.has(spot.id)) continue;
    try {
      await deleteSpot(spot.id);
    } catch {
      /* ignore single-spot failure; continue purge */
    }
  }

  const prevFp = lastSyncFp.get(strategyId);
  lastSyncFp.set(strategyId, fp);
  setChartsRevision(strategyId, fp);
  // Keep HUD / loaded session — only mark strategy-compare stale when charts
  // actually changed in this session (not on first sync after reload).
  if (prevFp != null && prevFp !== fp) {
    markAnalysisChartsStale(strategyId, fp);
  }
}
