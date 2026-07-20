import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listStrategies, type BatchUploadReport, type Strategy } from "../api/client";
import AnalysisBgWait from "../components/AnalysisBgWait";
import SessionUploadPanel from "../components/SessionUploadPanel";
import StrategyAnalysisPanel from "../components/StrategyAnalysisPanel";
import { finalizeLocalAnalysis } from "../engine/localAnalysis";
import { countHandsForStrategy } from "../engine/localDb";
import {
  completeClientImport,
  getAnalysisJob,
  isAnalysisJobRunning,
  markAnalysisUploadFailed,
  markAnalysisUploadStarted,
  subscribeAnalysisJob,
  updateClientImportProgress,
  type AnalysisJobState,
} from "../lib/analysisJob";
import { ensureConstructorChartsSynced } from "../lib/gameTree/syncTreeCharts";
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
    lead: "Один разбор по всем раздачам стратегии в активной базе — тот же отчёт, что после загрузки сессии.",
  },
];

export default function AnalysisPage() {
  const [scope, setScope] = useState<AnalysisScope>("session");
  const [strategyId, setStrategyId] = useState(() => readLastStrategyId() ?? "");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [revision, setRevision] = useState(0);
  const [pendingHandTotal, setPendingHandTotal] = useState<number | null>(null);
  const [localHands, setLocalHands] = useState<number | null>(null);
  const [dbBusy, setDbBusy] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());
  const [bgRunning, setBgRunning] = useState(() =>
    isAnalysisJobRunning(readLastStrategyId() ?? undefined),
  );
  const [dbReportReady, setDbReportReady] = useState(false);
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
        setDbBusy(false);
        setDbReportReady(true);
        setRevision((n) => n + 1);
      }
      if (next.status === "error" && (!strategyId || next.strategyId === strategyId)) {
        setBgRunning(false);
        setDbBusy(false);
      }
    };
    syncBusy();
    return subscribeAnalysisJob(syncBusy);
  }, [strategyId]);

  const onStrategyChange = useCallback((id: string) => {
    setStrategyId(id);
    writeLastStrategyId(id);
    setDbReportReady(false);
  }, []);

  const onUploadStarted = useCallback((id: string, estimatedHands?: number) => {
    setStrategyId(id);
    writeLastStrategyId(id);
    setPendingHandTotal(estimatedHands && estimatedHands > 0 ? estimatedHands : null);
    markAnalysisUploadStarted(id, estimatedHands, { external: true });
    setBgRunning(true);
    setScope("session");
    setDbReportReady(true);
  }, []);

  const onUploaded = useCallback((report: BatchUploadReport, id: string) => {
    setStrategyId(id);
    writeLastStrategyId(id);
    const hands = report.total_hands > 0 ? report.total_hands : 0;
    if (hands) setPendingHandTotal(hands);
    setDbReportReady(true);
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

  const runDatabaseAnalysis = useCallback(async () => {
    if (!strategyId || dbBusy) return;
    setDbError(null);
    setDbBusy(true);
    setBgRunning(true);
    setDbReportReady(true);
    const hint = localHands && localHands > 0 ? localHands : undefined;
    markAnalysisUploadStarted(strategyId, hint, { external: true });
    try {
      updateClientImportProgress(
        strategyId,
        14,
        "Подгружаем стратегию и чарты…",
        hint,
      );
      await ensureConstructorChartsSynced(strategyId, { force: true });
      updateClientImportProgress(
        strategyId,
        40,
        "Считаем HUD и сверку по всей базе…",
        hint,
      );
      const fin = await finalizeLocalAnalysis(strategyId, (p) => {
        let pct = 45;
        if (p.phase === "done") pct = 96;
        else if (p.phase === "deviations") {
          pct = 55 + Math.round(Math.min(1, (p.pct ?? 0) / 100) * 35);
        } else if (p.phase === "hud") {
          pct = 45 + Math.round(Math.min(1, (p.pct ?? 0) / 100) * 10);
        }
        updateClientImportProgress(
          strategyId,
          pct,
          p.message || "Анализ базы…",
          p.total > 0 ? p.total : hint,
        );
      });
      completeClientImport(
        strategyId,
        fin.hands,
        `База разобрана · ${fin.hands.toLocaleString("ru-RU")} рук`,
      );
      setPendingHandTotal(fin.hands > 0 ? fin.hands : null);
      setLocalHands(fin.hands);
      setRevision((n) => n + 1);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Не удалось разобрать базу";
      setDbError(msg);
      markAnalysisUploadFailed(strategyId, msg);
    } finally {
      setDbBusy(false);
      setBgRunning(false);
    }
  }, [strategyId, dbBusy, localHands]);

  const activeLead =
    SCOPE_TABS.find((t) => t.id === scope)?.lead ?? SCOPE_TABS[0].lead;

  const waiting = bgRunning || dbBusy || job.status === "error";

  const resultsBlock =
    waiting ? (
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
    ) : dbReportReady || scope === "session" ? (
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
    ) : null;

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
          <section className="db-analyze panel">
            <header className="db-analyze-head">
              <div>
                <h2>Анализ всей базы</h2>
                <p className="muted">
                  Без отдельного списка загрузок: раздачи уже в активной базе. Кнопка считает тот же
                  отчёт (график, HUD, стратегии), что и после загрузки сессии.
                </p>
              </div>
            </header>

            <div className="db-analyze-toolbar">
              <label className="upload-field">
                <span>Стратегия</span>
                <select
                  value={strategyId}
                  onChange={(e) => onStrategyChange(e.target.value)}
                  disabled={strategies.length === 0 || dbBusy || bgRunning}
                >
                  {strategies.length === 0 ? (
                    <option value="">Сначала соберите стратегию</option>
                  ) : null}
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="upload-submit db-analyze-run"
                disabled={!strategyId || dbBusy || bgRunning}
                onClick={() => void runDatabaseAnalysis()}
              >
                {dbBusy || bgRunning
                  ? "Считаем…"
                  : localHands != null && localHands > 0
                    ? `Анализ всей базы · ${localHands.toLocaleString("ru-RU")} рук`
                    : "Анализ всей базы"}
              </button>
            </div>

            {localHands === 0 ? (
              <p className="muted">
                В базе пока нет раздач для этой стратегии. Загрузите историю во вкладке «Анализ
                сессии».
              </p>
            ) : null}
            {dbError ? <p className="error">{dbError}</p> : null}
          </section>
          {resultsBlock}
        </div>
      )}
    </section>
  );
}
