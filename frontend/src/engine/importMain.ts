/**
 * Main-thread fallback when Web Worker cannot start.
 */

import { estimateHandCount, parseHandHistory, splitHandBlocks } from "./parseHh";
import {
  dedupeStrategyHands,
  flushLocalDb,
  insertHandBatch,
  loadDayHandCounts,
  openLocalDb,
} from "./localDb";
import type { LocalImportResult, ProgressPayload } from "./types";

function yieldTick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export async function importFilesOnMainThread(
  strategyId: string,
  files: Array<{ name: string; text: string }>,
  onProgress?: (p: ProgressPayload) => void,
): Promise<LocalImportResult> {
  await openLocalDb();
  // Stack sessions into the strategy DB (dupes skipped by hand id).
  const sessionId = `local-${Date.now().toString(36)}`;
  const dayCounts = await loadDayHandCounts(strategyId);
  const seenInImport = new Set<string>();

  let totalEstimate = 0;
  for (const f of files) totalEstimate += Math.max(1, estimateHandCount(f.text));
  if (totalEstimate < 1) totalEstimate = 1;

  let done = 0;
  let insertedTotal = 0;
  let dupTotal = 0;
  let limitTotal = 0;
  let parsedTotal = 0;

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

  for (const file of files) {
    const blocks = splitHandBlocks(file.text);
    const chunkSize = 60;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const slice = blocks.slice(i, i + chunkSize);
      const hands = parseHandHistory(slice.join("\n\n"));
      parsedTotal += hands.length;
      const { inserted, duplicates, limitSkipped } = await insertHandBatch(
        strategyId,
        sessionId,
        hands,
        dayCounts,
        seenInImport,
      );
      insertedTotal += inserted;
      dupTotal += duplicates;
      limitTotal += limitSkipped;
      done += slice.length;
      emit(
        "parse",
        `Парсинг ${file.name} · ${Math.min(done, totalEstimate).toLocaleString("ru-RU")} рук`,
        5 + (done / totalEstimate) * 70,
      );
      await yieldTick();
    }
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
    limitSkipped: limitTotal,
    handsParsed: parsedTotal,
    hands: parsedTotal,
    sessionId,
  };
}
