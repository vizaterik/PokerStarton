/// <reference lib="webworker" />

import { estimateHandCount, parseHandHistory, splitHandBlocks } from "./parseHh";
import {
  flushLocalDb,
  insertHandBatch,
  openLocalDb,
} from "./localDb";
import type { LocalImportResult, ProgressPayload } from "./types";

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
  // Stack sessions: new hands append; duplicates skip by external_hand_id.
  const sessionId = `local-${Date.now().toString(36)}`;

  let totalEstimate = 0;
  for (const f of files) totalEstimate += Math.max(1, estimateHandCount(f.text));
  if (totalEstimate < 1) totalEstimate = 1;

  let done = 0;
  let insertedTotal = 0;
  let dupTotal = 0;
  let parsedTotal = 0;

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

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const blocks = splitHandBlocks(file.text);
    const chunkSize = 80;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const slice = blocks.slice(i, i + chunkSize);
      const text = slice.join("\n\n");
      const hands = parseHandHistory(text);
      parsedTotal += hands.length;
      const { inserted, duplicates } = await insertHandBatch(strategyId, sessionId, hands);
      insertedTotal += inserted;
      dupTotal += duplicates;
      done += slice.length;
      const pct = 5 + (done / totalEstimate) * 70;
      emit(
        "parse",
        `Парсинг ${file.name} · ${Math.min(done, totalEstimate).toLocaleString("ru-RU")} / ${totalEstimate.toLocaleString("ru-RU")}`,
        pct,
      );
      await yieldTick();
    }
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
      handsParsed: parsedTotal,
      hands: parsedTotal,
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
