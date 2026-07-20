import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BatchUploadReport } from "../api/client";
import AnalysisBgWait from "../components/AnalysisBgWait";
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

export default function AnalysisPage() {
  const [strategyId, setStrategyId] = useState(() => readLastStrategyId() ?? "");
  const [revision, setRevision] = useState(0);
  const [pendingHandTotal, setPendingHandTotal] = useState<number | null>(null);
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());
  const [bgRunning, setBgRunning] = useState(() =>
    isAnalysisJobRunning(readLastStrategyId() ?? undefined),
  );
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

  return (
    <section className="page analysis-page">
      <header className="upload-hero">
        <p className="upload-kicker">Session check</p>
        <h1>Анализ</h1>
        <p className="lead">
          Загрузите историю рук — разберём сессию (HUD, график, математика) и сохраним отчёт в базу
          профиля для карьеры и расписания.
        </p>
      </header>

      <SessionUploadPanel
        importMode="client"
        onStrategyIdChange={onStrategyChange}
        onUploadStarted={onUploadStarted}
        onUploadFinished={onUploadFinished}
        onUploaded={onUploaded}
      />

      {bgRunning || job.status === "error" ? (
        <div className="analysis-page-results" style={{ marginTop: "1.5rem" }}>
          <AnalysisBgWait pendingHands={pendingHandTotal ?? job.hands} />
        </div>
      ) : !strategyId ? (
        <div className="analysis-empty panel" style={{ marginTop: "1.5rem" }}>
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
      )}
    </section>
  );
}
