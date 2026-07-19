import { useEffect, useMemo, useState } from "react";
import { getResults, type SessionProfitRow } from "../api/client";
import { peekLatestResultsCache, resultsFingerprint, writeResultsCache } from "../lib/resultsCache";

const STORAGE_KEY = "pokerledger.sessionSchedule.v3";
const STORAGE_KEY_V2 = "pokerledger.sessionSchedule.v2";
const STORAGE_KEY_V1 = "pokerledger.sessionSchedule.v1";

export type SessionSlot = {
  id: string;
  hour: number;
  minute: number;
};

export type SessionSchedulePrefs = {
  /** Planned play dates YYYY-MM-DD */
  dates: string[];
  /** Session start times per play day */
  slots: SessionSlot[];
  /** How long one session lasts (hours) */
  sessionHours: number;
};

const DEFAULT_PREFS: SessionSchedulePrefs = {
  dates: [],
  slots: [
    { id: "slot_a", hour: 14, minute: 0 },
    { id: "slot_b", hour: 20, minute: 0 },
  ],
  sessionHours: 2,
};

function uid() {
  return `slot_${Math.random().toString(36).slice(2, 9)}`;
}

function clampHour(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(23, Math.round(n)));
}

function clampMinute(n: number) {
  if (!Number.isFinite(n)) return 0;
  return n >= 30 ? 30 : 0;
}

