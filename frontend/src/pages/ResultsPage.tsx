import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  BankrollSettings,
  getBankroll,
  getResults,
  listHandDatabases,
  ResultsReport,
} from "../api/client";
import AnalysisCalcProgress from "../components/AnalysisCalcProgress";
import ProfitChart from "../components/ProfitChart";
import StakeAdvice from "../components/StakeAdvice";
import { metaFromDatabase, readHandDbMeta, writeHandDbMeta } from "../lib/handDbCache";
import { filterResultsReport } from "../lib/filterResultsReport";
import {
  peekLatestResultsCache,
  readResultsCache,
  resultsFingerprint,
  writeResultsCache,
} from "../lib/resultsCache";

type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "all" | "custom";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "all", label: "Всё время" },
  { key: "custom", label: "Свой" },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toApiIso(d: Date) {
  // Naive local wall-clock string — matches HH timestamps without TZ.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function rangeForPeriod(period: PeriodKey, customFrom: string, customTo: string) {
  const now = new Date();
  if (period === "all") return { dateFrom: undefined as string | undefined, dateTo: undefined as string | undefined };
  if (period === "today") {
    return { dateFrom: toApiIso(startOfDay(now)), dateTo: toApiIso(endOfDay(now)) };
  }
  if (period === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { dateFrom: toApiIso(startOfDay(y)), dateTo: toApiIso(endOfDay(y)) };
  }
  if (period === "7d") {
    const from = startOfDay(now);
    from.setDate(from.getDate() - 6);
    return { dateFrom: toApiIso(from), dateTo: toApiIso(endOfDay(now)) };
  }
  if (period === "30d") {
    const from = startOfDay(now);
    from.setDate(from.getDate() - 29);
    return { dateFrom: toApiIso(from), dateTo: toApiIso(endOfDay(now)) };
  }
  // custom
  const from = customFrom ? startOfDay(new Date(`${customFrom}T00:00:00`)) : undefined;
  const to = customTo ? endOfDay(new Date(`${customTo}T00:00:00`)) : undefined;
  return {
    dateFrom: from ? toApiIso(from) : undefined,
    dateTo: to ? toApiIso(to) : undefined,
  };
}

