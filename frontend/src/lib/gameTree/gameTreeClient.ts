/**
 * Main-thread facade for gameTreeWorker (chart jobs + fingerprint).
 */
import type { CellFreq } from "../handMatrix";
import type { Position, SpotKey } from "../../types/strategy";
import type { GameTreeDocument } from "./types";
import type { TreeWorkerIn, TreeWorkerOut } from "./gameTreeWorker";

export type ChartJobResult = {
  spotKey: SpotKey;
  hero: Position;
  villain: Position | null;
  matrix: Record<string, CellFreq>;
};

export type JobsFpResult = {
  fingerprint: string;
  jobCount: number;
  jobs: ChartJobResult[];
};

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let reqSeq = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./gameTreeWorker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  const w = getWorker();
  readyPromise = new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent<TreeWorkerOut>) => {
      if (ev.data.type === "ready") {
        w.removeEventListener("message", onMsg);
        resolve();
      }
      if (ev.data.type === "error" && ev.data.requestId === 0) {
        w.removeEventListener("message", onMsg);
        reject(new Error(ev.data.message));
      }
    };
    w.addEventListener("message", onMsg);
    w.addEventListener(
      "error",
      () => {
        w.removeEventListener("message", onMsg);
        reject(new Error("gameTree worker failed to start"));
      },
      { once: true },
    );
    const msg: TreeWorkerIn = { type: "init" };
    w.postMessage(msg);
  });
  return readyPromise;
}

/** Compute chart sync jobs + fingerprint off the UI thread. */
export async function computeJobsFingerprint(
  doc: GameTreeDocument,
): Promise<JobsFpResult> {
  await ensureReady();
  const w = getWorker();
  const requestId = reqSeq++;
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent<TreeWorkerOut>) => {
      const data = ev.data;
      if (data.type === "error" && data.requestId === requestId) {
        w.removeEventListener("message", onMsg);
        reject(new Error(data.message));
        return;
      }
      if (data.type === "jobsFp" && data.requestId === requestId) {
        w.removeEventListener("message", onMsg);
        resolve({
          fingerprint: data.fingerprint,
          jobCount: data.jobCount,
          jobs: data.jobs,
        });
      }
    };
    w.addEventListener("message", onMsg);
    const msg: TreeWorkerIn = { type: "jobsFp", requestId, doc };
    w.postMessage(msg);
  });
}
