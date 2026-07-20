import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listStrategies, type BatchUploadReport, type Strategy } from "../api/client";
import AnalysisBgWait from "../components/AnalysisBgWait";
import SessionUploadPanel from "../components/SessionUploadPanel";
import StrategyAnalysisPanel from "../components/StrategyAnalysisPanel";
import { countHandsForStrategy } from "../engine/localDb";
import {
  getAnalysisJob,
  isAnalysisJobRunning,
  markAnalysisUploadFailed,
  markAnalysisUploadStarted,
  subscribeAnalysisJob,
  type AnalysisJobState,
} from "../lib/analysisJob";
import { peekAnalysisCache } from "../lib/analysisCache";
import { readLastStrategyId, writeLastStrategyId } from "../lib/handDbCache";

type AnalysisScope = "session" | "database";

const SCOPE_TABS: { id: AnalysisScope; label: string; lead: string }[] = [
  {
    id: "session",
    label: "Анализ сессии",
    lead: "Загрузите сессию — она добавится в общую базу (дубли пропускаются), отчёт пересчитается по всем накопленным раздачам.",
  },
  {
    id: "database",
    label: "Анализ базы",
    lead: "Стек всех загруженных сессий: график, HUD и стратегии по всей накопленной базе.",
  },
];

export default function AnalysisPage() {
  const [scope, setScope] = useState<AnalysisScope>("database");
  const [strategyId, setStrategyId] = useState(() => readLastStrategyId() ?? "");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [revision, setRevision] = useState(0);
  const [pendingHandTotal, setPendingHandTotal] = useState<number | null>(null);
  const [localHands, setLocalHands] = useState<number | null>(null);
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());
  const [bgRunning, setBgRunning] = useState(() =>
    isAnalysisJobRunning(readLastStrategyId() ?? undefined),
  );
  const lastDoneTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void listStrategies()
      .then((items) => {
        if (cancelled) return;
        setStrategies(items);
        setStrategyId((prev) => {
          if (prev && items.some((s) => s.id === prev)) return prev;
          const remembered = readLastStrategyId();
          const pick =
            (remembered && items.some((s) => s.id === remembered) ? remembered : null) ||
            items[0]?.id ||
            "";
          if (pick) writeLastStrategyId(pick);
          return pick || prev;
        });
      })
      .catch(() => {
        /* offline */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!strategyId) {
      setLocalHands(null);
      return;
    }
    let cancelled = false;
    void countHandsForStrategy(strategyId)
      .then((n) => {
        if (!cancelled) setLocalHands(n);
      })
      .catch(() => {
        if (!cancelled) setLocalHands(null);
      });
    return () => {
      cancelled = true;
    };
  }, [strategyId, revision]);

  useEffect(() => {
    const syncBusy = () => {
      const next = getAnalysisJob();
      setJob(next);
      const busy =
        (next.status === "running" || next.status === "uploading") &&
        (!strategyId || next.strategyId === strategyId);
      setBgRunning(busy);
      if (
        next.status === "done" &&
        next.strategyId === strategyId &&
        next.doneToken !== lastDoneTokenRef.current
      ) {
        lastDoneTokenRef.current = next.doneToken;
        setPendingHandTotal(next.hands);
        setBgRunning(false);
        setRevision((n) => n + 1);
        // Session lands in the shared DB — open the database report.
        setScope("database");
      }
      if (next.status === "error" && (!strategyId || next.strategyId === strategyId)) {
        setBgRunning(false);
      }
    };
    syncBusy();
    return subscribeAnalysisJob(syncBusy);
  }, [strategyId]);

  const onStrategyChange = useCallback((id: string) => {
    setStrategyId(id);
    writeLastStrategyId(id);
  }, []);

  const onUploadStarted = useCallback((id: string, estimatedHands?: number) => {
    setStrategyId(id);
    writeLastStrategyId(id);
    setPendingHandTotal(estimatedHands && estimatedHands > 0 ? estimatedHands : null);
    markAnalysisUploadStarted(id, estimatedHands, { external: true });
    setBgRunning(true);
    setScope("session");
  }, []);

  const onUploaded = useCallback((report: BatchUploadReport, id: string) => {
    setStrategyId(id);
    writeLastStrategyId(id);
    const hands = report.total_hands > 0 ? report.total_hands : 0;
    if (hands) setPendingHandTotal(hands);
    if (getAnalysisJob().status === "done") {
      setBgRunning(false);
      setRevision((n) => n + 1);
      setScope("database");
    }
  }, []);

  const onUploadFinished = useCallback((id: string, ok: boolean) => {
    if (ok) return;
    if (getAnalysisJob().status !== "error") {
      markAnalysisUploadFailed(id);
    }
    setStrategyId(id);
    setPendingHandTotal(null);
    setBgRunning(false);
    setRevision((n) => n + 1);
  }, []);

  const activeLead =
    SCOPE_TABS.find((t) => t.id === scope)?.lead ?? SCOPE_TABS[0].lead;

  const hasCachedReport = Boolean(
    strategyId && peekAnalysisCache(strategyId)?.analysis,
  );
  const waiting = bgRunning || job.status === "error";

  const resultsBlock = waiting ? (
    <div className="analysis-page-results">
      <AnalysisBgWait pendingHands={pendingHandTotal ?? job.hands ?? localHands} />
    </div>
  ) : !strategyId ? (
    <div className="analysis-empty panel analysis-page-results">
      <h2>Выберите стратегию</h2>
      <p className="muted">
        Ещё нет стратегии? <Link to="/strategies">Соберите чарты</Link> — затем вернитесь за
        разбором.
      </p>
    </div>
  ) : (
    <div className="analysis-page-results">
      {scope === "database" && strategies.length > 1 ? (
        <div className="db-analyze-toolbar db-analyze-toolbar--inline">
          <label className="upload-field">
            <span>Стратегия</span>
            <select
              value={strategyId}
              onChange={(e) => onStrategyChange(e.target.value)}
              disabled={bgRunning}
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {localHands != null ? (
            <span className="muted db-hands-pill">
              {localHands.toLocaleString("ru-RU")} рук в базе
              {hasCachedReport ? "" : " · загрузите сессию"}
            </span>
          ) : null}
        </div>
      ) : null}
      <StrategyAnalysisPanel
        strategyId={strategyId}
        strategyRevision={revision}
        analysisSuspended={false}
        pendingHandTotal={pendingHandTotal}
        showUpload={false}
        backgroundJobMode
      />
    </div>
  );

  return (
    <section className="page analysis-page">
      <header className="upload-hero">
        <p className="upload-kicker">Session check</p>
        <h1>Анализ</h1>
        <p className="lead">{activeLead}</p>
      </header>

      <nav className="career-tabs analysis-scope-tabs" role="tablist" aria-label="Режим анализа">
        {SCOPE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={scope === t.id}
            className={scope === t.id ? "active" : ""}
            onClick={() => setScope(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {scope === "session" ? (
        <div className="analysis-scope-panel" role="tabpanel">
          <SessionUploadPanel
            importMode="client"
            onStrategyIdChange={onStrategyChange}
            onUploadStarted={onUploadStarted}
            onUploadFinished={onUploadFinished}
            onUploaded={onUploaded}
          />
          {resultsBlock}
        </div>
      ) : (
        <div className="analysis-scope-panel" role="tabpanel">
          {resultsBlock}
        </div>
      )}
    </section>
  );
}
