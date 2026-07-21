/// <reference lib="webworker" />

import { estimateHandCount, parseHandHistory, splitHandBlocks } from "./parseHh";
import {
  assertDailyUploadBatchSize,
  dedupeStrategyHands,
  flushLocalDb,
  insertHandBatch,
  loadDailyUploadQuota,
  openLocalDb,
  remainingDailyUploadSlots,
  type DailyUploadQuota,
} from "./localDb";
import type { LocalImportResult, ParsedHand, ProgressPayload } from "./types";

export type HhWorkerIn =
  | { type: "init" }
  | {
      type: "import";
      requestId: number;
      strategyId: string;
      files: Array<{ name: string; text: string }>;
    };

export type HhWorkerOut =
  | { type: "ready" }
  | { type: "progress"; requestId: number; progress: ProgressPayload }
  | { type: "done"; requestId: number; result: LocalImportResult }
  | { type: "error"; requestId: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: HhWorkerOut) {
  ctx.postMessage(msg);
}

function yieldTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function runImport(
  requestId: number,
  strategyId: string,
  files: Array<{ name: string; text: string }>,
) {
  await openLocalDb();
  const sessionId = `local-${Date.now().toString(36)}`;
  const uploadQuota: DailyUploadQuota = await loadDailyUploadQuota(strategyId);
  const remaining = remainingDailyUploadSlots(uploadQuota);
  const seenInImport = new Set<string>();

  let totalEstimate = 0;
  for (const f of files) totalEstimate += Math.max(1, estimateHandCount(f.text));
  if (totalEstimate < 1) totalEstimate = 1;

  let done = 0;
  const emit = (phase: string, message: string, pct: number) => {
    post({
      type: "progress",
      requestId,
      progress: {
        done,
        total: totalEstimate,
        phase,
        message,
        pct: Math.min(99, Math.max(1, Math.round(pct))),
      },
    });
  };

  emit("parse", "Читаем файлы…", 2);

  const allHands: ParsedHand[] = [];
  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const blocks = splitHandBlocks(file.text);
    const chunkSize = 80;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const slice = blocks.slice(i, i + chunkSize);
      const hands = parseHandHistory(slice.join("\n\n"));
      allHands.push(...hands);
      if (allHands.length > remaining) {
        assertDailyUploadBatchSize(allHands.length, remaining);
      }
      done += slice.length;
      emit(
        "parse",
        `Парсинг ${file.name} · ${Math.min(done, totalEstimate).toLocaleString("ru-RU")} / ${totalEstimate.toLocaleString("ru-RU")}`,
        5 + (done / totalEstimate) * 45,
      );
      await yieldTick();
    }
  }

  assertDailyUploadBatchSize(allHands.length, remaining);

  let insertedTotal = 0;
  let dupTotal = 0;
  const insertChunk = 80;
  for (let i = 0; i < allHands.length; i += insertChunk) {
    const chunk = allHands.slice(i, i + insertChunk);
    const { inserted, duplicates } = await insertHandBatch(strategyId, sessionId, chunk, {
      uploadQuota,
      seenInImport,
    });
    insertedTotal += inserted;
    dupTotal += duplicates;
    emit(
      "parse",
      `Сохраняем · ${Math.min(i + chunk.length, allHands.length).toLocaleString("ru-RU")} / ${allHands.length.toLocaleString("ru-RU")}`,
      50 + ((i + chunk.length) / Math.max(1, allHands.length)) * 35,
    );
    await yieldTick();
  }

  const removed = await dedupeStrategyHands(strategyId);
  if (removed > 0) {
    dupTotal += removed;
    insertedTotal = Math.max(0, insertedTotal - removed);
  }
  await flushLocalDb();
  emit("hud", "Собираем HUD и график…", 88);

  post({
    type: "done",
    requestId,
    result: {
      strategyId,
      handsInserted: insertedTotal,
      duplicatesSkipped: dupTotal,
      limitSkipped: 0,
      handsParsed: allHands.length,
      hands: allHands.length,
      sessionId,
    },
  });
}

ctx.onmessage = (ev: MessageEvent<HhWorkerIn>) => {
  const msg = ev.data;
  if (msg.type === "init") {
    void openLocalDb()
      .then(() => post({ type: "ready" }))
      .catch((err) =>
        post({
          type: "error",
          requestId: 0,
          message: err instanceof Error ? err.message : "Local DB failed",
        }),
      );
    return;
  }
  if (msg.type === "import") {
    void runImport(msg.requestId, msg.strategyId, msg.files).catch((err) => {
      post({
        type: "error",
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : "Import failed",
      });
    });
  }
};
