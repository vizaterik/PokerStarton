/**
 * Background analysis job — survives route changes.
 * Client import: Worker drives % on the PC. Server pipeline optional (not used on Analysis).
 */

import {
  fetchMissingSpots,
  fetchStrategyAnalysis,
  fetchStrategyDeviations,
  listSessions,
  listSpots,
  type EnsuredSpotInfo,
  type StrategyAnalysis,
  type StrategyDeviationsResponse,
  type StrategySpot,
} from "../api/client";
import {
  analysisFingerprint,
  writeAnalysisCache,
} from "./analysisCache";
import { warmHandDbAndResultsCache } from "./warmCaches";

export type AnalysisJobStatus =
  | "idle"
  | "uploading"
  | "running"
  | "done"
  | "error";

export type AnalysisJobState = {
  status: AnalysisJobStatus;
  strategyId: string | null;
  hands: number | null;
  step: number;
  /** 0–100 perceived progress for nav / banners */
  progress: number;
  message: string | null;
  error: string | null;
  /** Bumps when a job finishes successfully — panels can refresh. */
  doneToken: number;
};

type Listener = () => void;

let state: AnalysisJobState = {
  status: "idle",
  strategyId: null,
  hands: null,
  step: 0,
  progress: 0,
  message: null,
  error: null,
  doneToken: 0,
};

let controller: AbortController | null = null;
let progressRaf = 0;
let progressStartedAt = 0;
let lastTickAt = 0;
let lastEmittedPct = -1;
let progressEmitTimer = 0;
/** When true, Worker/client callbacks own the % — skip fake rAF crawl. */
let externalProgress = false;
/** Base label without "(N с)" suffix — refreshed when phase changes. */
let phaseLabel = "";
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function setState(patch: Partial<AnalysisJobState>) {
  if (typeof patch.message === "string" && patch.message) {
    phaseLabel = stripElapsed(patch.message);
  }
  state = { ...state, ...patch };
  emit();
}

function stripElapsed(msg: string): string {
  return msg.replace(/\s*\(\d+\s*с\)\s*$/u, "").trim();
}

/** Soft ceiling — one continuous ramp, no step-based jumps. */
function phaseSoftCap(): number {
  if (state.status === "uploading") return 62;
  if (state.status !== "running") return 99;
  return 96;
}

function stopProgressTicker() {
  if (progressRaf) {
    cancelAnimationFrame(progressRaf);
    progressRaf = 0;
  }
  if (progressEmitTimer) {
    window.clearTimeout(progressEmitTimer);
    progressEmitTimer = 0;
  }
}

/**
 * Client-side (PC) progress: always moves a little.
 * Fast approach to the soft phase cap, then a slow crawl toward 99%
 * so the UI never looks frozen while the server is busy.
 */
function startProgressTicker(resetClock: boolean) {
  stopProgressTicker();
  if (resetClock) {
    progressStartedAt = performance.now();
    lastEmittedPct = -1;
  }

  const tick = (now: number) => {
    if (externalProgress) {
      progressRaf = 0;
      return;
    }
    if (state.status !== "uploading" && state.status !== "running") {
      progressRaf = 0;
      return;
    }

    const t = Math.max(0, (now - progressStartedAt) / 1000);
    const dt = lastTickAt ? Math.min(0.25, Math.max(0, (now - lastTickAt) / 1000)) : 0;
    lastTickAt = now;

    const soft = phaseSoftCap();
    const total = state.hands != null && state.hands > 0 ? state.hands : null;
    // Larger files → slower early ramp (feels proportional on the PC).
    const tau = total ? Math.max(4, Math.min(16, total / 85)) : 5.5;
    const approach = 3 + (soft - 3) * (1 - Math.exp(-t / tau));
    // After ~soft, crawl toward 99 without jumping between phase caps.
    const over = Math.max(0, t - tau * 1.15);
    const crawl = (99 - soft) * (1 - Math.exp(-over / 140));
    let next = Math.min(99, Math.max(state.progress, approach + crawl));
    // Gentle floor so % never freezes — no big leaps.
    if (dt > 0 && next < 99) {
      next = Math.min(99, Math.max(next, state.progress + dt * 0.18));
    }
    const rounded = Math.min(99, Math.round(next * 10) / 10);
    // Derive step from % only (ordered checklist in UI).
    const step =
      rounded >= 78 ? 3 : rounded >= 52 ? 2 : rounded >= 28 ? 1 : 0;
    const base = phaseLabel || state.message || "Обработка…";

    const pctChanged = Math.round(rounded) !== lastEmittedPct;
    if (pctChanged || state.step !== step) {
      lastEmittedPct = Math.round(rounded);
      state = {
        ...state,
        progress: rounded,
        step,
        message: stripElapsed(base),
      };
      if (!progressEmitTimer) {
        progressEmitTimer = window.setTimeout(() => {
          progressEmitTimer = 0;
          emit();
        }, 160);
      }
    } else {
      state = { ...state, progress: rounded, step };
    }

    progressRaf = requestAnimationFrame(tick);
  };
  lastTickAt = 0;
  progressRaf = requestAnimationFrame(tick);
}

