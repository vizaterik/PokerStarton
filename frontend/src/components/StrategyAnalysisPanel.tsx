import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createSpot,
  fetchMissingSpots,
  fetchStrategyAnalysis,
  fetchStrategyDeviations,
  listCells,
  listSessions,
  listSpots,
  type ChartErrorSpot,
  type EnsuredSpotInfo,
  type PreflopBranchAccuracy,
  type StrategyAnalysis,
  type StrategyDeviation,
  type StrategyDeviationsResponse,
  type StrategySpot,
} from "../api/client";
import {
  buildLocalChartDeviations,
  restoreLocalSessionReport,
} from "../engine/localAnalysis";
import { listHandsForStrategy } from "../engine/localDb";
import type { CellFreq } from "../lib/handMatrix";
import {
  analysisFingerprint,
  clearAnalysisCache,
  peekAnalysisCache,
  readAnalysisCache,
  writeAnalysisCache,
  type AnalysisCachePayload,
} from "../lib/analysisCache";
import { seedSpotIntoTree } from "../lib/gameTree/seedTreeFromSpots";
import { stashEditorFocus } from "../lib/gameTree/editorFocus";
import {
  STRATEGY_CHARTS_GAP_HINT,
  strategyHasPlayCharts,
} from "../lib/gameTree/strategyReady";
import { treeMatchupLabel, spotPotKind } from "../lib/branchLabel";
import { listMissingSpotsLocal } from "../engine/localMissingSpots";
import {
  collectAnalysisBranches,
  collectEditorBranches,
  potKindTag,
  type SavedBranch,
} from "../lib/gameTree/branches";
import { loadTree } from "../lib/gameTree/persist";
import { resolveConstructorTree } from "../lib/gameTree/syncTreeCharts";
import {
  coveredByConstructorTags,
  normalizeMatchupTag,
  spotCoveredByBranches,
} from "../lib/spotCoverage";
import { isChartPainted, strategySpotCandidates } from "../lib/spotResolve";
import {
  getAnalysisJob,
  isAnalysisJobRunning,
  markAnalysisUploadFailed,
  markAnalysisUploadStarted,
  startBackgroundAnalysis,
  subscribeAnalysisJob,
} from "../lib/analysisJob";
import { clearResultsCache } from "../lib/resultsCache";
import { warmHandDbAndResultsCache } from "../lib/warmCaches";
import AnalysisBgWait from "./AnalysisBgWait";
import AnalysisCalcProgress from "./AnalysisCalcProgress";
import DeviationErrorMatrix from "./DeviationErrorMatrix";
import HandReplayModal from "./HandReplayModal";
import H2nPerformanceChart, { analysisCurveToH2n } from "./H2nPerformanceChart";
import RecommendationsPanel from "./RecommendationsPanel";
import SessionUploadPanel from "./SessionUploadPanel";
import StrategyChartPreview from "./StrategyChartPreview";

type Props = {
  strategyId: string;
  /** Bump after strategy chart saves so deviations re-compare against latest cells. */
  strategyRevision?: number;
  /** Show session upload above analysis (editor tab). Default true. */
  showUpload?: boolean;
  /** True while a new upload is in flight — stop showing/running prior analysis. */
  analysisSuspended?: boolean;
  /** Estimated hands from the upload in progress (for the progress counter). */
  pendingHandTotal?: number | null;
  /**
   * Analysis page: heavy HUD/deviations run via analysisJob (survives tab switches).
   * Panel only paints from cache / waits for the job.
   */
  backgroundJobMode?: boolean;
};

