import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listStrategies, type BatchUploadReport, type Strategy } from "../api/client";
import AnalysisBgWait from "../components/AnalysisBgWait";
import SessionUploadPanel from "../components/SessionUploadPanel";
import StrategyAnalysisPanel from "../components/StrategyAnalysisPanel";
import {
  countHandsForStrategy,
  DAILY_HAND_UPLOAD_LIMIT,
  listSessionDays,
  type SessionDayRow,
} from "../engine/localDb";
import {
  getAnalysisJob,
  isAnalysisJobRunning,
  markAnalysisUploadFailed,
  markAnalysisUploadStarted,
  subscribeAnalysisJob,
  type AnalysisJobState,
} from "../lib/analysisJob";
import { readLastStrategyId, writeLastStrategyId } from "../lib/handDbCache";

function formatDayLabel(day: string) {
  if (day === "unknown") return "Без даты";
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return `${d}.${m}.${y}`;
}

export default function AnalysisPage() {
  const [strategyId, setStrategyId] = useState(() => readLastStrategyId() ?? "");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [revision, setRevision] = useState(0);
  const [pendingHandTotal, setPendingHandTotal] = useState<number | null>(null);
  const [localHands, setLocalHands] = useState<number | null>(null);
  const [sessionDays, setSessionDays] = useState<SessionDayRow[]>([]);
  /** null = all days selected */
  const [selectedDays, setSelectedDays] = useState<string[] | null>(null);
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
      setSessionDays([]);
      return;
    }
    let cancelled = false;
    void Promise.all([
      countHandsForStrategy(strategyId),
      listSessionDays(strategyId),
    ])
      .then(([n, days]) => {
        if (cancelled) return;
        setLocalHands(n);
        setSessionDays(days);
        setSelectedDays((prev) => {
          if (prev == null) return null;
          const keep = prev.filter((d) => days.some((x) => x.day === d));
          return keep.length ? keep : null;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLocalHands(null);
          setSessionDays([]);
        }
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
    setSelectedDays(null);
  }, []);

  const onUploadStarted = useCallback((id: string, estimatedHands?: number) => {
    setStrategyId(id);
    writeLastStrategyId(id);
    setPendingHandTotal(estimatedHands && estimatedHands > 0 ? estimatedHands : null);
    markAnalysisUploadStarted(id, estimatedHands, { external: true });
    setBgRunning(true);
  }, []);

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

  const toggleDay = useCallback((day: string) => {
    setSelectedDays((prev) => {
      const all = sessionDays.map((d) => d.day);
      if (prev == null) {
        // Was "all" → select only this day off means all except? Better: start from all, remove day.
        return all.filter((d) => d !== day);
      }
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        if (next.length === 0) return [];
        if (next.length === all.length) return null;
        return next;
      }
      const next = [...prev, day];
      if (next.length === all.length) return null;
      return next;
    });
  }, [sessionDays]);

  const selectAllDays = useCallback(() => setSelectedDays(null), []);

  const dayFilter = useMemo(() => selectedDays, [selectedDays]);
  const filteredHands = useMemo(() => {
    if (selectedDays == null) return localHands;
    return sessionDays
      .filter((d) => selectedDays.includes(d.day))
      .reduce((s, d) => s + d.hands, 0);
  }, [selectedDays, sessionDays, localHands]);

  const waiting = bgRunning || job.status === "error";

  return (
    <section className="page analysis-page">
      <header className="upload-hero">
        <p className="upload-kicker">Session check</p>
        <h1>Анализ сессии</h1>
        <p className="lead">
          Загрузка добавляет раздачи в общую базу (дубли пропускаются). Лимит{" "}
          {DAILY_HAND_UPLOAD_LIMIT.toLocaleString("ru-RU")} рук на календарный день. Отчёт — по
          выбранным дням из этой базы.
        </p>
      </header>

      <div className="analysis-scope-panel">
        {strategies.length > 1 ? (
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
                {filteredHands != null && selectedDays != null
                  ? ` · выбрано ${filteredHands.toLocaleString("ru-RU")}`
                  : ""}
              </span>
            ) : null}
          </div>
        ) : localHands != null ? (
          <p className="muted db-hands-pill analysis-db-meta">
            {localHands.toLocaleString("ru-RU")} рук в базе
            {filteredHands != null && selectedDays != null
              ? ` · выбрано ${filteredHands.toLocaleString("ru-RU")}`
              : ""}
          </p>
        ) : null}

        <SessionUploadPanel
          importMode="client"
          strategyId={strategyId || undefined}
          onStrategyIdChange={onStrategyChange}
          onUploadStarted={onUploadStarted}
          onUploadFinished={onUploadFinished}
          onUploaded={onUploaded}
        />

        {sessionDays.length > 0 ? (
          <div className="analysis-day-filter" aria-label="Дни сессий">
            <div className="analysis-day-filter-head">
              <strong>Дни в базе</strong>
              <button
                type="button"
                className="linkish"
                disabled={selectedDays == null}
                onClick={selectAllDays}
              >
                Все дни
              </button>
            </div>
            <div className="analysis-day-chips">
              {sessionDays.map((d) => {
                const on = selectedDays == null || selectedDays.includes(d.day);
                return (
                  <button
                    key={d.day}
                    type="button"
                    className={`analysis-day-chip${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleDay(d.day)}
                    title={`${d.hands.toLocaleString("ru-RU")} рук`}
                  >
                    <span>{formatDayLabel(d.day)}</span>
                    <em>{d.hands.toLocaleString("ru-RU")}</em>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {waiting ? (
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
            <StrategyAnalysisPanel
              strategyId={strategyId}
              strategyRevision={revision}
              analysisSuspended={false}
              pendingHandTotal={pendingHandTotal}
              showUpload={false}
              backgroundJobMode
              dayFilter={dayFilter}
            />
          </div>
        )}
      </div>
    </section>
  );
}