export function getAnalysisJob(): AnalysisJobState {
  return state;
}

export function subscribeAnalysisJob(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isAnalysisJobRunning(strategyId?: string): boolean {
  if (state.status !== "running" && state.status !== "uploading") return false;
  if (!strategyId) return true;
  return state.strategyId === strategyId;
}

export function isAnalysisJobBusy(): boolean {
  return state.status === "running" || state.status === "uploading";
}

/** Drop in-flight / finished job chrome after hand-DB wipe or switch. */
export function resetAnalysisJob(): void {
  controller?.abort();
  controller = null;
  stopProgressTicker();
  externalProgress = false;
  phaseLabel = "";
  setState({
    status: "idle",
    strategyId: null,
    hands: null,
    step: 0,
    progress: 0,
    message: null,
    error: null,
  });
}

/** Call as soon as the user starts uploading a session (nav % appears). */
export function markAnalysisUploadStarted(
  strategyId: string,
  handsHint?: number | null,
  opts?: { external?: boolean },
): void {
  if (!strategyId) return;
  const useExternal = Boolean(opts?.external);
  if (state.status === "uploading" && state.strategyId === strategyId) {
    if (handsHint && handsHint > 0) {
      setState({
        hands: handsHint,
        message: phaseLabel || "Загрузка рук…",
      });
    }
    if (!useExternal && !progressRaf) startProgressTicker(false);
    return;
  }
  if (state.status === "running" && state.strategyId === strategyId) {
    setState({
      hands: handsHint && handsHint > 0 ? handsHint : state.hands,
      message: "Анализ рук…",
    });
    return;
  }
  controller?.abort();
  controller = null;
  stopProgressTicker();
  externalProgress = useExternal;
  phaseLabel = useExternal ? "Анализ рук…" : "Загрузка рук…";
  setState({
    status: "uploading",
    strategyId,
    hands: handsHint && handsHint > 0 ? handsHint : null,
    step: 0,
    progress: 2,
    message: phaseLabel,
    error: null,
  });
  if (!useExternal) startProgressTicker(true);
}

/** Worker / main-thread client import drives real %. */
export function updateClientImportProgress(
  strategyId: string,
  pct: number,
  message: string,
  hands?: number | null,
): void {
  if (state.strategyId && state.strategyId !== strategyId) return;
  if (!externalProgress) {
    externalProgress = true;
    stopProgressTicker();
  }
  const next = Math.min(99, Math.max(state.progress || 0, Math.round(pct)));
  phaseLabel = stripElapsed(message);
  lastEmittedPct = Math.round(next);
  setState({
    status: "uploading",
    strategyId,
    progress: next,
    message: phaseLabel,
    hands: hands && hands > 0 ? hands : state.hands,
    step: next >= 78 ? 3 : next >= 52 ? 2 : next >= 28 ? 1 : 0,
  });
}

/** Local import finished — show done, no server analysis. */
export function completeClientImport(
  strategyId: string,
  hands: number,
  message?: string,
): void {
  externalProgress = false;
  stopProgressTicker();
  controller?.abort();
  controller = null;
  setState({
    status: "done",
    strategyId,
    hands: hands > 0 ? hands : state.hands,
    step: 3,
    progress: 100,
    message:
      message ?? `Анализ рук готов · ${(hands || 0).toLocaleString("ru-RU")} рук`,
    error: null,
    doneToken: state.doneToken + 1,
  });
  window.setTimeout(() => {
    const cur = getAnalysisJob();
    if (cur.status === "done" && cur.strategyId === strategyId) {
      setState({
        status: "idle",
        progress: 0,
        message: null,
        error: null,
      });
    }
  }, 8000);
}

/** Upload / import failed — show error in the boot screen. */
export function markAnalysisUploadFailed(
  strategyId?: string,
  errorMessage?: string,
): void {
  if (strategyId && state.strategyId && state.strategyId !== strategyId) {
    if (state.status === "uploading" || state.status === "running") return;
  }
  externalProgress = false;
  stopProgressTicker();
  controller?.abort();
  controller = null;
  if (errorMessage) {
    setState({
      status: "error",
      strategyId: strategyId ?? state.strategyId,
      progress: 0,
      message: null,
      error: errorMessage,
    });
    return;
  }
  if (state.status !== "uploading" && state.status !== "running") return;
  setState({
    status: "idle",
    progress: 0,
    message: null,
    error: null,
  });
}

/** Start (or restart) full analysis pipeline off the page lifecycle. */
export function startBackgroundAnalysis(
  strategyId: string,
  handsHint?: number | null,
): void {
  if (!strategyId) return;
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const runId = Date.now();
  const keepProgress =
    (state.status === "uploading" || state.status === "running") &&
    state.strategyId === strategyId &&
    state.progress > 0;

  externalProgress = false;
  phaseLabel = "Считаем HUD и график…";
  setState({
    status: "running",
    strategyId,
    hands: handsHint && handsHint > 0 ? handsHint : state.hands,
    step: 0,
    progress: keepProgress ? Math.max(state.progress, 60) : 60,
    message: phaseLabel,
    error: null,
  });
  // Keep the same clock so % doesn't jump back; always ensure ticker is alive on PC.
  startProgressTicker(!keepProgress);

  const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer = 0;
    try {
      return await Promise.race([
        p,
        new Promise<T>((_, reject) => {
          timer = window.setTimeout(() => {
            reject(new Error(`${label}: сервер не ответил за ${Math.round(ms / 1000)} с`));
          }, ms);
        }),
      ]);
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  };

  void (async () => {
    try {
      const sessions = await withTimeout(
        listSessions(signal).catch(() => []),
        45000,
        "Список сессий",
      );
      if (signal.aborted) return;
      const fp = analysisFingerprint(strategyId, sessions);
      const handsFromSessions = sessions
        .filter(
          (s) =>
            s.strategy_id === strategyId && (s.status === "active" || !s.status),
        )
        .reduce((sum, s) => sum + (s.hands_count || 0), 0);
      if (handsFromSessions > 0) {
        setState({ hands: handsFromSessions });
      }

      phaseLabel = "Считаем HUD и график…";
      setState({
        step: 0,
        message: phaseLabel,
        progress: Math.max(state.progress, 62),
      });
      const analysis: StrategyAnalysis = await withTimeout(
        fetchStrategyAnalysis(strategyId, signal),
        180000,
        "HUD",
      );
      if (signal.aborted) return;
      if (analysis.hands > 0) setState({ hands: analysis.hands });

      phaseLabel = "Собираем ветки стратегии…";
      setState({
        step: 1,
        message: phaseLabel,
        progress: Math.max(state.progress, 76),
      });
      const [spots, missingRes]: [StrategySpot[], { missing: EnsuredSpotInfo[] }] =
        await Promise.all([
          withTimeout(listSpots(strategyId, signal), 90000, "Ветки"),
          fetchMissingSpots(strategyId, signal).catch(() => ({
            missing: [] as EnsuredSpotInfo[],
          })),
        ]);
      if (signal.aborted) return;

      phaseLabel = "Проверяем стратегию…";
      setState({
        step: 2,
        message: phaseLabel,
        progress: Math.max(state.progress, 88),
      });
      const deviations: StrategyDeviationsResponse = await withTimeout(
        fetchStrategyDeviations(strategyId, 300, signal),
        180000,
        "Отклонения",
      );
      if (signal.aborted) return;

      writeAnalysisCache(strategyId, {
        fingerprint: fp,
        analysis,
        deviations,
        spots,
        missing: missingRes.missing,
        handTotal: analysis.hands || handsFromSessions || handsHint || 0,
      });

      void warmHandDbAndResultsCache();

      if (signal.aborted) return;
      stopProgressTicker();
      setState({
        status: "done",
        step: 3,
        progress: 100,
        message: `Готово · ${(analysis.hands || handsFromSessions || 0).toLocaleString("ru-RU")} рук`,
        error: null,
        doneToken: state.doneToken + 1,
      });

      window.setTimeout(() => {
        const cur = getAnalysisJob();
        if (cur.status === "done" && cur.strategyId === strategyId && Date.now() - runId >= 0) {
          setState({
            status: "idle",
            progress: 0,
            message: null,
            error: null,
          });
        }
      }, 10000);
    } catch (err: unknown) {
      if (signal.aborted) return;
      stopProgressTicker();
      const msg =
        err instanceof Error ? err.message : "Ошибка анализа";
      setState({
        status: "error",
        progress: 0,
        error: msg,
        message: null,
      });
    }
  })();
}

export function dismissAnalysisJobBanner() {
  if (state.status === "running" || state.status === "uploading") return;
  stopProgressTicker();
  setState({
    status: "idle",
    progress: 0,
    message: null,
    error: null,
    strategyId: state.strategyId,
  });
}
