import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BatchUploadReport, PlaySession } from "../api/client";
import AnalysisBgWait from "../components/AnalysisBgWait";
import DatabaseSessionsPanel from "../components/DatabaseSessionsPanel";
import SessionUploadPanel from "../components/SessionUploadPanel";
import StrategyAnalysisPanel from "../components/StrategyAnalysisPanel";
import {
  getAnalysisJob,
  isAnalysisJobRunning,
  markAnalysisUploadFailed,
  markAnalysisUploadStarted,
  subscribeAnalysisJob,
  type AnalysisJobState,
} from "../lib/analysisJob";
import { readLastStrategyId, writeLastStrategyId } from "../lib/handDbCache";

type AnalysisScope = "session" | "database";

const SCOPE_TABS: { id: AnalysisScope; label: string; lead: string }[] = [
  {
    id: "session",
    label: "Анализ сессии",
    lead: "Загрузите актуальную историю рук — разберём сессию и сверим со стратегией.",
  },
  {
    id: "database",
    label: "Анализ базы",
    lead: "Все сессии активной базы: архив загрузок, профит и сверка по накопленным раздачам.",
  },
];

export default function AnalysisPage() {
  const [scope, setScope] = useState<AnalysisScope>("session");
  const [strategyId, setStrategyId] = useState(() => readLastStrategyId() ?? "");
  const [revision, setRevision] = useState(0);
  const [pendingHandTotal, setPendingHandTotal] = useState<number | null>(null);
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());
  const [bgRunning, setBgRunning] = useState(() =>
    isAnalysisJobRunning(readLastStrategyId() ?? undefined),
  );
  const [selectedSession, setSelectedSession] = useState<PlaySession | null>(null);
  const lastDoneTokenRef = useRef(0);

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

  /** Import finished — refresh the panel. */
  const onUploaded = useCallback((report: BatchUploadReport, id: string) => {
    setStrategyId(id);
    writeLastStrategyId(id);
    const hands = report.total_hands > 0 ? report.total_hands : 0;
    if (hands) setPendingHandTotal(hands);
    if (getAnalysisJob().status === "done") {
      setBgRunning(false);
      setRevision((n) => n + 1);
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

  const resultsBlock =
    bgRunning || job.status === "error" ? (
      <div className="analysis-page-results">
        <AnalysisBgWait pendingHands={pendingHandTotal ?? job.hands} />
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
          <DatabaseSessionsPanel
            strategyId={strategyId || undefined}
            selectedId={selectedSession?.id ?? null}
            onSelect={setSelectedSession}
          />
          {selectedSession ? (
            <div className="db-session-focus panel">
              <h3>{selectedSession.label || selectedSession.source_filename}</h3>
              <p className="muted">
                {(selectedSession.hands_count ?? 0).toLocaleString("ru-RU")} рук · верно{" "}
                {selectedSession.correct_count ?? 0} · ошибки{" "}
                {selectedSession.deviations_count ?? 0}
                {selectedSession.status === "archived" ? " · в архиве" : ""}
              </p>
              <p className="muted">
                Ниже — полный отчёт по раздачам стратегии в активной базе (не только эта строка).
              </p>
            </div>
          ) : null}
          {resultsBlock}
        </div>
      )}
    </section>
  );
}
