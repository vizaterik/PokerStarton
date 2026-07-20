import { useEffect, useMemo, useState } from "react";
import { listSessions, type PlaySession } from "../api/client";
import RoomBadge from "./RoomBadge";

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function accuracyPct(s: PlaySession) {
  const total = (s.correct_count ?? 0) + (s.deviations_count ?? 0);
  if (total <= 0) return null;
  return ((s.correct_count ?? 0) / total) * 100;
}

type Props = {
  /** Highlight sessions for this strategy when set. */
  strategyId?: string;
  selectedId?: string | null;
  onSelect?: (session: PlaySession | null) => void;
};

/** All play sessions from the active hand database. */
export default function DatabaseSessionsPanel({
  strategyId,
  selectedId,
  onSelect,
}: Props) {
  const [sessions, setSessions] = useState<PlaySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void listSessions(ac.signal)
      .then((rows) => {
        if (cancelled) return;
        setSessions(rows);
      })
      .catch((err) => {
        if (cancelled || ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Не удалось загрузить сессии");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  const sorted = useMemo(() => {
    const rows = [...sessions];
    rows.sort((a, b) => {
      const ta = a.started_at || a.created_at || "";
      const tb = b.started_at || b.created_at || "";
      return tb.localeCompare(ta);
    });
    return rows;
  }, [sessions]);

  const totals = useMemo(() => {
    let hands = 0;
    let correct = 0;
    let deviations = 0;
    for (const s of sorted) {
      hands += s.hands_count ?? 0;
      correct += s.correct_count ?? 0;
      deviations += s.deviations_count ?? 0;
    }
    return { hands, correct, deviations, count: sorted.length };
  }, [sorted]);

  return (
    <section className="db-sessions panel" aria-label="Сессии базы">
      <header className="db-sessions-head">
        <div>
          <h2>Все сессии</h2>
          <p className="muted">
            Сессии активной базы профиля — архив и актуальные загрузки.
          </p>
        </div>
        {!loading && totals.count > 0 ? (
          <div className="db-sessions-totals">
            <span>
              <strong>{totals.count}</strong> сесс.
            </span>
            <span>
              <strong>{totals.hands.toLocaleString("ru-RU")}</strong> рук
            </span>
            {totals.correct + totals.deviations > 0 ? (
              <span>
                <strong className="pos">{totals.correct}</strong>
                {" / "}
                <strong className="neg">{totals.deviations}</strong>
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {loading ? <p className="muted">Загрузка сессий…</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !error && sorted.length === 0 ? (
        <p className="muted">
          Пока нет сессий в базе. Загрузите историю во вкладке «Анализ сессии».
        </p>
      ) : null}

      {sorted.length > 0 ? (
        <ul className="upload-session-list">
          {sorted.map((s, index) => {
            const acc = accuracyPct(s);
            const active = selectedId === s.id;
            const forStrategy =
              !strategyId || !s.strategy_id || s.strategy_id === strategyId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`upload-session-row${active ? " active" : ""}`}
                  onClick={() => onSelect?.(active ? null : s)}
                  title={
                    forStrategy
                      ? s.label
                      : "Сессия другой стратегии"
                  }
                >
                  <span className="usr-meta">{index + 1}</span>
                  <span className="usr-label">
                    <RoomBadge
                      room={s.room}
                      label={s.label || s.source_filename}
                      showName={false}
                    />
                  </span>
                  <span className="usr-meta">{fmtWhen(s.started_at || s.created_at)}</span>
                  <span className="usr-meta">
                    {(s.hands_count ?? 0).toLocaleString("ru-RU")} рук
                  </span>
                  <span
                    className={`usr-dev${(s.deviations_count ?? 0) > 0 ? " bad" : ""}`}
                    title="Ошибки"
                  >
                    {s.deviations_count ?? 0}
                  </span>
                  <span className="usr-meta" title="Точность">
                    {acc == null ? "—" : `${acc.toFixed(0)}%`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
