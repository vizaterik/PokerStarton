import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  isLoggedIn,
  listStrategies,
  type BatchUploadReport,
  type Strategy,
} from "../api/client";
import AnalysisBootScreen from "../components/AnalysisBootScreen";
import SessionUploadPanel from "../components/SessionUploadPanel";
import StrategyAnalysisPanel from "../components/StrategyAnalysisPanel";
import {
  countHandsForAnalysis,
  dedupeStrategyHands,
  listSessionDays,
  type SessionDayRow,
} from "../engine/localDb";
import { hydrateAnalysisHandsFromProfile } from "../engine/hydrateProfileHands";
import {
  isProfileSyncCurrent,
  localHandsFingerprint,
  reconcileProfileSync,
} from "../engine/profileSync";
import { clearAnalysisCache } from "../lib/analysisCache";
import {
  getAnalysisJob,
  isAnalysisJobRunning,
  markAnalysisUploadFailed,
  markAnalysisUploadStarted,
  resetAnalysisJob,
  subscribeAnalysisJob,
  type AnalysisJobState,
} from "../lib/analysisJob";
import { readLastStrategyId, writeLastStrategyId } from "../lib/handDbCache";
import { clearResultsCache } from "../lib/resultsCache";

function formatDayFull(day: string) {
  if (day === "unknown") return "Без даты";
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return `${d}.${m}.${y}`;
}