function isAbortError(err: unknown) {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

type AnalysisTab = "chart" | "hud" | "preflop" | "recommendations";
type PreflopSubTab = "overview" | "positions" | "branches" | "errors";

type ReplayState =
  | { mode: "stat"; stat: string; label: string }
  | { mode: "hand"; handIds: string[]; startIndex: number; label: string }
  | {
      mode: "hu";
      potKind: string;
      matchup: string;
      label: string;
    };

type ErrorFilter = {
  spotKey?: string | null;
  heroPosition?: string | null;
  villainPosition?: string | null;
  handCode?: string | null;
  /** Constructor matchup tag, e.g. UTGvsBB — matches all spots on that line. */
  matchup?: string | null;
};

function fmtStat(value: number | null | undefined, unit: string) {
  if (value == null || Number.isNaN(value)) return "—";
  if (unit === "ratio") return value.toFixed(2);
  if (unit === "bb100") return `${value.toFixed(1)}`;
  if (unit === "money") return `$${value.toFixed(2)}`;
  if (unit === "count") return String(Math.round(value));
  return `${value.toFixed(1)}%`;
}

function spotLabel(d: StrategyDeviation) {
  if (d.spot_key) {
    return treeMatchupLabel(d.spot_key, d.hero_position, d.villain_position);
  }
  return d.spot_label || "—";
}

function analysisMatchup(
  spotKey: string,
  hero?: string | null,
  villain?: string | null,
  fallback?: string | null,
) {
  const mu = treeMatchupLabel(spotKey, hero, villain);
  if (mu && mu !== "—") return mu;
  const fb = (fallback || "").trim();
  if (!fb) return "—";
  // Strip leading pot words if label was "Raise UTGvsBB".
  return fb.replace(/^(Raise|3-bet|4-bet|Limp|All-in)\s+/i, "") || fb;
}

function freqPct(v: number | null) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function branchKey(b: Pick<PreflopBranchAccuracy, "spot_key" | "hero_position" | "villain_position">) {
  return `${b.spot_key}|${b.hero_position}|${b.villain_position ?? ""}`;
}

function chartKey(c: Pick<ChartErrorSpot, "spot_key" | "hero_position" | "villain_position">) {
  return `${c.spot_key}|${c.hero_position}|${c.villain_position ?? ""}`;
}

function matchupTagsEqual(a: string, b: string) {
  return normalizeMatchupTag(a) === normalizeMatchupTag(b);
}

function matchesFilter(d: StrategyDeviation, f: ErrorFilter, branches: SavedBranch[] = []) {
  if (f.matchup) {
    const branch = branches.find((b) => matchupTagsEqual(b.label, f.matchup!));
    if (branch) {
      if (
        !spotCoveredByBranches(
          {
            spot_key: d.spot_key || "",
            hero_position: d.hero_position || "",
            villain_position: d.villain_position,
          },
          [branch],
        )
      ) {
        return false;
      }
    } else if (
      !matchupTagsEqual(
        treeMatchupLabel(d.spot_key || "", d.hero_position, d.villain_position),
        f.matchup,
      )
    ) {
      return false;
    }
  } else {
    if (f.spotKey && d.spot_key !== f.spotKey) return false;
    if (f.heroPosition && d.hero_position !== f.heroPosition) return false;
    if (
      f.villainPosition != null &&
      f.villainPosition !== "" &&
      d.villain_position !== f.villainPosition
    ) {
      return false;
    }
  }
  if (f.handCode && d.hand_code !== f.handCode) return false;
  return true;
}

function cellsToFreqMap(
  cells: { hand_code: string; raise_freq: string | number; call_freq: string | number; fold_freq: string | number }[],
): Record<string, CellFreq> {
  const out: Record<string, CellFreq> = {};
  for (const c of cells) {
    out[c.hand_code] = {
      raise_freq: Number(c.raise_freq),
      call_freq: Number(c.call_freq),
      fold_freq: Number(c.fold_freq),
    };
  }
  return out;
}

export default function StrategyAnalysisPanel({
  strategyId,
  strategyRevision = 0,
  showUpload = true,
  analysisSuspended: analysisSuspendedProp = false,
  pendingHandTotal = null,
  backgroundJobMode = false,
}: Props) {
  const navigate = useNavigate();
  const [treeTick, setTreeTick] = useState(0);
  const [tab, setTab] = useState<AnalysisTab>("chart");
  const [preflopSub, setPreflopSub] = useState<PreflopSubTab>("overview");
  const cachedBoot = peekAnalysisCache(strategyId);
  const [data, setData] = useState<StrategyAnalysis | null>(
    () => cachedBoot?.analysis ?? null,
  );
  const [devs, setDevs] = useState<StrategyDeviationsResponse | null>(
    () => cachedBoot?.deviations ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);
  // Analysis page (backgroundJobMode): never flash server-style AnalysisCalcProgress on F5.
  const [loading, setLoading] = useState(() => !cachedBoot && !backgroundJobMode);
  const [devsLoading, setDevsLoading] = useState(false);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [uploadTick, setUploadTick] = useState(0);
  const [errorFilter, setErrorFilter] = useState<ErrorFilter>({});
  const [selectedChartKey, setSelectedChartKey] = useState<string | null>(() => {
    const first = cachedBoot?.deviations?.chart_errors?.[0];
    return first ? chartKey(first) : null;
  });
  const [selectedHand, setSelectedHand] = useState<string | null>(null);
  const [strategySpots, setStrategySpots] = useState<StrategySpot[]>(
    () => cachedBoot?.spots ?? [],
  );
  const [strategyChart, setStrategyChart] = useState<Record<string, CellFreq>>({});
  const [strategyChartLoading, setStrategyChartLoading] = useState(false);
  const [spotsHint, setSpotsHint] = useState<string | null>(null);
  const [missingSpots, setMissingSpots] = useState<EnsuredSpotInfo[]>(
    () => cachedBoot?.missing ?? [],
  );
  const [missingLoading, setMissingLoading] = useState(false);
  const [addingSpots, setAddingSpots] = useState(false);
  /** Key of the single branch currently being added, or "all". */
  const [addingSpotKey, setAddingSpotKey] = useState<string | null>(null);
  /** Real hand total for progress UI (sessions + last analysis). */
  const [handTotal, setHandTotal] = useState<number | null>(
    () => cachedBoot?.handTotal ?? cachedBoot?.analysis?.hands ?? null,
  );
  const [calcStep, setCalcStep] = useState(0);
  /** Local suspend when upload is embedded in this panel. */
  const [uploadSuspended, setUploadSuspended] = useState(false);
  /** Bumps only on job status/done — not on every progress tick. */
  const [jobBusy, setJobBusy] = useState(() => isAnalysisJobRunning(strategyId));
  const analysisSuspended = analysisSuspendedProp || uploadSuspended;
  /** Bumps on every start/stop so a stale async pipeline cannot continue. */
  const runGenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refreshKey = strategyRevision + uploadTick;

  const stopAnalysisRun = useCallback(() => {
    runGenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const calcSteps = ["HUD", "Ветки стратегии", "Отклонения от чарта"];
  const [localPendingHands, setLocalPendingHands] = useState<number | null>(null);

  const onUploadStarted = useCallback((estimatedHands?: number) => {
    // Kill in-flight GETs immediately — keep disk cache until upload succeeds.
    stopAnalysisRun();
    if (estimatedHands != null && estimatedHands > 0) {
      setLocalPendingHands(estimatedHands);
      setHandTotal(estimatedHands);
    }
    setUploadSuspended(true);
    markAnalysisUploadStarted(strategyId, estimatedHands);
  }, [stopAnalysisRun, strategyId]);

  const chartGenRef = useRef(0);
  const [chartProgress, setChartProgress] = useState<string | null>(null);

  /** Chart compare module — same pattern as Math tab (recalculate on each open). */
  useEffect(() => {
    if (tab !== "preflop" || !strategyId || analysisSuspended) return;
    const gen = ++chartGenRef.current;
    let cancelled = false;
    setDevsLoading(true);
    setDevError(null);
    setDevs(null);
    setChartProgress("Проверяем стратегию…");

    void buildLocalChartDeviations(strategyId, (message) => {
      if (cancelled || chartGenRef.current !== gen) return;
      setChartProgress(message);
    })
      .then((res) => {
        if (cancelled || chartGenRef.current !== gen) return;
        setDevs(res.deviations);
        setStrategySpots(res.spots);
        if (res.hands > 0) setHandTotal(res.hands);
        const first = res.deviations.chart_errors?.[0];
        setSelectedChartKey(first ? chartKey(first) : null);
        setErrorFilter({});
        setSelectedHand(null);
      })
      .catch((err) => {
        if (cancelled || chartGenRef.current !== gen) return;
        setDevError(err instanceof Error ? err.message : "Не удалось проверить стратегию");
      })
      .finally(() => {
        if (cancelled || chartGenRef.current !== gen) return;
        setDevsLoading(false);
        setChartProgress(null);
      });

    return () => {
      cancelled = true;
    };
  }, [tab, strategyId, analysisSuspended, refreshKey]);

  const onSessionUploaded = useCallback(
    (report: { total_hands?: number } | undefined, id: string) => {
      const sid = id || strategyId;
      clearAnalysisCache(sid);
      clearResultsCache();
      const hands = report?.total_hands && report.total_hands > 0 ? report.total_hands : null;
      if (hands) setLocalPendingHands(hands);
      // Offload heavy work so leaving the tab does not abort analysis.
      startBackgroundAnalysis(sid, hands);
      setUploadSuspended(true);
    },
    [strategyId],
  );

  const onUploadFinished = useCallback((_id: string, ok: boolean) => {
    if (ok) return;
    markAnalysisUploadFailed(_id || strategyId);
    setLocalPendingHands(null);
    setUploadSuspended(false);
    setUploadTick((n) => n + 1);
  }, [strategyId]);

  // Parent suspend (Analysis page upload) — abort before the effect re-runs.
  useEffect(() => {
    if (!analysisSuspendedProp) return;
    stopAnalysisRun();
  }, [analysisSuspendedProp, stopAnalysisRun]);

  // Track background job status only (progress lives in AnalysisBgWait / nav).
  const lastDoneTokenRef = useRef(0);
  useEffect(() => {
    let prevBusy = isAnalysisJobRunning(strategyId);
    setJobBusy(prevBusy);
    return subscribeAnalysisJob(() => {
      const job = getAnalysisJob();
      const busy = isAnalysisJobRunning(strategyId);
      if (busy !== prevBusy) {
        prevBusy = busy;
        setJobBusy(busy);
      }
      if (job.strategyId !== strategyId) return;
      if (job.status === "done" && job.doneToken !== lastDoneTokenRef.current) {
        lastDoneTokenRef.current = job.doneToken;
        setLocalPendingHands(null);
        setUploadSuspended(false);
        setJobBusy(false);
        setUploadTick((n) => n + 1);
      } else if (job.status === "error") {
        setLocalPendingHands(null);
        setUploadSuspended(false);
        setJobBusy(false);
        setError(job.error || "Ошибка анализа");
        setLoading(false);
        setDevsLoading(false);
      }
    });
  }, [strategyId]);

  const reloadMissingSpots = useCallback(async () => {
    setMissingLoading(true);
    try {
      // Pull constructor tree first so existing branches aren't listed as missing.
      const treeDoc = await resolveConstructorTree(strategyId);
      setTreeTick((n) => n + 1);
      const editorBranches = collectEditorBranches(treeDoc.root);
      // Local IndexedDB session is source of truth for “нет в стратегии”.
      const localHands = await listHandsForStrategy(strategyId);
      if (localHands.length > 0) {
        setMissingSpots(await listMissingSpotsLocal(strategyId, editorBranches));
        return;
      }
      const res = await fetchMissingSpots(strategyId);
      const branches = editorBranches;
      setMissingSpots(
        !branches.length
          ? res.missing
          : res.missing.filter(
              (s) =>
                !coveredByConstructorTags(
                  {
                    spot_key: s.spot_key,
                    hero_position: s.hero_position,
                    villain_position: s.villain_position,
                  },
                  branches,
                ),
            ),
      );
    } catch {
      try {
        setMissingSpots(await listMissingSpotsLocal(strategyId));
      } catch {
        setMissingSpots([]);
      }
    } finally {
      setMissingLoading(false);
    }
  }, [strategyId]);

  function missingKey(s: EnsuredSpotInfo) {
    return `${s.spot_key}|${s.hero_position}|${s.villain_position ?? ""}`;
  }

  /** Already filtered vs constructor in reloadMissingSpots. */
  const uncoveredMissing = missingSpots;

  const addOneMissingSpot = useCallback(
    async (spot: EnsuredSpotInfo) => {
      if (addingSpots) return;
      const key = missingKey(spot);
      setAddingSpots(true);
      setAddingSpotKey(key);
      try {
        await createSpot(strategyId, {
          spot_key: spot.spot_key,
          hero_position: spot.hero_position,
          villain_position: spot.villain_position,
          label: spot.label || undefined,
        });
        const focus = seedSpotIntoTree(strategyId, spot);
        clearAnalysisCache(strategyId);
        if (focus) stashEditorFocus(strategyId, focus);
        navigate(`/strategies/${strategyId}`);
      } catch (err: unknown) {
        setSpotsHint(
          err instanceof Error ? err.message : "Не удалось добавить ветку",
        );
        setAddingSpots(false);
        setAddingSpotKey(null);
      }
    },
    [addingSpots, navigate, strategyId],
  );

  // Cache hit → show instantly. Full recompute only when hands/cache miss (new upload).
  useEffect(() => {
    setError(null);
    setDevError(null);
    setSpotsHint(null);
    setCalcStep(0);
    setStrategyChart({});
    setReplay(null);

    const applyCached = (cached: AnalysisCachePayload) => {
      setData(cached.analysis);
      setDevs(cached.deviations);
      setStrategySpots(cached.spots);
      setMissingSpots(cached.missing);
      setHandTotal(cached.handTotal || cached.analysis.hands);
      const first = cached.deviations.chart_errors?.[0];
      setSelectedChartKey(first ? chartKey(first) : null);
      setErrorFilter({});
      setSelectedHand(null);
      setLoading(false);
      setDevsLoading(false);
    };

    if (analysisSuspended || isAnalysisJobRunning(strategyId)) {
      stopAnalysisRun();
      setLoading(true);
      setDevsLoading(true);
      setData(null);
      setDevs(null);
      setStrategySpots([]);
      setMissingSpots([]);
      setSelectedChartKey(null);
      setSelectedHand(null);
      setErrorFilter({});
      return;
    }

    // One live pipeline only — supersede any previous generation.
    abortRef.current?.abort();
    const runId = ++runGenRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const isStale = () => signal.aborted || runId !== runGenRef.current;

    // Paint last result immediately — F5 must not look like a new analysis job.
    const peek = peekAnalysisCache(strategyId);
    if (peek) {
      applyCached(peek);
    } else if (!backgroundJobMode) {
      setLoading(true);
      setDevsLoading(true);
      setData(null);
      setDevs(null);
      setStrategySpots([]);
      setMissingSpots([]);
      setSelectedChartKey(null);
      setSelectedHand(null);
      setErrorFilter({});
    }

    void (async () => {
      try {
        // Local analysis page: show the same report as after upload (from cache / IDB).
        if (backgroundJobMode) {
          const localReport = peekAnalysisCache(strategyId);
          if (localReport && !isStale()) {
            applyCached(localReport);
            return;
          }
          if (isAnalysisJobRunning(strategyId)) return;

          // Cache miss — rebuild HUD from IndexedDB and show the normal analysis UI.
          try {
            const rows = await listHandsForStrategy(strategyId);
            if (isStale()) return;
            if (rows.length > 0) {
              setHandTotal(rows.length);
              await restoreLocalSessionReport(strategyId);
              if (isStale()) return;
              const restored = peekAnalysisCache(strategyId);
              if (restored) {
                applyCached(restored);
                return;
              }
            }
          } catch {
            /* empty */
          }
          if (!isStale()) {
            setLoading(false);
            setDevsLoading(false);
            if (!peek) {
              setData(null);
              setDevs(null);
            }
          }
          return;
        }

        const sessions = await listSessions(signal).catch((err) => {
          if (isAbortError(err) || signal.aborted) throw err;
          return [] as Awaited<ReturnType<typeof listSessions>>;
        });
        if (isStale()) return;
        const fp = analysisFingerprint(strategyId, sessions);
        const handsFromSessions = sessions
          .filter(
            (s) =>
              s.strategy_id === strategyId &&
              (s.status === "active" || !s.status),
          )
          .reduce((sum, s) => sum + (s.hands_count || 0), 0);
        if (handsFromSessions > 0) setHandTotal(handsFromSessions);

        // Prefer local PC report (fingerprint local:...) over server session fingerprint.
        const localPeek = peekAnalysisCache(strategyId);
        const cached =
          (localPeek?.fingerprint?.startsWith("local:") ? localPeek : null) ||
          readAnalysisCache(strategyId, fp);
        if (cached) {
          if (isStale()) return;
          applyCached(cached);
          if (handsFromSessions > 0 || cached.handTotal) {
            setHandTotal(cached.handTotal || cached.analysis.hands || handsFromSessions);
          }
          if (!cached.fingerprint.startsWith("local:")) {
            void warmHandDbAndResultsCache();
          }
          return;
        }

        // Background job owns the heavy work after upload — never auto-start
        // another run from this effect (that froze the site in a reload loop).
        if (isAnalysisJobRunning(strategyId)) {
          if (!isStale()) {
            setLoading(true);
            setDevsLoading(true);
          }
          return;
        }

        // Hands changed or no cache — full pipeline (show progress).
        if (!isStale()) {
          setLoading(true);
          setDevsLoading(true);
          if (!peek) {
            setData(null);
            setDevs(null);
          }
          setCalcStep(0);
        }
        const analysis = await fetchStrategyAnalysis(strategyId, signal);
        if (isStale()) return;
        if (analysis.hands > 0) setHandTotal(analysis.hands);

        if (!isStale()) setCalcStep(1);
        const [spots, missingLocal] = await Promise.all([
          listSpots(strategyId, signal),
          listMissingSpotsLocal(strategyId).catch(() => [] as EnsuredSpotInfo[]),
        ]);
        if (isStale()) return;

        if (!isStale()) setCalcStep(2);
        const res = await fetchStrategyDeviations(strategyId, 300, signal);
        if (isStale()) return;

        setData(analysis);
        setStrategySpots(spots);
        setMissingSpots(missingLocal);
        setDevs(res);
        const first = res.chart_errors?.[0];
        setSelectedChartKey(first ? chartKey(first) : null);
        setErrorFilter({});
        setSelectedHand(null);

        writeAnalysisCache(strategyId, {
          fingerprint: fp,
          analysis,
          deviations: res,
          spots,
          missing: missingLocal,
          handTotal: analysis.hands || handsFromSessions,
        });
        // Warm career/schedule cache so report opens instantly.
        void warmHandDbAndResultsCache();
      } catch (err: unknown) {
        if (isStale() || isAbortError(err)) return;
        const msg =
          err instanceof Error ? err.message : "Не удалось загрузить анализ";
        setError(msg);
        setDevError(msg);
      } finally {
        if (!isStale()) {
          setLoading(false);
          setDevsLoading(false);
        }
      }
    })();

    return () => {
      if (abortRef.current === controller) {
        controller.abort();
        abortRef.current = null;
      } else {
        controller.abort();
      }
    };
  }, [
    strategyId,
    refreshKey,
    analysisSuspended,
    stopAnalysisRun,
    backgroundJobMode,
  ]);

  // Refresh session branches when opening «Ветки»
  useEffect(() => {
    if (tab !== "preflop" || preflopSub !== "branches" || loading) return;
    void reloadMissingSpots();
  }, [tab, preflopSub, strategyId, refreshKey, loading, reloadMissingSpots]);

  // Hydrate constructor tree (cache path may skip chart sync).
  useEffect(() => {
    let cancelled = false;
    void resolveConstructorTree(strategyId)
      .then(() => {
        if (!cancelled) setTreeTick((n) => n + 1);
      })
      .catch(() => {
        /* offline */
      });
    return () => {
      cancelled = true;
    };
  }, [strategyId, refreshKey, strategyRevision]);

  // Re-read constructor tree when returning from the editor (deleted branches).
  useEffect(() => {
    const bump = () => setTreeTick((n) => n + 1);
    const onVis = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const paintedTreeBranches = useMemo(() => {
    try {
      return collectAnalysisBranches(loadTree(strategyId).root);
    } catch {
      return [];
    }
  }, [strategyId, refreshKey, strategyRevision, treeTick]);

  const hasPlayCharts = useMemo(
    () => strategyHasPlayCharts(strategyId),
    [strategyId, refreshKey, strategyRevision, treeTick, paintedTreeBranches.length],
  );

  /** Drop cached matchups that are no longer in the constructor. */
  const liveDevs = useMemo(() => {
    if (!devs) return null;
    // No painted branch list yet — still show synced-spot scoring (0/0 only if none).
    if (!paintedTreeBranches.length) {
      return {
        ...devs,
        total: (devs.deviations ?? []).length,
      };
    }
    const coverOpts = { strictOpen: true } as const;
    const covers = (
      spot: {
        spot_key: string;
        hero_position: string;
        villain_position?: string | null;
      },
      label?: string | null,
    ) =>
      paintedTreeBranches.some(
        (b) =>
          (label != null &&
            label !== "" &&
            matchupTagsEqual(b.label, label)) ||
          spotCoveredByBranches(spot, [b], coverOpts) ||
          coveredByConstructorTags(spot, [b]),
      );
    const by_branch = (devs.by_branch ?? []).filter((row) =>
      covers(
        {
          spot_key: row.spot_key,
          hero_position: row.hero_position,
          villain_position: row.villain_position,
        },
        row.matchup || row.spot_label,
      ),
    );
    const chart_errors = (devs.chart_errors ?? []).filter((c) =>
      covers(
        {
          spot_key: c.spot_key,
          hero_position: c.hero_position,
          villain_position: c.villain_position,
        },
        c.label,
      ),
    );
    const deviations = (devs.deviations ?? []).filter((d) =>
      covers({
        spot_key: d.spot_key || "",
        hero_position: d.hero_position || "",
        villain_position: d.villain_position,
      }),
    );
    return {
      ...devs,
      by_branch,
      chart_errors,
      deviations,
      // Overview KPI must match Errors tab (not stale cache from deleted branches).
      total: deviations.length,
    };
  }, [devs, paintedTreeBranches]);

  const filteredDevs = useMemo(() => {
    if (!liveDevs) return [];
    return liveDevs.deviations.filter((d) =>
      matchesFilter(d, errorFilter, paintedTreeBranches),
    );
  }, [liveDevs, errorFilter, paintedTreeBranches]);

  const activeChart = useMemo(() => {
    if (!liveDevs?.chart_errors?.length) return null;
    if (selectedChartKey) {
      const hit = liveDevs.chart_errors.find(
        (c) => chartKey(c) === selectedChartKey || c.label === selectedChartKey,
      );
      if (hit) return hit;
    }
    return liveDevs.chart_errors[0];
  }, [liveDevs, selectedChartKey]);

  // Load strategy spots when viewing Errors (for side-by-side chart).
  useEffect(() => {
    if (tab !== "preflop" || preflopSub !== "errors") return;
    let cancelled = false;
    void listSpots(strategyId)
      .then((spots) => {
        if (!cancelled) setStrategySpots(spots);
      })
      .catch(() => {
        if (!cancelled) setStrategySpots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [strategyId, tab, preflopSub, refreshKey]);

  // Load strategy cells for the selected error chart — prefer scored spot_id.
  useEffect(() => {
    if (!activeChart) {
      setStrategyChart({});
      return;
    }
    let cancelled = false;
    setStrategyChartLoading(true);
    void (async () => {
      try {
        // 1) Exact painted spot used for scoring (survives strategy switch / empty shells)
        if (activeChart.spot_id) {
          const cells = await listCells(activeChart.spot_id);
          if (cancelled) return;
          const map = cellsToFreqMap(cells);
          if (isChartPainted(map)) {
            setStrategyChart(map);
            return;
          }
        }

        // 2) Fallback: resolve among current strategy spots (aliases / parents)
        const candidates = strategySpotCandidates(
          strategySpots,
          activeChart.spot_key,
          activeChart.hero_position,
          activeChart.villain_position,
        );
        for (const spot of candidates) {
          if (spot.id === activeChart.spot_id) continue;
          const cells = await listCells(spot.id);
          if (cancelled) return;
          const map = cellsToFreqMap(cells);
          if (isChartPainted(map)) {
            setStrategyChart(map);
            return;
          }
        }
        if (!cancelled) setStrategyChart({});
      } catch {
        if (!cancelled) setStrategyChart({});
      } finally {
        if (!cancelled) setStrategyChartLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChart, strategySpots]);

  const uploadBlock = showUpload ? (
    <div className="analysis-upload">
      <SessionUploadPanel
        strategyId={strategyId}
        compact
        importMode="server"
        onUploadStarted={(_id, estimatedHands) => onUploadStarted(estimatedHands)}
        onUploadFinished={onUploadFinished}
        onUploaded={(report, id) => onSessionUploaded(report, id)}
      />
    </div>
  ) : null;

  const waitingOnBgJob = analysisSuspended || jobBusy || uploadSuspended;

  if (waitingOnBgJob) {
    return (
      <AnalysisBgWait
        uploadBlock={uploadBlock}
        pendingHands={pendingHandTotal ?? localPendingHands ?? handTotal}
      />
    );
  }

  if (loading && !backgroundJobMode) {
    const progressHands =
      pendingHandTotal ?? localPendingHands ?? handTotal ?? data?.hands ?? null;
    return (
      <div className="analysis-panel">
        {uploadBlock}
        <AnalysisCalcProgress
          title="Анализ сессии"
          steps={calcSteps}
          stepIndex={calcStep}
          totalHands={progressHands}
          jobKey={`${strategyId}-${refreshKey}`}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="analysis-panel">
        {uploadBlock}
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!data || data.hands === 0) {
    return (
      <div className="analysis-panel">
        {uploadBlock}
        <div className="analysis-empty panel">
          <h2>Нет раздач для анализа</h2>
          <p className="muted">
            {showUpload
              ? "Загрузи txt-сессию выше — появятся VPIP, PFR, график профита и сверка со стратегией."
              : "Загрузи историю сессии — здесь появятся график и HUD."}
          </p>
        </div>
      </div>
    );
  }

  const byKey = Object.fromEntries(data.stats.map((s) => [s.key, s]));

  function openStat(stat: string, label: string) {
    setReplay({ mode: "stat", stat, label });
  }

  function openHuPot(potKind: string, matchup: string, label: string) {
    setReplay({
      mode: "hu",
      potKind,
      matchup,
      label,
    });
  }

  function openErrorReplay(startFrom?: StrategyDeviation) {
    const list = filteredDevs.length > 0 ? filteredDevs : (liveDevs?.deviations ?? []);
    if (list.length === 0) return;
    const startIndex = startFrom
      ? Math.max(
          0,
          list.findIndex((d) => d.id === startFrom.id || d.hand_id === startFrom.hand_id),
        )
      : 0;
    setReplay({
      mode: "hand",
      handIds: list.map((d) => d.hand_id),
      startIndex: startIndex < 0 ? 0 : startIndex,
      label: `Ошибки префлопа · ${list.length}`,
    });
  }

  function openHand(d: StrategyDeviation) {
    openErrorReplay(d);
  }

  function goErrors(filter: ErrorFilter, chart?: ChartErrorSpot | null) {
    setErrorFilter(filter);
    setSelectedHand(filter.handCode ?? null);
    if (chart) setSelectedChartKey(chart.label || chartKey(chart));
    else if (filter.matchup) setSelectedChartKey(filter.matchup);
    else if (filter.spotKey && filter.heroPosition) {
      setSelectedChartKey(
        `${filter.spotKey}|${filter.heroPosition}|${filter.villainPosition ?? ""}`,
      );
    }
    setPreflopSub("errors");
  }

  function renderPreflopBody() {
    if (!liveDevs || !devs) return null;

    if (preflopSub === "overview") {
      const errTotal = liveDevs.total ?? liveDevs.deviations.length;
      const scored = (liveDevs.decisions ?? 0) > 0;
      return (
        <>
          <div className="analysis-kpis strategy-dev-kpis">
            <div className="analysis-kpi">
              <span>Всего верно</span>
              <strong
                className={
                  !scored
                    ? "muted"
                    : (liveDevs.correct_pct ?? 100) >= 80
                      ? "pos"
                      : "neg"
                }
              >
                {scored ? `${(liveDevs.correct_pct ?? 100).toFixed(1)}%` : "—"}
              </strong>
              <em>
                {scored
                  ? `${liveDevs.correct ?? 0} из ${liveDevs.decisions ?? 0} решений`
                  : "нет сверки без чартов"}
              </em>
            </div>
            <div className="analysis-kpi">
              <span>опен рейз</span>
              <strong
                className={
                  !scored
                    ? "muted"
                    : (liveDevs.open_pct ?? 100) >= 80
                      ? "pos"
                      : "neg"
                }
              >
                {scored ? `${(liveDevs.open_pct ?? 100).toFixed(1)}%` : "—"}
              </strong>
              <em>
                {liveDevs.open_correct ?? 0} из {liveDevs.open_decisions ?? 0}
              </em>
            </div>
            <div className="analysis-kpi">
              <span>Розыгрыш</span>
              <strong
                className={
                  !scored
                    ? "muted"
                    : (liveDevs.play_pct ?? 100) >= 80
                      ? "pos"
                      : "neg"
                }
              >
                {scored ? `${(liveDevs.play_pct ?? 100).toFixed(1)}%` : "—"}
              </strong>
              <em>
                {liveDevs.play_correct ?? 0} из {liveDevs.play_decisions ?? 0} vs open / 3-bet…
              </em>
            </div>
            <button
              type="button"
              className="analysis-kpi clickable"
              onClick={() => goErrors({})}
              disabled={!scored}
            >
              <span>Ошибки</span>
              <strong className={errTotal > 0 ? "neg" : scored ? "pos" : "muted"}>
                {scored ? errTotal : "—"}
              </strong>
              <em>отклонений от чарта</em>
            </button>
          </div>

          {liveDevs.opens && (
            <div className="preflop-open-detail">
              <h3 className="analysis-subhead">Открытия подробно</h3>
              <p className="muted analysis-chart-hint">
                По факту: открыл {liveDevs.opens.opened}, не открыл (fold) {liveDevs.opens.folded}
                {liveDevs.opens.called > 0 ? `, call/limp ${liveDevs.opens.called}` : ""} — всего{" "}
                {liveDevs.opens.decisions} RFI-решений.
              </p>
              <div className="analysis-kpis strategy-dev-kpis">
                <div className="analysis-kpi">
                  <span>Чарт: открывать</span>
                  <strong>{liveDevs.opens.should_open}</strong>
                  <em>
                    открыл верно {liveDevs.opens.opened_correct} · пропустил{" "}
                    <span className={liveDevs.opens.missed_opens > 0 ? "neg" : ""}>
                      {liveDevs.opens.missed_opens}
                    </span>
                  </em>
                </div>
                <div className="analysis-kpi">
                  <span>Следование open</span>
                  <strong className={liveDevs.opens.open_follow_pct >= 80 ? "pos" : "neg"}>
                    {liveDevs.opens.open_follow_pct.toFixed(1)}%
                  </strong>
                  <em>когда чарт хотел raise</em>
                </div>
                <div className="analysis-kpi">
                  <span>Чарт: фолдить</span>
                  <strong>{liveDevs.opens.should_fold}</strong>
                  <em>
                    сфолдил верно {liveDevs.opens.folded_correct} · ошибочно открыл{" "}
                    <span className={liveDevs.opens.wrong_opens > 0 ? "neg" : ""}>
                      {liveDevs.opens.wrong_opens}
                    </span>
                  </em>
                </div>
                <div className="analysis-kpi">
                  <span>Следование fold</span>
                  <strong className={liveDevs.opens.fold_follow_pct >= 80 ? "pos" : "neg"}>
                    {liveDevs.opens.fold_follow_pct.toFixed(1)}%
                  </strong>
                  <em>когда чарт хотел fold</em>
                </div>
              </div>
            </div>
          )}

        </>
      );
    }

    if (preflopSub === "positions") {
      const rows = devs.by_position ?? [];
      if (rows.length === 0) {
        return (
          <p className="muted">
            Нет RFI-решений по позициям — нужны раздачи и чарт открытий в стратегии.
          </p>
        );
      }
      return (
        <>
          <p className="muted analysis-chart-hint">
            С какой позиции открывал / не открывал относительно чарта RFI. Клик по строке → ошибки
            этой позиции.
          </p>
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>Поз.</th>
                  <th>Реш.</th>
                  <th>Открыл</th>
                  <th>Fold</th>
                  <th>Should open</th>
                  <th>Missed</th>
                  <th>Wrong open</th>
                  <th>Точность</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.position}
                    className="clickable-row"
                    onClick={() =>
                      goErrors({ spotKey: "rfi", heroPosition: row.position })
                    }
                  >
                    <td>
                      <strong>{row.position}</strong>
                    </td>
                    <td>{row.decisions}</td>
                    <td>{row.opened}</td>
                    <td>{row.folded}</td>
                    <td>{row.should_open}</td>
                    <td className={row.missed_opens > 0 ? "neg" : ""}>{row.missed_opens}</td>
                    <td className={row.wrong_opens > 0 ? "neg" : ""}>{row.wrong_opens}</td>
                    <td className={row.accuracy_pct >= 80 ? "pos" : "neg"}>
                      {row.accuracy_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }

    if (preflopSub === "branches") {
      const rows = liveDevs.by_branch ?? [];
      const huRows = liveDevs.hu_pot_branches ?? [];
      const losing = [...huRows]
        .filter((r) => (r.profit_money ?? 0) < -0.001)
        .slice(0, 5);
      const winning = [...huRows]
        .filter((r) => (r.profit_money ?? 0) > 0.001)
        .sort((a, b) => (b.profit_money ?? 0) - (a.profit_money ?? 0))
        .slice(0, 5);

      return (
        <>
          <p className="muted analysis-chart-hint">
            Профит только HU после флопа (ровно 2 игрока): тег пота и матчап{" "}
            <strong>BBvsSB</strong>. Кликни матчап — откроются раздачи. Ниже —
            точность по чартам стратегии.
          </p>

          {huRows.length === 0 && rows.length === 0 ? (
            <p className="muted">
              Нет веток для анализа — задай чарты в стратегии (или примени стиль в редакторе) и
              загрузи раздачи.
            </p>
          ) : (
            <>
              {(losing.length > 0 || winning.length > 0) && (
                <div className="branch-pl-block analysis-branch-pl">
                  <div className="branch-pl-col">
                    <h2>Убыточные HU</h2>
                    <ul className="branch-pl-list">
                      {losing.length === 0 ? (
                        <li className="muted">Нет убыточных потов.</li>
                      ) : (
                        losing.map((b) => (
                          <li key={`lose-${b.pot_kind}-${b.matchup}`}>
                            <button
                              type="button"
                              className="branch-pl-row-btn"
                              onClick={() =>
                                openHuPot(
                                  b.pot_kind ?? "srp",
                                  b.matchup || b.label,
                                  `${b.matchup || b.label} · ${b.hands_count} рук`,
                                )
                              }
                            >
                              <span className="branch-pl-label">
                                <em className={`pot-tag pot-${b.pot_kind ?? "srp"}`}>
                                  {b.matchup || b.label}
                                </em>
                              </span>
                              <span className="branch-pl-meta">
                                <em>{b.hands_count} рук</em>
                                <strong className="neg">
                                  ${b.profit_money.toFixed(2)}
                                </strong>
                                <span className="muted">{b.profit_bb.toFixed(1)} bb</span>
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div className="branch-pl-col">
                    <h2>Прибыльные HU</h2>
                    <ul className="branch-pl-list">
                      {winning.length === 0 ? (
                        <li className="muted">Нет прибыльных потов.</li>
                      ) : (
                        winning.map((b) => (
                          <li key={`win-${b.pot_kind}-${b.matchup}`}>
                            <button
                              type="button"
                              className="branch-pl-row-btn"
                              onClick={() =>
                                openHuPot(
                                  b.pot_kind ?? "srp",
                                  b.matchup || b.label,
                                  `${b.matchup || b.label} · ${b.hands_count} рук`,
                                )
                              }
                            >
                              <span className="branch-pl-label">
                                <em className={`pot-tag pot-${b.pot_kind ?? "srp"}`}>
                                  {b.matchup || b.label}
                                </em>
                              </span>
                              <span className="branch-pl-meta">
                                <em>{b.hands_count} рук</em>
                                <strong className="pos">
                                  ${b.profit_money.toFixed(2)}
                                </strong>
                                <span className="muted">{b.profit_bb.toFixed(1)} bb</span>
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              )}

              {huRows.length > 0 ? (
                <div className="analysis-table-wrap">
                  <table className="analysis-table">
                    <thead>
                      <tr>
                        <th>Матчап</th>
                        <th>Рук</th>
                        <th>Профит $</th>
                        <th>bb</th>
                        <th>bb/100</th>
                      </tr>
                    </thead>
                    <tbody>
                      {huRows.map((row) => (
                        <tr
                          key={`hu-${row.pot_kind}-${row.matchup}`}
                          className="clickable-row"
                          onClick={() =>
                            openHuPot(
                              row.pot_kind ?? "srp",
                              row.matchup || row.label,
                              `${row.matchup || row.label} · ${row.hands_count} рук`,
                            )
                          }
                        >
                          <td>
                            <em className={`pot-tag pot-${row.pot_kind ?? "srp"}`}>
                              {row.matchup || row.label}
                            </em>
                          </td>
                          <td>{row.hands_count}</td>
                          <td className={row.profit_money >= 0 ? "pos" : "neg"}>
                            ${row.profit_money.toFixed(2)}
                          </td>
                          <td className={row.profit_bb >= 0 ? "pos" : "neg"}>
                            {row.profit_bb.toFixed(1)}
                          </td>
                          <td className={row.winrate_bb100 >= 0 ? "pos" : "neg"}>
                            {row.winrate_bb100.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">Нет HU-потов после флопа за период стратегии.</p>
              )}

              {rows.length > 0 ? (
                <>
                  <p className="muted analysis-chart-hint" style={{ marginTop: "1.25rem" }}>
                    Точность по чартам (клик → ошибки ветки).
                  </p>
                  <div className="analysis-table-wrap">
                    <table className="analysis-table">
                      <thead>
                        <tr>
                          <th>Матчап</th>
                          <th>Реш.</th>
                          <th>Точность</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const mu = analysisMatchup(
                            row.spot_key,
                            row.hero_position,
                            row.villain_position,
                            row.matchup || row.spot_label,
                          );
                          const potKind = spotPotKind(row.spot_key);
                          return (
                          <tr
                            key={branchKey(row)}
                            className="clickable-row"
                            onClick={() =>
                              goErrors({
                                matchup: mu,
                              })
                            }
                          >
                            <td>
                              <span className="err-chart-tags">
                                <strong className="err-chart-matchup">{mu}</strong>
                                <em className={`pot-tag pot-${potKind}`}>{potKindTag(potKind)}</em>
                              </span>
                            </td>
                            <td>{row.decisions}</td>
                            <td className={row.correct_pct >= 80 ? "pos" : "neg"}>
                              {row.correct_pct.toFixed(1)}%
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          )}

          <div className="missing-spots-panel">
            <div className="missing-spots-head">
              <div>
                <strong>Нет в стратегии</strong>
                <p className="muted">
                  Матчапы из раздач без такого же тега в конструкторе (как в списке веток).
                </p>
              </div>
            </div>
            {missingLoading ? (
              <p className="muted">Проверяем раздачи…</p>
            ) : uncoveredMissing.length > 0 ? (
              <ul className="missing-spots-list">
                {[...uncoveredMissing]
                  .sort(
                    (a, b) =>
                      (a.profit_money ?? 0) - (b.profit_money ?? 0) ||
                      (b.hands_count ?? 0) - (a.hands_count ?? 0),
                  )
                  .map((s) => {
                    const key = missingKey(s);
                    const busy = addingSpotKey === key;
                    const pl = s.profit_money ?? 0;
                    const mu = treeMatchupLabel(
                      s.spot_key,
                      s.hero_position,
                      s.villain_position,
                    );
                    const potKind = spotPotKind(s.spot_key);
                    return (
                      <li key={key}>
                        <div className="missing-spot-main">
                          <span className="err-chart-tags">
                            <strong className="err-chart-matchup">{mu}</strong>
                            <em className={`pot-tag pot-${potKind}`}>
                              {potKindTag(potKind)}
                            </em>
                          </span>
                          <span className="missing-spot-tag">нет чарта</span>
                          <em>{(s.hands_count ?? 0).toLocaleString("ru-RU")} разд.</em>
                          <em className={pl >= 0 ? "pos" : "neg"}>
                            ${pl.toFixed(2)}
                          </em>
                        </div>
                        <button
                          type="button"
                          className="missing-spot-add"
                          disabled={addingSpots}
                          onClick={() => void addOneMissingSpot(s)}
                        >
                          {busy ? "…" : "Добавить"}
                        </button>
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="muted">Все матчапы из сессии уже есть в стратегии.</p>
            )}
          </div>
        </>
      );
    }

    // errors
    const charts = liveDevs.chart_errors ?? [];
    const filterActive =
      errorFilter.spotKey ||
      errorFilter.heroPosition ||
      errorFilter.handCode ||
      errorFilter.villainPosition ||
      errorFilter.matchup;

    return (
      <>
        <div className="preflop-errors-toolbar">
          <p className="muted analysis-chart-hint">
            Ошибки по чартам. Реплей листает все раздачи из списка (↑/↓ или кнопки Пред./След.).
          </p>
          <div className="preflop-errors-actions">
            {filteredDevs.length > 0 ? (
              <button
                type="button"
                className="preflop-filter-clear"
                onClick={() => openErrorReplay()}
              >
                Реплей всех · <span className="err-count">{filteredDevs.length}</span>
              </button>
            ) : null}
            {filterActive ? (
              <button
                type="button"
                className="preflop-filter-clear"
                onClick={() => {
                  setErrorFilter({});
                  setSelectedHand(null);
                }}
              >
                Сбросить фильтр
              </button>
            ) : null}
          </div>
        </div>

        <div className="preflop-errors-layout">
          <aside className="preflop-chart-list">
            <h3 className="analysis-subhead">Чарты</h3>
            {charts.length === 0 ? (
              <p className="muted">Нет ошибок для матрицы.</p>
            ) : (
              <ul>
                {charts.map((c) => {
                  const key = c.label || chartKey(c);
                  const mu = c.label || analysisMatchup(
                    c.spot_key,
                    c.hero_position,
                    c.villain_position,
                    c.label,
                  );
                  const branch = paintedTreeBranches.find((b) =>
                    matchupTagsEqual(b.label, mu),
                  );
                  const errCount = (liveDevs.deviations ?? []).filter((d) => {
                    if (branch) {
                      return spotCoveredByBranches(
                        {
                          spot_key: d.spot_key || "",
                          hero_position: d.hero_position || "",
                          villain_position: d.villain_position,
                        },
                        [branch],
                      );
                    }
                    return (
                      d.spot_key === c.spot_key &&
                      d.hero_position === c.hero_position &&
                      (d.villain_position ?? null) === (c.villain_position ?? null)
                    );
                  }).length;
                  const potKind = branch?.potKind ?? spotPotKind(c.spot_key);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={
                          selectedChartKey === key || selectedChartKey === chartKey(c)
                            ? "is-active"
                            : ""
                        }
                        onClick={() => {
                          setSelectedChartKey(key);
                          setErrorFilter({ matchup: mu });
                          setSelectedHand(null);
                        }}
                      >
                        <span className="err-chart-tags">
                          <strong className="err-chart-matchup">{mu}</strong>
                          <em className={`pot-tag pot-${potKind}`}>{potKindTag(potKind)}</em>
                        </span>
                        {errCount > 0 ? <em className="err-count">{errCount}</em> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <div className="preflop-chart-main">
            {activeChart ? (
              <>
                <h3 className="analysis-subhead">
                  <span className="err-chart-tags">
                    <strong className="err-chart-matchup">
                      {activeChart.label ||
                        analysisMatchup(
                          activeChart.spot_key,
                          activeChart.hero_position,
                          activeChart.villain_position,
                          activeChart.label,
                        )}
                    </strong>
                    <em
                      className={`pot-tag pot-${
                        paintedTreeBranches.find((b) =>
                          matchupTagsEqual(b.label, activeChart.label),
                        )?.potKind ??
                        spotPotKind(activeChart.spot_key)
                      }`}
                    >
                      {potKindTag(
                        paintedTreeBranches.find((b) =>
                          matchupTagsEqual(b.label, activeChart.label),
                        )?.potKind ??
                          spotPotKind(activeChart.spot_key),
                      )}
                    </em>
                  </span>
                </h3>
                <div className="preflop-chart-compare">
                  <div className="preflop-chart-pane">
                    <header>
                      <strong>Стратегия</strong>
                      <span>raise / call / fold</span>
                    </header>
                    {strategyChartLoading ? (
                      <p className="muted">Загружаем чарт…</p>
                    ) : (
                      <StrategyChartPreview
                        cells={strategyChart}
                        selected={selectedHand}
                        onSelectHand={(code) => {
                          setSelectedHand(code);
                          setErrorFilter({
                            spotKey: activeChart.spot_key,
                            heroPosition: activeChart.hero_position,
                            villainPosition: activeChart.villain_position,
                            handCode: code,
                          });
                        }}
                      />
                    )}
                  </div>
                  <div className="preflop-chart-pane">
                    <header>
                      <strong>Ошибки</strong>
                      <span>raise / call / fold · счётчик</span>
                    </header>
                    <DeviationErrorMatrix
                      cells={activeChart.cells}
                      selectedHand={selectedHand}
                      onSelectHand={(code) => {
                        setSelectedHand(code);
                        setErrorFilter({
                          spotKey: activeChart.spot_key,
                          heroPosition: activeChart.hero_position,
                          villainPosition: activeChart.villain_position,
                          handCode: code,
                        });
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <p className="muted">Выбери чарт слева.</p>
            )}
          </div>
        </div>

        <h3 className="analysis-subhead">
          Список ошибок
          <span className="err-count">
            {filterActive ? ` · ${filteredDevs.length}` : ` · ${liveDevs.deviations.length}`}
          </span>
        </h3>
        {filteredDevs.length === 0 ? (
          <p className="muted">
            {liveDevs.deviations.length === 0
              ? "Ошибок нет — все префлоп-решения совпали с чартами."
              : "Нет ошибок по текущему фильтру."}
          </p>
        ) : (
          <div className="analysis-table-wrap">
            <table className="analysis-table deviation-table strategy-dev-table">
              <thead>
                <tr>
                  <th>Рука</th>
                  <th>Матчап</th>
                  <th>Сыграл</th>
                  <th>Ожидалось</th>
                  <th>%</th>
                  <th>Sev</th>
                  <th>bb</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevs.map((d) => (
                  <tr
                    key={d.id}
                    className="clickable-row"
                    onClick={() => openHand(d)}
                    title="Открыть реплей"
                  >
                    <td>
                      <strong>{d.hand_code}</strong>
                      {d.external_hand_id && (
                        <em className="dev-hand-id">#{d.external_hand_id}</em>
                      )}
                    </td>
                    <td>
                      <span className="err-chart-tags">
                        <strong className="err-chart-matchup">{spotLabel(d)}</strong>
                        <em className={`pot-tag pot-${spotPotKind(d.spot_key || "rfi")}`}>
                          {potKindTag(spotPotKind(d.spot_key || "rfi"))}
                        </em>
                      </span>
                    </td>
                    <td className={`act ${d.actual_action}`}>{d.actual_action}</td>
                    <td className={`act ${d.expected_action}`}>{d.expected_action}</td>
                    <td>{freqPct(d.expected_freq)}</td>
                    <td>{d.severity == null ? "—" : d.severity.toFixed(2)}</td>
                    <td className={d.hero_net_bb >= 0 ? "pos" : "neg"}>
                      {d.hero_net_bb >= 0 ? "+" : ""}
                      {d.hero_net_bb.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="analysis-panel">
      {uploadBlock}
      <div className="analysis-tabs" role="tablist" aria-label="Разделы анализа">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "chart"}
          className={tab === "chart" ? "active" : ""}
          onClick={() => setTab("chart")}
        >
          График
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "hud"}
          className={tab === "hud" ? "active" : ""}
          onClick={() => setTab("hud")}
        >
          HUD
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "preflop"}
          className={tab === "preflop" ? "active" : ""}
          onClick={() => {
            setDevsLoading(true);
            setDevError(null);
            setTab("preflop");
          }}
          title="Сверка решений с вашей стратегией (чарты и ветки)"
        >
          Моя стратегия
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "recommendations"}
          className={tab === "recommendations" ? "active" : ""}
          onClick={() => setTab("recommendations")}
          title="Математический разбор сессии: pot odds, эквити, базовые пороги"
        >
          Математика
        </button>
      </div>

      {tab === "chart" && (
        <div className="analysis-tab-pane" role="tabpanel">
          <div className="analysis-kpis">
            <div className="analysis-kpi">
              <span>Раздачи</span>
              <strong>{data.hands}</strong>
            </div>
            <div className="analysis-kpi">
              <span>Winrate</span>
              <strong className={data.winrate_bb100 != null && data.winrate_bb100 >= 0 ? "pos" : "neg"}>
                {data.winrate_bb100 != null ? `${data.winrate_bb100.toFixed(1)} bb/100` : "—"}
              </strong>
            </div>
            <div className="analysis-kpi">
              <span>Профит</span>
              <strong className={data.total_profit_bb >= 0 ? "pos" : "neg"}>
                {data.total_profit_bb.toFixed(1)} bb
              </strong>
              <em>${data.total_profit_money.toFixed(2)}</em>
            </div>
            <button
              type="button"
              className="analysis-kpi clickable"
              onClick={() => openStat("vpip", "VPIP")}
            >
              <span>VPIP</span>
              <strong>{fmtStat(byKey.vpip?.value, "pct")}</strong>
            </button>
            <button
              type="button"
              className="analysis-kpi clickable"
              onClick={() => openStat("pfr", "PFR")}
            >
              <span>PFR</span>
              <strong>{fmtStat(byKey.pfr?.value, "pct")}</strong>
            </button>
            <button
              type="button"
              className="analysis-kpi clickable"
              onClick={() => openStat("three_bet", "3-bet")}
            >
              <span>3-bet</span>
              <strong>{fmtStat(byKey.three_bet?.value, "pct")}</strong>
            </button>
          </div>

          <section className="analysis-block">
            <div className="analysis-block-head">
              <h2>График профита</h2>
            </div>
            <p className="muted analysis-chart-hint">
              Выигрыш · All-In EV · SD / non-SD. Сверка с вашими чартами — во вкладке «Моя стратегия».
            </p>
            <H2nPerformanceChart
              curve={analysisCurveToH2n(data.curve)}
              initialUnit="bb"
              bigBlind={
                Math.abs(data.total_profit_bb) > 1e-9
                  ? Math.abs(data.total_profit_money / data.total_profit_bb)
                  : null
              }
            />
          </section>
        </div>
      )}

      {tab === "hud" && (
        <div className="analysis-tab-pane" role="tabpanel">
          <section className="analysis-block">
            <h2>HUD</h2>
            <p className="muted analysis-chart-hint">
              Нажми на стат — откроется реплей раздач за столом.
            </p>
            <div className="hud-grid">
              {data.stats.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="hud-cell clickable"
                  title={
                    s.cases != null && s.opportunities != null
                      ? `${s.cases}/${s.opportunities} · открыть реплей`
                      : `Выборка: ${s.samples} · открыть реплей`
                  }
                  onClick={() => openStat(s.key, s.label)}
                >
                  <span>{s.label}</span>
                  <strong>{fmtStat(s.value, s.unit)}</strong>
                  <em>
                    {s.cases != null && s.opportunities != null
                      ? `${s.cases}/${s.opportunities}`
                      : s.samples}
                  </em>
                </button>
              ))}
            </div>
          </section>

          {data.by_position.length > 0 && (
            <section className="analysis-block">
              <h2>По позициям</h2>
              <div className="analysis-table-wrap">
                <table className="analysis-table">
                  <thead>
                    <tr>
                      <th>Поз.</th>
                      <th>Руки</th>
                      <th>VPIP</th>
                      <th>PFR</th>
                      <th>3-bet</th>
                      <th>bb/100</th>
                      <th>Профит bb</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_position.map((row) => (
                      <tr key={row.position}>
                        <td>{row.position}</td>
                        <td>{row.hands}</td>
                        <td>{fmtStat(row.vpip, "pct")}</td>
                        <td>{fmtStat(row.pfr, "pct")}</td>
                        <td>{fmtStat(row.three_bet, "pct")}</td>
                        <td
                          className={
                            row.winrate_bb100 != null && row.winrate_bb100 >= 0 ? "pos" : "neg"
                          }
                        >
                          {fmtStat(row.winrate_bb100, "bb100")}
                        </td>
                        <td className={row.profit_bb >= 0 ? "pos" : "neg"}>
                          {row.profit_bb.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {tab === "preflop" && (
        <div className="analysis-tab-pane" role="tabpanel">
          {devsLoading ? (
            <p className="muted">
              {chartProgress || "Проверяем стратегию…"}
              {!chartProgress?.includes("/") &&
              (handTotal ?? pendingHandTotal ?? data?.hands ?? 0) > 0
                ? ` · ${(handTotal ?? pendingHandTotal ?? data?.hands ?? 0).toLocaleString("ru-RU")} рук`
                : ""}
            </p>
          ) : devError ? (
            <p className="error">{devError}</p>
          ) : !devs ? (
            <p className="muted">Нет данных для сверки.</p>
          ) : (
            <section className="analysis-block">
              <h2>Моя стратегия · Префлоп</h2>
              <p className="muted analysis-chart-hint">
                Сверка с вашим регламентом: каждое префлоп-решение сравнивается с вашими чартами
                (raise / call / fold). Если чарт говорит raise, а вы сфолдили — это ошибка
                (пропущенное открытие). Это не GTO и не «общий» эталон — только дисциплина
                относительно своих диапазонов.
              </p>
              {!hasPlayCharts ? (
                <p className="strategy-gap-banner" role="status">
                  {STRATEGY_CHARTS_GAP_HINT}{" "}
                  <Link className="spots-hint-link" to={`/strategies/${strategyId}`}>
                    Открыть конструктор →
                  </Link>
                </p>
              ) : null}

              <div className="preflop-subtabs" role="tablist" aria-label="Разделы стратегии">
                {(
                  [
                    ["overview", "Обзор"],
                    ["positions", "Позиции"],
                    ["branches", "Ветки"],
                    ["errors", "Ошибки"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={preflopSub === id}
                    className={preflopSub === id ? "active" : ""}
                    onClick={() => setPreflopSub(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {spotsHint ? (
                <p className="muted analysis-chart-hint spots-hint" role="status">
                  {spotsHint}{" "}
                  <Link className="spots-hint-link" to={`/strategies/${strategyId}`}>
                    Открыть редактор →
                  </Link>
                </p>
              ) : null}

              {renderPreflopBody()}
            </section>
          )}
        </div>
      )}

      {tab === "recommendations" && (
        <div className="analysis-tab-pane" role="tabpanel">
          <RecommendationsPanel strategyId={strategyId} revision={refreshKey} />
        </div>
      )}

      <HandReplayModal
        open={replay != null}
        strategyId={strategyId}
        stat={replay?.mode === "stat" ? replay.stat : "vpip"}
        handIds={replay?.mode === "hand" ? replay.handIds : null}
        initialHandIndex={replay?.mode === "hand" ? replay.startIndex : 0}
        huPot={
          replay?.mode === "hu"
            ? {
                source: "strategy",
                potKind: replay.potKind,
                matchup: replay.matchup,
              }
            : null
        }
        label={replay?.label ?? "Реплей"}
        onClose={() => setReplay(null)}
      />
    </div>
  );
}
