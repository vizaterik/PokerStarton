/**
 * Main-thread fallback when Web Worker cannot start.
 */

import { estimateHandCount, parseHandHistory, splitHandBlocks } from "./parseHh";
import {
  assertDailyUploadBatchSize,
  dedupeStrategyHands,
  flushLocalDb,
  insertHandBatch,
  loadDailyUploadQuota,
  openLocalDb,
  remainingDailyUploadSlots,
} from "./localDb";
import type { LocalImportResult, ParsedHand, ProgressPayload } from "./types";

function yieldTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export async function importFilesOnMainThread(
  strategyId: string,
  files: Array<{ name: string; text: string }>,
  onProgress?: (p: ProgressPayload) => void,
): Promise<LocalImportResult> {
  await openLocalDb();
  const sessionId = `local-${Date.now().toString(36)}`;
  const uploadQuota = await loadDailyUploadQuota(strategyId);
  const remaining = remainingDailyUploadSlots(uploadQuota);
  const seenInImport = new Set<string>();

  let totalEstimate = 0;
  for (const f of files) totalEstimate += Math.max(1, estimateHandCount(f.text));
  if (totalEstimate < 1) totalEstimate = 1;

  let done = 0;
  const emit = (phase: string, message: string, pct: number) => {
    onProgress?.({
      done,
      total: totalEstimate,
      phase,
      message,
      pct: Math.min(99, Math.max(1, Math.round(pct))),
    });
  };

  emit("parse", "Читаем файлы…", 2);

  const allHands: ParsedHand[] = [];
  for (const file of files) {
    const blocks = splitHandBlocks(file.text);
    const chunkSize = 60;
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
        `Парсинг ${file.name} · ${Math.min(done, totalEstimate).toLocaleString("ru-RU")} рук`,
        5 + (done / totalEstimate) * 45,
      );
      await yieldTick();
    }
  }

  assertDailyUploadBatchSize(allHands.length, remaining);

  let insertedTotal = 0;
  let dupTotal = 0;
  const insertChunk = 60;
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

  return {
    strategyId,
    handsInserted: insertedTotal,
    duplicatesSkipped: dupTotal,
    limitSkipped: 0,
    handsParsed: allHands.length,
    hands: allHands.length,
    sessionId,
  };
}
