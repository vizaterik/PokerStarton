/**
 * Re-score an already-imported local session against current strategy charts.
 * Runs through the analysis job so AnalysisBgWait shows progress (no UI freeze).
 */

import { finalizeLocalAnalysis } from "./localAnalysis";
import { listHandsForStrategy } from "./localDb";
import { ensureHandsSyncedToServer } from "./profileSync";
import {
  completeClientImport,
  isAnalysisJobBusy,
  markAnalysisUploadFailed,
  markAnalysisUploadStarted,
  updateClientImportProgress,
} from "../lib/analysisJob";

export type ResyncResult = {
  ok: boolean;
  hands: number;
  error: string | null;
};

/**
 * Returns false if there is nothing to resync or a job is already running.
 */
export async function resyncLocalAnalysis(strategyId: string): Promise<ResyncResult> {
  if (!strategyId) {
    return { ok: false, hands: 0, error: "Нет стратегии" };
  }
  if (isAnalysisJobBusy()) {
    return { ok: false, hands: 0, error: "Анализ уже выполняется" };
  }

  const rows = await listHandsForStrategy(strategyId);
  if (!rows.length) {
    return { ok: false, hands: 0, error: "Нет загруженной сессии" };
  }

  const hands = rows.length;
  markAnalysisUploadStarted(strategyId, hands, { external: true });
  updateClientImportProgress(strategyId, 10, "Проверяем стратегию…", hands);

  try {
    const fin = await finalizeLocalAnalysis(strategyId, (p) => {
      let pct = 55;
      if (p.phase === "done") pct = 72;
      else if (p.phase === "deviations") {
        const t = Math.min(1, Math.max(0, (p.pct - 20) / 70));
        pct = Math.round(56 + t * 16);
      } else if (p.phase === "hud") {
        pct = 55;
      } else {
        pct = Math.min(72, Math.max(55, Math.round(55 + (p.pct / 100) * 17)));
      }
      updateClientImportProgress(strategyId, pct, p.message, hands);
    });

    updateClientImportProgress(strategyId, 72, "Сохраняем раздачи на сервер…", fin.hands);
    const snap = await ensureHandsSyncedToServer(strategyId, {
      force: true,
      label: "Сессия · сверка",
      sourceFilename: "resync.txt",
      onProgress: (message, pct) => {
        updateClientImportProgress(
          strategyId,
          Math.min(99, 72 + Math.round((pct / 100) * 27)),
          message,
          fin.hands,
        );
      },
    });

    if (!snap.ok) {
      const msg = snap.error || "Не удалось сохранить раздачи на сервер";
      markAnalysisUploadFailed(strategyId, msg);
      return { ok: false, hands: fin.hands, error: msg };
    }

    completeClientImport(
      strategyId,
      fin.hands,
      `Сверка обновлена · ${fin.hands.toLocaleString("ru-RU")} рук · на сервере`,
    );
    return { ok: true, hands: fin.hands, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка обновления сверки";
    markAnalysisUploadFailed(strategyId, msg);
    return { ok: false, hands, error: msg };
  }
}

/** True when cached report was built against older charts / strategy.updated_at. */
export function isAnalysisChartsStale(
  cached: {
    chartsRev?: string | null;
    strategyUpdatedAt?: string | null;
    handTotal?: number;
  } | null,
  chartsRev: string | null,
  strategyUpdatedAt: string | null,
): boolean {
  if (!cached || !(cached.handTotal && cached.handTotal > 0)) {
    // No report yet — caller decides whether to build from IndexedDB hands.
    return true;
  }
  if (chartsRev && cached.chartsRev !== chartsRev) return true;
  if (strategyUpdatedAt && cached.strategyUpdatedAt !== strategyUpdatedAt) return true;
  // Legacy cache without stamps: resync once when we have a revision to stamp.
  if (
    cached.chartsRev == null &&
    cached.strategyUpdatedAt == null &&
    (chartsRev || strategyUpdatedAt)
  ) {
    return true;
  }
  return false;
}
