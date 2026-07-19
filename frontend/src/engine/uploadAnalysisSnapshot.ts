/**
 * Upload PC-built analysis report + compact hands (no HH text).
 * Sends hands in chunks so large sessions land in the profile DB reliably.
 */

import {
  MAX_HANDS_PER_ANALYSIS,
  uploadAnalysisSnapshot as postSnapshot,
  type AnalysisSnapshotUploadResponse,
} from "../api/client";
import { peekAnalysisCache } from "../lib/analysisCache";
import { resultsFingerprint, writeResultsCache } from "../lib/resultsCache";
import { listHandsForStrategy } from "./localDb";
import { replayStubForUpload } from "./replayStub";

/** Hands per HTTP packet — keeps each request small enough for SQLite + XHR. */
const HAND_CHUNK = 350;

export type SnapshotUploadResult = {
  ok: boolean;
  /** New hands written this upload. */
  handsSaved: number;
  /** Hands already present in the profile DB (skipped as duplicates). */
  duplicatesSkipped: number;
  sessionId: string | null;
  error: string | null;
  response: AnalysisSnapshotUploadResponse | null;
};

function formatDataSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  }
  const mb = bytes / (1024 * 1024);
  const digits = mb >= 10 ? 1 : 2;
  return `${mb.toFixed(digits).replace(".", ",")} МБ`;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function toCompactHand(r: Awaited<ReturnType<typeof listHandsForStrategy>>[number]) {
  return {
    external_hand_id: r.external_hand_id,
    played_at: r.played_at,
    table_name: r.table_name,
    small_blind: r.small_blind,
    big_blind: r.big_blind,
    hero_name: r.hero_name,
    hero_position: r.hero_position,
    hero_hand: r.hero_hand,
    hero_hand_code: r.hero_hand_code,
    detected_spot: r.detected_spot,
    villain_position: r.villain_position,
    stack_bb: r.stack_bb ?? null,
    hero_preflop_action: r.hero_preflop_action ?? null,
    hero_net: r.hero_net,
    hero_net_bb: r.hero_net_bb,
    went_to_showdown: r.went_to_showdown,
    hero_net_wsd: r.hero_net_wsd,
    hero_net_wsd_bb: r.hero_net_wsd_bb,
    hero_net_wwsd: r.hero_net_wwsd,
    hero_net_wwsd_bb: r.hero_net_wwsd_bb,
    actions: Array.isArray(r.actions) ? r.actions : [],
    // Table + all seats (not only actors) — UTG open still shows full 6-max.
    raw_text: replayStubForUpload({
      raw_text: r.raw_text,
      external_hand_id: r.external_hand_id,
      table_name: r.table_name,
      table_max: r.table_max,
      button_seat: r.button_seat,
      small_blind: r.small_blind,
      big_blind: r.big_blind,
      played_at: r.played_at,
      seats: r.seats,
      hero_name: r.hero_name,
      hero_hand: r.hero_hand,
    }),
  };
}

