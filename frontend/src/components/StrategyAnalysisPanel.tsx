import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchStrategyAnalysis,
  listSessions,
  type StrategyAnalysis,
} from "../api/client";
import { restoreLocalSessionReport } from "../engine/localAnalysis";
import { listHandsForStrategy } from "../engine/localDb";
import {
  analysisFingerprint,
  clearAnalysisCache,
  peekAnalysisCache,
  readAnalysisCache,
  writeAnalysisCache,
  type AnalysisCachePayload,
} from "../lib/analysisCache";
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
import HandReplayModal from "./HandReplayModal";
import H2nPerformanceChart, { analysisCurveToH2n } from "./H2nPerformanceChart";
import RecommendationsPanel from "./RecommendationsPanel";
import SessionUploadPanel from "./SessionUploadPanel";

type Props = {
  strategyId: string;
  /** Kept for parent compatibility (editor revision bumps). */
  strategyRevision?: number;
  /** Show session upload above analysis (editor tab). Default true. */
  showUpload?: boolean;
  /** True while a new upload is in flight — stop showing/running prior analysis. */
  analysisSuspended?: boolean;
  /** Estimated hands from the upload in progress (for the progress counter). */
  pendingHandTotal?: number | null;
  /**
   * Analysis page: heavy HUD run via analysisJob (survives tab switches).
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

type AnalysisTab = "chart" | "hud" | "recommendations";

type ReplayState = { mode: "stat"; stat: string; label: string };

function emptyDeviationsStub(strategyId: string) {
  return {
    strategy_id: strategyId,
    total: 0,
    decisions: 0,
    correct: 0,
    correct_pct: 100,
    open_decisions: 0,
    open_correct: 0,
    open_pct: 100,
    play_decisions: 0,
    play_correct: 0,
    play_pct: 100,
    opens: {
      decisions: 0,
      opened: 0,
      folded: 0,
      called: 0,
      should_open: 0,
      opened_correct: 0,
      missed_opens: 0,
      should_fold: 0,
      folded_correct: 0,
      wrong_opens: 0,
      open_follow_pct: 100,
      fold_follow_pct: 100,
      accuracy_pct: 100,
    },
    by_spot: [],
    by_position: [],
    by_branch: [],
    chart_errors: [],
    deviations: [],
    leak_finder: {
      missed_profit_money: 0,
      critical_errors: 0,
      insights: [],
      heat: [],
    },
  };
}

function fmtStat(value: number | null | undefined, unit: string) {
  if (value == null || Number.isNaN(value)) return "—";
  if (unit === "ratio") return value.toFixed(2);
  if (unit === "bb100") return `${value.toFixed(1)}`;
  if (unit === "money") return `$${value.toFixed(2)}`;
  if (unit === "count") return String(Math.round(value));
  return `${value.toFixed(1)}%`;
}

export default function StrategyAnalysisPanel({
  strategyId,
  strategyRevision = 0,
  showUpload = true,
  analysisSuspended: analysisSuspendedProp = false,
  pendingHandTotal = null,
  backgroundJobMode = false,
}: Props) {
  const [tab, setTab] = useState<AnalysisTab>("chart");
  const cachedBoot = peekAnalysisCache(strategyId);
  const [data, setData] = useState<StrategyAnalysis | null>(
    () => cachedBoot?.analysis ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  // Analysis page (backgroundJobMode): never flash server-style AnalysisCalcProgress on F5.
  const [loading, setLoading] = useState(() => !cachedBoot && !backgroundJobMode);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [uploadTick, setUploadTick] = useState(0);
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

  const calcSteps = ["HUD"];
  const [localPendingHands, setLocalPendingHands] = useState<number | null>(null);

  const onUploadStarted = useCallback(
    (estimatedHands?: number) => {
      // Kill in-flight GETs immediately — keep disk cache until upload succeeds.
      stopAnalysisRun();
      if (estimatedHands != null && estimatedHands > 0) {
        setLocalPendingHands(estimatedHands);
        setHandTotal(estimatedHands);
      }
      setUploadSuspended(true);
      markAnalysisUploadStarted(strategyId, estimatedHands);
    },
    [stopAnalysisRun, strategyId],
  );

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

  const onUploadFinished = useCallback(
    (_id: string, ok: boolean) => {
      if (ok) return;
      markAnalysisUploadFailed(_id || strategyId);
      setLocalPendingHands(null);
      setUploadSuspended(false);
      setUploadTick((n) => n + 1);
    },
    [strategyId],
  );

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
      }
    });
  }, [strategyId]);

  // Cache hit → show instantly. Full recompute only when hands/cache miss (new upload).
  useEffect(() => {
    setError(null);
    setCalcStep(0);
    setReplay(null);

    const applyCached = (cached: AnalysisCachePayload) => {
      setData(cached.analysis);
      setHandTotal(cached.handTotal || cached.analysis.hands);
      setLoading(false);
    };

    if (analysisSuspended || isAnalysisJobRunning(strategyId)) {
      stopAnalysisRun();
      setLoading(true);
      setData(null);
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
      setData(null);
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
            if (!peek) setData(null);
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
              s.strategy_id === strategyId && (s.status === "active" || !s.status),
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
          if (!isStale()) setLoading(true);
          return;
        }

        // Hands changed or no cache — HUD pipeline (show progress).
        if (!isStale()) {
          setLoading(true);
          if (!peek) setData(null);
          setCalcStep(0);
        }
        const analysis = await fetchStrategyAnalysis(strategyId, signal);
        if (isStale()) return;
        if (analysis.hands > 0) setHandTotal(analysis.hands);

        setData(analysis);

        writeAnalysisCache(strategyId, {
          fingerprint: fp,
          analysis,
          deviations: emptyDeviationsStub(strategyId),
          spots: [],
          missing: [],
          handTotal: analysis.hands || handsFromSessions,
        });
        // Warm career/schedule cache so report opens instantly.
        void warmHandDbAndResultsCache();
      } catch (err: unknown) {
        if (isStale() || isAbortError(err)) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить анализ");
      } finally {
        if (!isStale()) setLoading(false);
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
              ? "Загрузи txt-сессию выше — появятся VPIP, PFR и график профита."
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
              <strong
                className={
                  data.winrate_bb100 != null && data.winrate_bb100 >= 0 ? "pos" : "neg"
                }
              >
                {data.winrate_bb100 != null
                  ? `${data.winrate_bb100.toFixed(1)} bb/100`
                  : "—"}
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
              Выигрыш · All-In EV · SD / non-SD.
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
                            row.winrate_bb100 != null && row.winrate_bb100 >= 0
                              ? "pos"
                              : "neg"
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

      {tab === "recommendations" && (
        <div className="analysis-tab-pane" role="tabpanel">
          <RecommendationsPanel strategyId={strategyId} revision={refreshKey} />
        </div>
      )}

      <HandReplayModal
        open={replay != null}
        strategyId={strategyId}
        stat={replay?.mode === "stat" ? replay.stat : "vpip"}
        handIds={null}
        initialHandIndex={0}
        huPot={null}
        label={replay?.label ?? "Реплей"}
        onClose={() => setReplay(null)}
      />
    </div>
  );
}