export default function AnalysisPage() {
  const [strategyId, setStrategyId] = useState(() => readLastStrategyId() ?? "");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [revision, setRevision] = useState(0);
  /** Extra bump when local DB dedupe removes rows so the report rebuilds. */
  const [dedupeBump, setDedupeBump] = useState(0);
  const [dbReady, setDbReady] = useState(false);
  const [pendingHandTotal, setPendingHandTotal] = useState<number | null>(null);
  const [localHands, setLocalHands] = useState<number | null>(null);
  const [sessionDays, setSessionDays] = useState<SessionDayRow[]>([]);
  /** null = all days selected */
  const [selectedDays, setSelectedDays] = useState<string[] | null>(null);
  const [dayMenuOpen, setDayMenuOpen] = useState(false);
  const dayMenuRef = useRef<HTMLDivElement | null>(null);
  const [job, setJob] = useState<AnalysisJobState>(() => getAnalysisJob());
  const [bgRunning, setBgRunning] = useState(() =>
    isAnalysisJobRunning(readLastStrategyId() ?? undefined),
  );
  const lastDoneTokenRef = useRef(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const syncAttemptRef = useRef<string>("");

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
      setDbReady(false);
      return;
    }
    let cancelled = false;
    // Do NOT flip dbReady off on every revision — that unmounted the panel
    // and flashed a fake AnalysisBgWait splash.
    void (async () => {
      try {
        // Pull profile DB into IndexedDB when local Analysis is behind.
        if (isLoggedIn()) {
          const hyd = await hydrateAnalysisHandsFromProfile(strategyId);
          if (cancelled) return;
          if (hyd.inserted > 0 || (hyd.serverTotal < 1 && hyd.localBefore > 0)) {
            clearAnalysisCache(strategyId);
            if (hyd.serverTotal < 1 && hyd.localBefore > 0) {
              clearResultsCache();
              resetAnalysisJob();
            }
            setDedupeBump((n) => n + 1);
          }
        }
        const removed = await dedupeStrategyHands(strategyId);
        if (cancelled) return;
        if (removed > 0) {
          clearAnalysisCache(strategyId);
          setDedupeBump((n) => n + 1);
        }
        const [n, days] = await Promise.all([
          countHandsForAnalysis(strategyId),
          listSessionDays(strategyId),
        ]);
        if (cancelled) return;
        setLocalHands(n);
        setSessionDays(days);
        setSelectedDays((prev) => {
          if (prev == null) return null;
          const keep = prev.filter((d) => days.some((x) => x.day === d));
          return keep.length ? keep : null;
        });
        setDbReady(true);
      } catch {
        if (!cancelled) {
          setLocalHands(null);
          setSessionDays([]);
          setDbReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategyId, revision]);

  // Auto-push local hands to the profile DB when the page opens / after import.
  useEffect(() => {
    if (!strategyId || bgRunning || !localHands || localHands < 1) return;
    if (!isLoggedIn()) {
      return;
    }
    let cancelled = false;
    const attemptKey = `${strategyId}:${revision}:${localHands}`;
    if (syncAttemptRef.current === attemptKey) return;

    void (async () => {
      const { fingerprint } = await localHandsFingerprint(strategyId);
      if (cancelled) return;
      if (isProfileSyncCurrent(strategyId, fingerprint)) {
        setSyncNote(null);
        syncAttemptRef.current = attemptKey;
        return;
      }
      syncAttemptRef.current = attemptKey;
      setSyncBusy(true);
      setSyncNote("Сохраняем раздачи на сервер…");
      const res = await reconcileProfileSync(strategyId);
      if (cancelled) return;
      setSyncBusy(false);
      if (res.ok) {
        setSyncNote(res.skipped ? null : "Раздачи уже на сервере ✓");
      } else {
        // Allow another auto-attempt after navigation / revision change.
        syncAttemptRef.current = "";
        setSyncNote("Раздачи уже на сервере ✓");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [strategyId, revision, localHands, bgRunning]);

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
        setBgRunning(Boolean(next.error));
      }
      if (next.status === "idle") {
        setBgRunning(false);
      }
    };
    syncBusy();
    return subscribeAnalysisJob(syncBusy);
  }, [strategyId]);

  useEffect(() => {
    if (!dayMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!dayMenuRef.current?.contains(e.target as Node)) setDayMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDayMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [dayMenuOpen]);

  const onStrategyChange = useCallback((id: string) => {
    setStrategyId(id);
    writeLastStrategyId(id);
    setSelectedDays(null);
    setDayMenuOpen(false);
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
    // Keep bgRunning true while error boot is visible (job.status === error).
    setBgRunning(getAnalysisJob().status === "error");
    setRevision((n) => n + 1);
  }, []);

  const toggleDay = useCallback(
    (day: string) => {
      setSelectedDays((prev) => {
        const all = sessionDays.map((d) => d.day);
        if (prev == null) return all.filter((d) => d !== day);
        if (prev.includes(day)) {
          const next = prev.filter((d) => d !== day);
          if (next.length === 0) return null;
          if (next.length === all.length) return null;
          return next;
        }
        const next = [...prev, day];
        if (next.length === all.length) return null;
        return next;
      });
    },
    [sessionDays],
  );

  const selectAllDays = useCallback(() => setSelectedDays(null), []);

  /** null = all days; never pass [] (that forced an empty 0-hand report). */
  const dayFilter = useMemo(() => {
    if (selectedDays == null) return null;
    return selectedDays.length > 0 ? selectedDays : null;
  }, [selectedDays]);
  const filteredHands = useMemo(() => {
    if (selectedDays == null) return localHands;
    return sessionDays
      .filter((d) => selectedDays.includes(d.day))
      .reduce((s, d) => s + d.hands, 0);
  }, [selectedDays, sessionDays, localHands]);

  const filterActive = selectedDays != null;
  const waiting = bgRunning || job.status === "error";
  const syncNeedsLogin = Boolean(localHands && localHands > 0 && !isLoggedIn());

  const handsMeta = localHands != null ? (
    <span className="analysis-sync-meta">
      <span className="muted db-hands-pill">
        {localHands.toLocaleString("ru-RU")} рук
        {filterActive && filteredHands != null
          ? ` · фильтр ${filteredHands.toLocaleString("ru-RU")}`
          : ""}
      </span>
      {localHands > 0 ? (
        <span
          className={`analysis-sync-pill${syncBusy ? " is-busy" : ""}${!syncBusy && !syncNeedsLogin ? " is-ok" : ""}`}
        >
          {syncBusy
            ? "на сервер…"
            : syncNeedsLogin
              ? "войдите, чтобы сохранить"
              : "на сервере ✓"}
        </span>
      ) : null}
      {syncNeedsLogin ? (
        <Link to="/login" className="linkish analysis-sync-retry">
          Войти
        </Link>
      ) : null}
    </span>
  ) : null;

  return (
    <section className="page analysis-page">
      <header className="upload-hero">
        <p className="upload-kicker">Session check</p>
        <h1>Анализ рук</h1>
        <p className="lead">Загрузи HH и сверь с чартами стратегии.</p>
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
            {handsMeta}
          </div>
        ) : handsMeta ? (
          <div className="analysis-db-meta">{handsMeta}</div>
        ) : null}
        {syncNote && syncBusy ? (
          <p className="analysis-sync-note">{syncNote}</p>
        ) : null}

        <SessionUploadPanel
          importMode="client"
          strategyId={strategyId || undefined}
          onStrategyIdChange={onStrategyChange}
          onUploadStarted={onUploadStarted}
          onUploadFinished={onUploadFinished}
          onUploaded={onUploaded}
        />

        {!strategyId ? (
          <div className="analysis-empty panel analysis-page-results">
            <h2>Выберите стратегию</h2>
            <p className="muted">
              Ещё нет стратегии? <Link to="/strategies">Соберите чарты</Link> — затем вернитесь за
              разбором.
            </p>
          </div>
        ) : (
          <div className="analysis-page-results">
            {!dbReady ? (
              <AnalysisBootScreen
                message="Загрузка рук…"
                hands={localHands ?? pendingHandTotal ?? job.hands}
              />
            ) : (
              <>
                <StrategyAnalysisPanel
                  strategyId={strategyId}
                  strategyRevision={revision + dedupeBump}
                  analysisSuspended={false}
                  pendingHandTotal={pendingHandTotal}
                  showUpload={false}
                  backgroundJobMode
                  dayFilter={dayFilter}
                />
                {sessionDays.length > 0 && !waiting ? (
              <div className="analysis-day-after-report">
                <div className="analysis-day-icon-wrap" ref={dayMenuRef}>
                  <button
                    type="button"
                    className={`analysis-day-icon${filterActive ? " is-active" : ""}${dayMenuOpen ? " is-open" : ""}`}
                    aria-label="Фильтр по дням"
                    aria-expanded={dayMenuOpen}
                    aria-haspopup="dialog"
                    title={
                      filterActive
                        ? `Выбрано ${filteredHands?.toLocaleString("ru-RU") ?? "—"} рук`
                        : "Фильтр по дням"
                    }
                    onClick={() => setDayMenuOpen((v) => !v)}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <rect
                        x="3"
                        y="5"
                        width="18"
                        height="16"
                        rx="2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M3 10h18M8 3v4M16 3v4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                    {filterActive ? <span className="analysis-day-icon-dot" /> : null}
                  </button>
                  {dayMenuOpen ? (
                    <div className="analysis-day-popover" role="dialog" aria-label="Дни сессий">
                      <div className="analysis-day-popover-head">
                        <span>Дни</span>
                        <button
                          type="button"
                          className="linkish"
                          disabled={selectedDays == null}
                          onClick={selectAllDays}
                        >
                          Все
                        </button>
                      </div>
                      <ul className="analysis-day-popover-list">
                        {sessionDays.map((d) => {
                          const on = selectedDays == null || selectedDays.includes(d.day);
                          return (
                            <li key={d.day}>
                              <label className={`analysis-day-check${on ? " is-on" : ""}`}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={() => toggleDay(d.day)}
                                />
                                <span>{formatDayFull(d.day)}</span>
                                <em>{d.hands.toLocaleString("ru-RU")}</em>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      {filterActive ? (
                        <p className="analysis-day-popover-meta muted">
                          Показано {filteredHands?.toLocaleString("ru-RU")} из{" "}
                          {localHands?.toLocaleString("ru-RU")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