export async function uploadLocalAnalysisSnapshot(
  strategyId: string,
  opts?: {
    label?: string;
    sourceFilename?: string;
    onProgress?: (message: string, pct: number) => void;
  },
): Promise<SnapshotUploadResult> {
  const onProgress = opts?.onProgress;
  onProgress?.("Готовим отчёт сессии…", 8);

  const cache = peekAnalysisCache(strategyId);
  if (!cache?.analysis) {
    return {
      ok: false,
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: "Нет готового анализа. Сначала загрузите историю на странице Анализ.",
      response: null,
    };
  }

  onProgress?.("Собираем итоги раздач…", 18);
  const rows = await listHandsForStrategy(strategyId);
  if (!rows.length) {
    return {
      ok: false,
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: "В сессии нет раздач",
      response: null,
    };
  }

  if (rows.length > MAX_HANDS_PER_ANALYSIS) {
    return {
      ok: false,
      handsSaved: 0,
      duplicatesSkipped: 0,
      sessionId: null,
      error: `За одну сессию можно загрузить не больше ${MAX_HANDS_PER_ANALYSIS.toLocaleString("ru-RU")} рук`,
      response: null,
    };
  }

  const times = rows
    .map((r) => r.played_at)
    .filter((t): t is string => Boolean(t))
    .sort();

  const hands = rows.map(toCompactHand);

  const report = {
    fingerprint: cache.fingerprint,
    handTotal: cache.handTotal || rows.length,
    savedAt: cache.savedAt,
    source: "pc_snapshot",
    analysisSummary: cache.analysis
      ? {
          hands: cache.analysis.hands ?? rows.length,
          total_profit_bb: cache.analysis.total_profit_bb ?? null,
          total_profit_money: cache.analysis.total_profit_money ?? null,
          winrate_bb100: cache.analysis.winrate_bb100 ?? null,
        }
      : null,
    deviationsSummary: cache.deviations
      ? {
          decisions: cache.deviations.decisions ?? 0,
          correct: cache.deviations.correct ?? 0,
        }
      : null,
  };

  const totalChunks = Math.max(1, Math.ceil(hands.length / HAND_CHUNK));
  let sessionId: string | undefined;
  let handsNewlySaved = 0;
  let last: AnalysisSnapshotUploadResponse | null = null;

  try {
    for (let i = 0; i < hands.length; i += HAND_CHUNK) {
      const chunk = hands.slice(i, i + HAND_CHUNK);
      const chunkIdx = Math.floor(i / HAND_CHUNK) + 1;
      const finalize = chunkIdx === totalChunks;
      const basePct = 28 + Math.round((60 * (chunkIdx - 1)) / totalChunks);

      onProgress?.(
        `Загружаем в базу профиля… ${chunkIdx}/${totalChunks} · ${Math.min(i + chunk.length, hands.length).toLocaleString("ru-RU")} / ${hands.length.toLocaleString("ru-RU")}`,
        basePct,
      );
      await yieldToUi();

      const payload = {
        strategy_id: strategyId,
        label: opts?.label,
        source_filename: opts?.sourceFilename ?? "local-import.txt",
        room: "pokerstars",
        started_at: times[0] ?? null,
        ended_at: times[times.length - 1] ?? null,
        report: finalize ? report : {},
        hands: chunk,
        session_id: sessionId,
        finalize,
      };

      const body = JSON.stringify(payload);
      const totalBytes = new TextEncoder().encode(body).length;
      const totalLabel = formatDataSize(totalBytes);

      last = await postSnapshot(payload, {
        body,
        onUploadProgress: (p) => {
          if (p.phase === "uploading") {
            const slice = Math.round((p.percent / 100) * (60 / totalChunks));
            onProgress?.(
              `Пакет ${chunkIdx}/${totalChunks} · ${formatDataSize(p.loaded)} / ${totalLabel}`,
              Math.min(94, basePct + slice),
            );
            return;
          }
          onProgress?.(
            finalize
              ? `Сервер считает карьеру · пакет ${chunkIdx}/${totalChunks}`
              : `Сервер сохраняет пакет ${chunkIdx}/${totalChunks}`,
            Math.min(96, basePct + Math.round(60 / totalChunks)),
          );
        },
      });

      sessionId = last.session_id;
      handsNewlySaved += last.hands_saved ?? 0;
    }

    if (last?.career_report) {
      writeResultsCache(resultsFingerprint(""), last.career_report);
    }

    const duplicatesSkipped = Math.max(0, hands.length - handsNewlySaved);
    const totalInDb = last?.hands_total ?? handsNewlySaved;
    onProgress?.(
      duplicatesSkipped > 0 && handsNewlySaved === 0
        ? `Раздачи уже в базе профиля · ${hands.length.toLocaleString("ru-RU")}`
        : `В базе профиля · ${totalInDb.toLocaleString("ru-RU")} рук`,
      100,
    );
    return {
      ok: true,
      handsSaved: handsNewlySaved,
      duplicatesSkipped,
      sessionId: last?.session_id ?? null,
      error: null,
      response: last,
    };
  } catch (err) {
    return {
      ok: false,
      handsSaved: handsNewlySaved,
      duplicatesSkipped: 0,
      sessionId: sessionId ?? null,
      error: err instanceof Error ? err.message : "Ошибка загрузки в базу профиля",
      response: last,
    };
  }
}