function clampSessionHours(n: number) {
  if (!Number.isFinite(n)) return 2;
  const stepped = Math.round(n * 2) / 2;
  return Math.max(0.5, Math.min(8, stepped));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatHours(h: number) {
  const v = Math.round(h * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function loadPrefs(): SessionSchedulePrefs {
  try {
    for (const key of [STORAGE_KEY, STORAGE_KEY_V2, STORAGE_KEY_V1]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (key === STORAGE_KEY_V1) {
        const from = clampHour(Number(parsed.hourFrom ?? 18));
        const to = clampHour(Number(parsed.hourTo ?? 23));
        const mid = clampHour(Math.floor((from + (to > from ? to : to + 24)) / 2) % 24);
        return normalizePrefs({
          dates: [],
          slots: [
            { id: uid(), hour: from, minute: 0 },
            { id: uid(), hour: mid === from ? (from + 4) % 24 : mid, minute: 0 },
          ],
          sessionHours: 2,
        });
      }
      return normalizePrefs(parsed as Partial<SessionSchedulePrefs>);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

function normalizePrefs(raw: Partial<SessionSchedulePrefs>): SessionSchedulePrefs {
  const dates = Array.isArray(raw.dates)
    ? [...new Set(raw.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
    : [];
  let slots = Array.isArray(raw.slots)
    ? raw.slots
        .filter((s) => s && typeof s === "object")
        .map((s) => ({
          id: typeof s.id === "string" ? s.id : uid(),
          hour: clampHour(Number(s.hour)),
          minute: clampMinute(Number(s.minute ?? 0)),
        }))
    : [];
  if (slots.length === 0) slots = DEFAULT_PREFS.slots.map((s) => ({ ...s, id: uid() }));
  slots.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return {
    dates,
    slots,
    sessionHours: clampSessionHours(Number(raw.sessionHours ?? 2)),
  };
}

function savePrefs(prefs: SessionSchedulePrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/** GG20260715-1724… → date + hour from filename (most reliable for schedule). */
function wallClockFromFilename(filename: string | null | undefined): { date: string; hour: number } | null {
  if (!filename) return null;
  const m = filename.match(/GG(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/i);
  if (!m) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, hour: Number(m[4]) };
}

/** Calendar day / hour — prefer GG filename, then wall clock in started_at (no TZ shift). */
function sessionWallClock(s: SessionProfitRow): { date: string; hour: number } | null {
  const fromFile = wallClockFromFilename(s.source_filename);
  if (fromFile) return fromFile;

  if (!s.started_at) return null;
  const raw = String(s.started_at).trim();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2})(?::(\d{2}))?/);
  if (m) {
    return { date: m[1], hour: Number(m[2]) };
  }
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) return { date: dateOnly[1], hour: 12 };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { date: toDateInput(d), hour: d.getHours() };
}

function sessionDateIso(s: SessionProfitRow): string | null {
  return sessionWallClock(s)?.date ?? null;
}

function fmtHandsShort(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Mark play dates on calendar, set session starts + duration. */
export default function SessionSchedulePanel() {
  const [prefs, setPrefs] = useState<SessionSchedulePrefs>(() => loadPrefs());
  const boot = peekLatestResultsCache();
  const [sessions, setSessions] = useState<SessionProfitRow[]>(
    () => boot?.sessions ?? [],
  );
  const [loading, setLoading] = useState(() => !boot);
  const [viewMonth, setViewMonth] = useState(() => toDateInput(new Date()));

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    let cancelled = false;
    const cached = peekLatestResultsCache();
    if (cached?.sessions?.length) {
      setSessions(cached.sessions);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void getResults({})
      .then((res) => {
        if (cancelled) return;
        setSessions(res.sessions ?? []);
        writeResultsCache(resultsFingerprint(""), res);
      })
      .catch(() => {
        if (!cancelled && !cached) setSessions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markedSet = useMemo(() => new Set(prefs.dates), [prefs.dates]);

  /** Hands per calendar day from the active profile hand database (all sittings). */
  const dateStats = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const s of sessions) {
      const iso = sessionDateIso(s);
      if (!iso) continue;
      byDate.set(iso, (byDate.get(iso) ?? 0) + (s.hands_count ?? 0));
    }
    return byDate;
  }, [sessions]);

  const monthDays = useMemo(() => {
    const base = viewMonth.match(/^(\d{4})-(\d{2})/)
      ? viewMonth
      : toDateInput(new Date());
    const [ys, ms] = base.split("-");
    const y = Number(ys);
    const m = Number(ms);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const startPad = (first.getDay() + 6) % 7;
    const cells: ({ iso: string; day: number } | null)[] = [];
    for (let i = 0; i < startPad; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      cells.push({ iso: `${ys}-${ms}-${pad(d)}`, day: d });
    }
    return {
      year: y,
      month: m,
      prefix: `${ys}-${ms}`,
      label: first.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }),
      cells,
    };
  }, [viewMonth]);

  const todayIso = useMemo(() => toDateInput(new Date()), []);

  const maxDayFact = useMemo(() => {
    let max = 1;
    for (const n of dateStats.values()) {
      if (n > max) max = n;
    }
    return max;
  }, [dateStats]);

  /** Days 1…N of the viewed month for the volume strip (not the weekday calendar). */
  const monthDayList = useMemo(
    () => monthDays.cells.filter((c): c is NonNullable<typeof c> => c != null),
    [monthDays.cells],
  );

  const volume = useMemo(() => {
    const prefix = monthDays.prefix;
    const markedInMonth = prefs.dates.filter((d) => d.startsWith(prefix));
    const planDays = markedInMonth.length;
    const slotsPerDay = Math.max(1, prefs.slots.length);
    const hoursPerSession = prefs.sessionHours;
    const planSessions = planDays * slotsPerDay;
    const planHours = planSessions * hoursPerSession;

    let factSessions = 0;
    let factHands = 0;
    for (const s of sessions) {
      const iso = sessionDateIso(s);
      if (!iso || !iso.startsWith(prefix)) continue;
      factSessions += 1;
      factHands += s.hands_count ?? 0;
    }
    const factHours = factSessions * hoursPerSession;
    const pct =
      planHours > 0 ? Math.min(100, Math.round((factHours / planHours) * 100)) : 0;

    let playedMarked = 0;
    for (const iso of markedInMonth) {
      if ((dateStats.get(iso) ?? 0) > 0) playedMarked += 1;
    }

    return {
      planDays,
      planSessions,
      planHours,
      factSessions,
      factHours,
      factHands,
      pct,
      playedMarked,
    };
  }, [monthDays.prefix, prefs.dates, prefs.sessionHours, sessions, dateStats]);

  function toggleDate(iso: string) {
    setPrefs((prev) => {
      const has = prev.dates.includes(iso);
      const dates = has
        ? prev.dates.filter((d) => d !== iso)
        : [...prev.dates, iso].sort();
      return { ...prev, dates };
    });
  }

  function addSlot() {
    setPrefs((prev) => {
      if (prev.slots.length >= 6) return prev;
      const used = new Set(prev.slots.map((s) => s.hour));
      let hour = 12;
      for (let h = 10; h < 24; h += 1) {
        if (!used.has(h)) {
          hour = h;
          break;
        }
      }
      const slots = [...prev.slots, { id: uid(), hour, minute: 0 }].sort(
        (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
      );
      return { ...prev, slots };
    });
  }

  function removeSlot(id: string) {
    setPrefs((prev) => {
      if (prev.slots.length <= 1) return prev;
      return { ...prev, slots: prev.slots.filter((s) => s.id !== id) };
    });
  }

  function updateSlot(id: string, patch: Partial<Pick<SessionSlot, "hour" | "minute">>) {
    setPrefs((prev) => ({
      ...prev,
      slots: prev.slots
        .map((s) =>
          s.id === id
            ? {
                ...s,
                hour: patch.hour != null ? clampHour(patch.hour) : s.hour,
                minute: patch.minute != null ? clampMinute(patch.minute) : s.minute,
              }
            : s,
        )
        .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)),
    }));
  }

  function shiftMonth(delta: number) {
    const [ys, ms] = viewMonth.split("-").map(Number);
    const d = new Date(ys, ms - 1 + delta, 1);
    setViewMonth(toDateInput(d));
  }

  const dayHours = formatHours(prefs.slots.length * prefs.sessionHours);
  const remainHours = Math.max(0, volume.planHours - volume.factHours);
  const ringR = 42;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - volume.pct / 100);
  const compareMax = Math.max(volume.planHours, volume.factHours, 0.1);

  // Day volume strip: 1…daysInMonth, bar centered over its day number
  const dayChartW = 480;
  const dayChartH = 78;
  const dayPadL = 4;
  const dayPadR = 4;
  const dayPadT = 10;
  const dayPadB = 18;
  const dayN = Math.max(1, monthDayList.length);
  const dayPlotW = dayChartW - dayPadL - dayPadR;
  const dayPlotH = dayChartH - dayPadT - dayPadB;
  const dayGap = 1.25;
  const dayBarW = (dayPlotW - dayGap * (dayN - 1)) / dayN;

  return (
    <div className="session-schedule">
      <header className="session-schedule-head">
        <div>
          <h2>Расписание</h2>
          <p className="muted">Все сессии из базы в профиле (не только последний анализ)</p>
        </div>
        <span className="session-schedule-pill">
          {formatHours(prefs.sessionHours)}ч · {prefs.slots.length}× · {dayHours}ч/день
        </span>
      </header>

      <section className="schedule-shell" aria-label="Объём игровых сессий">
        <div className="schedule-volume-hero">
          <div className="schedule-ring-wrap" aria-hidden={loading}>
            <svg
              className="schedule-ring"
              viewBox="0 0 100 100"
              role="img"
              aria-label={`Выполнение плана ${volume.pct}%`}
            >
              <defs>
                <linearGradient id="schedRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#c8ffce" />
                  <stop offset="55%" stopColor="#88f991" />
                  <stop offset="100%" stopColor="#2f9d6a" />
                </linearGradient>
              </defs>
              <circle className="schedule-ring-track" cx="50" cy="50" r={ringR} />
              <circle
                className="schedule-ring-value"
                cx="50"
                cy="50"
                r={ringR}
                strokeDasharray={ringC}
                strokeDashoffset={loading ? ringC : ringOffset}
              />
            </svg>
            <div className="schedule-ring-label">
              {loading ? (
                <strong>—</strong>
              ) : (
                <>
                  <strong>{volume.pct}</strong>
                  <em>%</em>
                </>
              )}
              <span>план</span>
            </div>
          </div>

          <div className="schedule-volume-aside">
            <div className="schedule-volume-title">
              <strong>{monthDays.label}</strong>
              {!loading && volume.planDays === 0 ? (
                <em className="schedule-volume-hint">Нет выбранных дней</em>
              ) : null}
            </div>

            {loading ? (
              <p className="muted schedule-inline-muted">Загрузка…</p>
            ) : (
              <div className="schedule-volume-cards">
                <article className="schedule-vol-card is-plan">
                  <em>Цель</em>
                  <strong>{formatHours(volume.planHours)}ч</strong>
                  <span>
                    {volume.planDays
                      ? `${volume.planDays} дн. · ${volume.planSessions} сесс.`
                      : "—"}
                  </span>
                  <i
                    className="schedule-vol-meter"
                    style={{ width: `${(volume.planHours / compareMax) * 100}%` }}
                  />
                </article>
                <article className="schedule-vol-card is-fact">
                  <em>Сыграно</em>
                  <strong>{formatHours(volume.factHours)}ч</strong>
                  <span>
                    {volume.factSessions} сесс.
                    {volume.factHands > 0
                      ? ` · ${volume.factHands.toLocaleString("ru-RU")} рук`
                      : ""}
                  </span>
                  <i
                    className="schedule-vol-meter"
                    style={{ width: `${(volume.factHours / compareMax) * 100}%` }}
                  />
                </article>
                <article className="schedule-vol-card is-left">
                  <em>Остаток</em>
                  <strong>{formatHours(remainHours)}ч</strong>
                  <span>
                    {Math.max(0, volume.planSessions - volume.factSessions)} сесс.
                    {volume.planDays > 0
                      ? ` · ${volume.playedMarked}/${volume.planDays} дн.`
                      : ""}
                  </span>
                  <i
                    className="schedule-vol-meter"
                    style={{
                      width: `${volume.planHours > 0 ? (remainHours / volume.planHours) * 100 : 0}%`,
                    }}
                  />
                </article>
              </div>
            )}
          </div>
        </div>

        <div className="schedule-toolbar">
          <label className="schedule-field">
            Длительность
            <select
              value={prefs.sessionHours}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  sessionHours: clampSessionHours(Number(e.target.value)),
                }))
              }
            >
              {[0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8].map((h) => (
                <option key={h} value={h}>
                  {formatHours(h)} ч
                </option>
              ))}
            </select>
          </label>

          <div className="schedule-slots-inline" role="group" aria-label="Время старта">
            {prefs.slots.map((slot, i) => (
              <div key={slot.id} className="schedule-slot-chip">
                <em>#{i + 1}</em>
                <select
                  aria-label={`Время сессии ${i + 1}, час`}
                  value={slot.hour}
                  onChange={(e) => updateSlot(slot.id, { hour: Number(e.target.value) })}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {pad(h)}
                    </option>
                  ))}
                </select>
                <span>:</span>
                <select
                  aria-label={`Время сессии ${i + 1}, минуты`}
                  value={slot.minute}
                  onChange={(e) => updateSlot(slot.id, { minute: Number(e.target.value) })}
                >
                  <option value={0}>00</option>
                  <option value={30}>30</option>
                </select>
                <button
                  type="button"
                  className="schedule-slot-x"
                  disabled={prefs.slots.length <= 1}
                  aria-label="Удалить время"
                  onClick={() => removeSlot(slot.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="schedule-add-btn"
              disabled={prefs.slots.length >= 6}
              onClick={addSlot}
            >
              + Время
            </button>
          </div>
        </div>

        <div className="schedule-cal-block">
          <header className="schedule-section-head">
            <h3>Игровые дни</h3>
            <div className="schedule-month-nav">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
                ‹
              </button>
              <strong>{monthDays.label}</strong>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
                ›
              </button>
            </div>
          </header>

          <div className="schedule-day-volume">
            <header className="schedule-day-volume-head">
              <h4>Объём по дням</h4>
              <p className="muted">Раздачи из базы за каждый день месяца (1–{dayN})</p>
            </header>
            <svg
              viewBox={`0 0 ${dayChartW} ${dayChartH}`}
              className="schedule-day-volume-svg"
              role="img"
              aria-label="Объём раздач по дням месяца"
            >
              {monthDayList.map((cell, i) => {
                const fact = dateStats.get(cell.iso) ?? 0;
                const planned = markedSet.has(cell.iso);
                const x = dayPadL + i * (dayBarW + dayGap);
                const bh = fact > 0 ? Math.max(8, (fact / maxDayFact) * dayPlotH) : 2;
                const y = dayPadT + dayPlotH - bh;
                const cx = x + dayBarW / 2;
                return (
                  <g key={cell.iso}>
                    <rect
                      className={`schedule-day-vol-bar${fact ? " has-fact" : ""}${planned ? " is-on" : ""}`}
                      x={x}
                      y={y}
                      width={dayBarW}
                      height={bh}
                      rx={1.25}
                    >
                      <title>
                        {fact > 0
                          ? `${cell.day} число: ${fact.toLocaleString("ru-RU")} рук`
                          : `${cell.day} число: нет раздач`}
                      </title>
                    </rect>
                    {fact > 0 ? (
                      <text className="schedule-day-vol-count" x={cx} y={y - 2}>
                        {fmtHandsShort(fact)}
                      </text>
                    ) : null}
                    <text
                      className={`schedule-day-vol-tick${fact ? " is-hot" : ""}`}
                      x={cx}
                      y={dayChartH - 4}
                    >
                      {cell.day}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="schedule-cal-weekdays" aria-hidden>
            {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="schedule-cal-grid" role="grid" aria-label="Календарь игровых дней">
            {monthDays.cells.map((cell, i) => {
              if (!cell) return <span key={`pad-${i}`} className="schedule-cal-pad" />;
              const on = markedSet.has(cell.iso);
              const fact = dateStats.get(cell.iso) ?? 0;
              const isToday = cell.iso === todayIso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  role="gridcell"
                  className={`schedule-cal-day${on ? " is-on" : ""}${fact ? " has-fact" : ""}${isToday ? " is-today" : ""}`}
                  aria-pressed={on}
                  title={
                    fact > 0
                      ? `${cell.day}: ${fact.toLocaleString("ru-RU")} рук${on ? ", в цели" : ""}`
                      : `${cell.day}${on ? ": в цели" : ""}`
                  }
                  onClick={() => toggleDate(cell.iso)}
                >
                  <strong>{cell.day}</strong>
                  {fact > 0 ? <em>{fmtHandsShort(fact)}</em> : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
