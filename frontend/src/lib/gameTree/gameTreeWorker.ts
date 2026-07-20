/**
 * Off-main-thread game-tree jobs: compact fingerprint + chart sync jobs.
 */
import { toChartPos } from "./branchPresets";
import type { CellFreq, HandCode } from "../handMatrix";
import type { Position, SpotKey } from "../../types/strategy";
import { deriveContext } from "./turnEngine";
import type { GameTreeDocument, GameTreeNode, HandMix } from "./types";

export type TreeWorkerIn =
  | { type: "init" }
  | { type: "jobsFp"; requestId: number; doc: GameTreeDocument };

export type TreeWorkerOut =
  | { type: "ready" }
  | {
      type: "jobsFp";
      requestId: number;
      fingerprint: string;
      jobCount: number;
      jobs: Array<{
        spotKey: SpotKey;
        hero: Position;
        villain: Position | null;
        matrix: Record<string, CellFreq>;
      }>;
    }
  | { type: "error"; requestId: number; message: string };

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
  villain: Position | null;
  matrix: Record<HandCode, CellFreq>;
};

/** DFS with path — no O(N²) pathToNode. */
function collectJobs(root: GameTreeNode): ChartJob[] {
  const best = new Map<string, ChartJob>();

  function visit(node: GameTreeNode, path: GameTreeNode[]) {
    const nextPath = [...path, node];
    if (node.street === "preflop" && !node.awaitingFlop) {
      const ctx = deriveContext(nextPath);
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
            ? Object.values(prev.matrix).reduce(
                (n, c) => n + c.raise_freq + c.call_freq,
                0,
              )
            : -1;
          if (play >= prevPlay) {
            best.set(key, { spotKey, hero, villain, matrix });
          }
        }
      }
    }
    for (const ch of node.children) visit(ch, nextPath);
  }

  visit(root, []);
  return [...best.values()];
}

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

self.onmessage = (ev: MessageEvent<TreeWorkerIn>) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      self.postMessage({ type: "ready" } satisfies TreeWorkerOut);
      return;
    }
    if (msg.type === "jobsFp") {
      const jobs = collectJobs(msg.doc.root);
      const fingerprint = jobsFingerprint(jobs) || "empty";
      const out: TreeWorkerOut = {
        type: "jobsFp",
        requestId: msg.requestId,
        fingerprint,
        jobCount: jobs.length,
        jobs,
      };
      self.postMessage(out);
    }
  } catch (err) {
    const out: TreeWorkerOut = {
      type: "error",
      requestId: msg.type === "jobsFp" ? msg.requestId : 0,
      message: err instanceof Error ? err.message : "gameTree worker error",
    };
    self.postMessage(out);
  }
};