function money(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function bb(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)} bb`;
}

function tone(n: number) {
  if (n > 0.001) return "pos";
  if (n < -0.001) return "neg";
  return "flat";
}

type Props = {
  embedded?: boolean;
  /** chart = только график; results = KPI; full = KPI + график */
  view?: "chart" | "results" | "full";
};

export default function ResultsPage({ embedded = false, view = "full" }: Props) {
  const showChart = view === "chart" || view === "full";
  const showStats = view === "results" || view === "full";
  const title =
    view === "chart" ? "График" : view === "results" ? "Результаты" : "Отчёт";
  const lead =
    view === "chart"
      ? "Кумулятивный профит по всем раздачам активной базы из профиля."
      : "Все уникальные раздачи из базы в профиле (не только последний анализ). Новый анализ архивирует прошлую сессию, но она остаётся в отчёте и на графике.";
  const [sessionId, setSessionId] = useState("");
  const [unit, setUnit] = useState<"bb" | "money">("money");
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [customFrom, setCustomFrom] = useState(() => toDateInput(new Date()));
  const [customTo, setCustomTo] = useState(() => toDateInput(new Date()));
  const [error, setError] = useState<string | null>(null);
  const [bankroll, setBankroll] = useState<BankrollSettings | null>(null);

  const range = useMemo(
    () => rangeForPeriod(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  // Always load all-time once; period / session chips filter client-side.
  const bootFp = resultsFingerprint("", undefined, undefined);
  const bootCached = readResultsCache(bootFp) ?? peekLatestResultsCache();
  const [allReport, setAllReport] = useState<ResultsReport | null>(() => bootCached);
  const [loading, setLoading] = useState(() => !bootCached);
  const [handTotal, setHandTotal] = useState<number | null>(
    () => bootCached?.total_hands ?? readHandDbMeta()?.handsCount ?? null,
  );

  useEffect(() => {
    void getBankroll()
      .then((b) => setBankroll(b.settings))
      .catch(() => setBankroll(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    const cached = readResultsCache(bootFp) ?? peekLatestResultsCache();
    if (cached) {
      setAllReport(cached);
      if (cached.total_hands > 0) setHandTotal(cached.total_hands);
      setLoading(false);
    } else {
      setLoading(true);
    }

    void getResults({})
      .then((res) => {
        if (cancelled) return;
        setAllReport(res);
        writeResultsCache(bootFp, res);
        if (res.total_hands > 0) setHandTotal(res.total_hands);
        void listHandDatabases()
          .then((dbs) => {
            const active = dbs.find((d) => d.is_active) ?? dbs[0];
            if (active) writeHandDbMeta(metaFromDatabase(active));
          })
          .catch(() => undefined);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить отчёт");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- all-time fingerprint is stable
  }, []);

  const report = useMemo(() => {
    if (!allReport) return null;
    return filterResultsReport(allReport, {
      sessionId: sessionId || undefined,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    });
  }, [allReport, sessionId, range.dateFrom, range.dateTo]);

  const peak = useMemo(() => {
    if (!report?.curve.length) return null;
    let max = -Infinity;
    let min = Infinity;
    for (const p of report.curve) {
      const v = unit === "bb" ? p.cum_bb : p.cum_money;
      max = Math.max(max, v);
      min = Math.min(min, v);
    }
    return { max, min };
  }, [report, unit]);

  const wrap = (node: ReactNode) =>
    embedded ? <div className="results-page">{node}</div> : <section className="page results-page">{node}</section>;

  if (loading && !report) {
    return wrap(
      <AnalysisCalcProgress
        title={title}
        steps={["Открываем отчёт"]}
        stepIndex={0}
        totalHands={handTotal}
        jobKey={`results-init-${view}`}
      />,
    );
  }

  if (error && !allReport) {
    return wrap(<p className="error">{error}</p>);
  }

  if (!report) return null;

  if (!report.has_any_data) {
    return wrap(
      <>
        {!embedded && <h1>{title}</h1>}
        <p className="lead">Загрузи истории рук — здесь появится график профита.</p>
        <div className="results-empty panel">
          <p className="muted" style={{ margin: 0 }}>
            Пока нет раздач с результатом. Открой «Анализ» и добавь txt-файлы.
          </p>
        </div>
      </>,
    );
  }

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";

  return wrap(
    <>
      <div className="results-header">
        <div>
          {!embedded && <h1>{title}</h1>}
          <p className="lead">{lead}</p>
        </div>
        <div className="results-controls">
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            aria-label="Сессия"
          >
            <option value="">Все сессии</option>
            {(allReport?.sessions ?? report.sessions).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {showChart ? (
            <div className="unit-toggle" role="group" aria-label="Единицы графика">
              <button
                type="button"
                className={unit === "money" ? "active" : ""}
                onClick={() => setUnit("money")}
              >
                $
              </button>
              <button
                type="button"
                className={unit === "bb" ? "active" : ""}
                onClick={() => setUnit("bb")}
              >
                BB
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="period-bar">
        <div className="period-chips" role="group" aria-label="Период">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`period-chip${period === p.key ? " active" : ""}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="period-custom">
            <label>
              С
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label>
              По
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      {bankroll && showStats ? (
        <div style={{ marginBottom: "1rem" }}>
          <StakeAdvice settings={bankroll} compact />
        </div>
      ) : null}

      {report.total_hands === 0 ? (
        <div className="results-empty panel" style={{ marginTop: "1rem" }}>
          <p className="muted" style={{ margin: 0 }}>
            Нет раздач за период «{periodLabel}». Выбери другой день или диапазон.
          </p>
        </div>
      ) : (
        <>
          {showStats ? (
            <div className="kpi-grid">
              <article className={`kpi-card hero-kpi ${tone(report.total_profit_money)}`}>
                <span className="kpi-label">Профит · {periodLabel}</span>
                <strong>{money(report.total_profit_money)}</strong>
                <em>{bb(report.total_profit_bb)}</em>
              </article>
              <article className="kpi-card">
                <span className="kpi-label">Winrate</span>
                <strong className={tone(report.winrate_bb100)}>
                  {report.winrate_bb100.toFixed(1)}
                </strong>
                <em>bb / 100</em>
              </article>
              <article className="kpi-card">
                <span className="kpi-label">Раздач</span>
                <strong>{report.total_hands.toLocaleString("ru-RU")}</strong>
                <em>{report.sessions_count} сесс.</em>
              </article>
              <article className="kpi-card">
                <span className="kpi-label">W / L / 0</span>
                <strong>
                  <span className="pos">{report.wins}</span>
                  <span className="kpi-sep">/</span>
                  <span className="neg">{report.losses}</span>
                  <span className="kpi-sep">/</span>
                  <span className="flat">{report.scratches}</span>
                </strong>
                <em>
                  {peak
                    ? `пик ${unit === "bb" ? peak.max.toFixed(0) : peak.max.toFixed(2)} · низ ${unit === "bb" ? peak.min.toFixed(0) : peak.min.toFixed(2)}`
                    : "—"}
                </em>
              </article>
            </div>
          ) : null}

          {showChart ? (
            <div className="chart-panel">
              <div className="chart-panel-head">
                <div>
                  <h2>График профита</h2>
                  <p className="muted">
                    Кумулятив в {unit === "money" ? "долларах" : "больших блайндах"} ·{" "}
                    {periodLabel.toLowerCase()}
                  </p>
                </div>
                <div className="chart-legend">
                  <span>
                    <i className="lg pos" /> Плюс
                  </span>
                  <span>
                    <i className="lg neg" /> Минус
                  </span>
                  <span>
                    <i className="lg line" /> Профит
                  </span>
                </div>
              </div>
              <ProfitChart curve={report.curve} unit={unit} />
            </div>
          ) : null}
        </>
      )}
    </>,
  );
}
