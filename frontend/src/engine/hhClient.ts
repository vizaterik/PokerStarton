/**
 * Main-thread facade for client-side HH import (Worker + fallback).
 */

import type { BatchUploadReport } from "../api/client";
import { importFilesOnMainThread } from "./importMain";
import type { HhWorkerIn, HhWorkerOut } from "./hhWorker";
import type { LocalImportResult, ProgressPayload } from "./types";

export const CLIENT_HH_ENGINE = true;

type ProgressCb = (p: ProgressPayload) => void;

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let reqSeq = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./hhWorker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  const w = getWorker();
  readyPromise = new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent<HhWorkerOut>) => {
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
        reject(new Error("Worker failed to start"));
      },
      { once: true },
    );
    const msg: HhWorkerIn = { type: "init" };
    w.postMessage(msg);
  });
  return readyPromise;
}

async function readFiles(files: File[]): Promise<Array<{ name: string; text: string }>> {
  const out: Array<{ name: string; text: string }> = [];
  for (const f of files) {
    out.push({ name: f.name, text: await f.text() });
  }
  return out;
}

function toBatchReport(result: LocalImportResult, fileCount: number): BatchUploadReport {
  const now = new Date().toISOString();
  // Count recognized hands (new + already in local DB), not only fresh inserts.
  const recognized = Math.max(
    result.handsParsed ?? 0,
    (result.handsInserted ?? 0) + (result.duplicatesSkipped ?? 0),
    result.hands ?? 0,
  );
  return {
    uploads: [
      {
        upload_id: result.sessionId,
        session_id: result.sessionId,
        session_label: "Локальный импорт",
        status: "completed",
        hands_count: recognized,
        duplicates_skipped: result.duplicatesSkipped,
        hands_with_decision: recognized,
        deviations_count: 0,
        correct_count: 0,
        error_message: null,
        strategy_id: result.strategyId,
        original_filename: "local",
        room: null,
      },
    ],
    sessions: [
      {
        id: result.sessionId,
        user_id: "local",
        strategy_id: result.strategyId,
        upload_id: result.sessionId,
        room: "local",
        label: "Локальный импорт",
        source_filename: "local",
        table_name: null,
        small_blind: null,
        big_blind: null,
        max_seats: null,
        started_at: now,
        ended_at: now,
        hands_count: recognized,
        hands_with_decision: recognized,
        deviations_count: 0,
        correct_count: 0,
        created_at: now,
        status: "active",
      },
    ],
    files_count: fileCount,
    total_hands: recognized,
    total_duplicates_skipped: result.duplicatesSkipped,
    total_deviations: 0,
    total_correct: 0,
  };
}

export async function importHandsLocally(
  files: File[],
  strategyId: string,
  onProgress?: ProgressCb,
): Promise<BatchUploadReport> {
  const payloads = await readFiles(files);

  try {
    await ensureReady();
    const w = getWorker();
    const requestId = reqSeq++;
    const result = await new Promise<LocalImportResult>((resolve, reject) => {
      const onMsg = (ev: MessageEvent<HhWorkerOut>) => {
        const msg = ev.data;
        if (msg.type === "progress" && msg.requestId === requestId) {
          onProgress?.(msg.progress);
          return;
        }
        if (msg.type === "done" && msg.requestId === requestId) {
          w.removeEventListener("message", onMsg);
          resolve(msg.result);
          return;
        }
        if (msg.type === "error" && msg.requestId === requestId) {
          w.removeEventListener("message", onMsg);
          reject(new Error(msg.message));
        }
      };
      w.addEventListener("message", onMsg);
      const msg: HhWorkerIn = {
        type: "import",
        requestId,
        strategyId,
        files: payloads,
      };
      w.postMessage(msg);
    });
    return toBatchReport(result, files.length);
  } catch {
    const result = await importFilesOnMainThread(strategyId, payloads, onProgress);
    return toBatchReport(result, files.length);
  }
}
