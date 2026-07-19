import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchTrainerDeal,
  gradeTrainerDeal,
  listStrategies,
  type Strategy,
  type TrainerDeal,
  type TrainerGrade,
} from "../api/client";
import PokerTable from "../components/PokerTable";
import PotOddsDrillPanel from "../components/PotOddsDrillPanel";
import { shortBranchLabel } from "../lib/branchLabel";
import {
  FORMAT_OPTIONS,
  type StrategyFormat,
  actionLabel,
  formatBadge,
  parseStackBb,
  positionsFor,
  situationsFor,
} from "../lib/strategyModules";

type Phase = "setup" | "session";
type TrainerMode = "chart" | "pot_odds";

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function strategyFormat(s: Strategy): StrategyFormat {
  const f = (s.format || "cash").toLowerCase();
  if (f === "mtt" || f === "spins") return f;
  return "cash";
}

function VerdictMark({ ok }: { ok: boolean }) {
  if (ok) {
    return (
      <span className="trainer-verdict-mark ok" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="44" height="44">
          <circle cx="24" cy="24" r="22" />
          <path d="M14 24.5 L21 31.5 L34 16.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="trainer-verdict-mark bad" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="44" height="44">
        <circle cx="24" cy="24" r="22" />
        <path d="M16 16 L32 32 M32 16 L16 32" />
      </svg>
    </span>
  );
}

export default function TrainerPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [mode, setMode] = useState<TrainerMode>("chart");
  const [phase, setPhase] = useState<Phase>("setup");
  const [format, setFormat] = useState<StrategyFormat>("cash");
  const [strategyId, setStrategyId] = useState("");
  const [spots, setSpots] = useState<string[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [deal, setDeal] = useState<TrainerDeal | null>(null);
  const [grade, setGrade] = useState<TrainerGrade | null>(null);
  const [loading, setLoading] = useState(false);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState({ ok: 0, total: 0 });
  const seenRef = useRef<string[]>([]);
  const prefetchRef = useRef<TrainerDeal | null>(null);
  const prefetchingRef = useRef(false);

  const formatStrategies = useMemo(
    () => strategies.filter((s) => strategyFormat(s) === format),
    [strategies, format],
  );

  const activeStrategy = useMemo(
    () => strategies.find((s) => s.id === strategyId) ?? null,
    [strategies, strategyId],
  );

  const tableSize = activeStrategy?.table_size || (format === "spins" ? "3-max" : "6-max");
  const actionMode =
    (activeStrategy?.action_mode as "standard" | "push_fold") || "standard";
  const stackBb = parseStackBb(activeStrategy?.stack_depth || "100bb");
  const availablePositions = useMemo(() => positionsFor(tableSize), [tableSize]);
  const availableSituations = useMemo(() => situationsFor(actionMode), [actionMode]);
  const canStart = mode === "pot_odds" || Boolean(strategyId);

  useEffect(() => {
    void listStrategies()
      .then((list) => {
        setStrategies(list);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Не удалось загрузить стратегии");
      });
  }, []);

  useEffect(() => {
    if (phase !== "setup") return;
    const preferred =
      formatStrategies.find((s) => s.is_default) ?? formatStrategies[0] ?? null;
    setStrategyId(preferred?.id ?? "");
    setPositions([]);
    setSpots([]);
  }, [format, formatStrategies, phase]);

  useEffect(() => {
    setPositions((prev) => prev.filter((p) => availablePositions.includes(p)));
  }, [availablePositions]);

  useEffect(() => {
    setSpots((prev) =>
      prev.filter((k) => availableSituations.some((s) => s.key === k)),
    );
  }, [availableSituations]);

  const dealOpts = useCallback(
    (exclude: string[]) => ({
      mode: "all" as const,
      exclude: exclude.slice(-12),
      positions: positions.length ? positions : undefined,
      spots: spots.length ? spots : undefined,
    }),
    [positions, spots],
  );

  const prefetchNext = useCallback(
    async (exclude: string[]) => {
      if (!strategyId || prefetchingRef.current) return;
      prefetchingRef.current = true;
      try {
        prefetchRef.current = await fetchTrainerDeal(strategyId, dealOpts(exclude));
      } catch {
        prefetchRef.current = null;
      } finally {
        prefetchingRef.current = false;
      }
    },
    [strategyId, dealOpts],
  );

  const loadDeal = useCallback(
    async (resetSeen = false) => {
      if (!strategyId) return;
      setLoading(true);
      setError(null);
      setGrade(null);
      if (resetSeen) {
        seenRef.current = [];
        prefetchRef.current = null;
      }

      const pre = prefetchRef.current;
      prefetchRef.current = null;
      if (pre && !resetSeen && !seenRef.current.includes(pre.hand_id)) {
        setDeal(pre);
        seenRef.current = [...seenRef.current, pre.hand_id].slice(-24);
        setLoading(false);
        void prefetchNext(seenRef.current);
        return;
      }

      try {
        const next = await fetchTrainerDeal(strategyId, dealOpts(seenRef.current));
        setDeal(next);
        seenRef.current = [...seenRef.current, next.hand_id].slice(-24);
        void prefetchNext(seenRef.current);
      } catch (err: unknown) {
        if (seenRef.current.length > 0) {
          seenRef.current = [];
          try {
            const next = await fetchTrainerDeal(strategyId, dealOpts([]));
            setDeal(next);
            seenRef.current = [next.hand_id];
            void prefetchNext(seenRef.current);
            setLoading(false);
            return;
          } catch (err2: unknown) {
            setDeal(null);
            setError(err2 instanceof Error ? err2.message : "Нет раздачи");
            setLoading(false);
            return;
          }
        }
        setDeal(null);
        setError(err instanceof Error ? err.message : "Нет раздачи");
      } finally {
        setLoading(false);
      }
    },
    [strategyId, dealOpts, prefetchNext],
  );

  function startSession() {
    if (!canStart) return;
    setScore({ ok: 0, total: 0 });
    setDeal(null);
    setGrade(null);
    setError(null);
    setPhase("session");
    if (mode === "chart") void loadDeal(true);
  }

  function backToSetup() {
    setPhase("setup");
    setDeal(null);
    setGrade(null);
    setError(null);
    prefetchRef.current = null;
    seenRef.current = [];
  }

  function togglePosition(pos: string) {
    setPositions((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos],
    );
  }

  function toggleSpot(key: string) {
    setSpots((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  async function onChoose(action: "fold" | "call" | "raise") {
    if (!strategyId || !deal || grade || grading) return;
    setGrading(true);
    setError(null);
    try {
      const result = await gradeTrainerDeal(strategyId, deal.hand_id, action);
      setGrade(result);
      setScore((s) => ({
        ok: s.ok + (result.correct ? 1 : 0),
        total: s.total + 1,
      }));
      void prefetchNext(seenRef.current);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Не удалось проверить");
    } finally {
      setGrading(false);
    }
  }

  const hand = grade?.hand ?? deal?.hand ?? null;
  // Always pause just before hero acts so turn highlight stays on Hero.
  const actionIndex = deal?.pause_at ?? -1;

  const raiseLabel = actionLabel("raise", actionMode);
  const callLabel = actionLabel("call", actionMode);
  const foldLabel = actionLabel("fold", actionMode);
  const pushFold = actionMode === "push_fold";

  return (
    <section className="page trainer-page">
      <header className="trainer-head">
        <div>
          <h1>Тренажёр</h1>
          <p className="lead">
            {phase === "setup"
              ? "Выбери режим: сверка с чартом или упражнения на ауты и pot odds."
              : mode === "pot_odds"
                ? "Считай ауты, эквити (×2) и шансы банка — Call или Fold."
                : "Реплей до твоего решения — сравни с чартом стратегии."}
          </p>
        </div>
        {phase === "session" ? (
          <div className="trainer-score" aria-label="Счёт">
            <strong>{score.total > 0 ? `${score.ok}/${score.total}` : "—"}</strong>
            <span>
              {score.total > 0
                ? `${Math.round((100 * score.ok) / score.total)}% верно`
                : "ещё нет ответов"}
            </span>
          </div>
        ) : null}
      </header>

      {phase === "setup" ? (
        <div className="trainer-setup">
          <section className="trainer-setup-block">
            <h2>Режим</h2>
            <div className="trainer-format-switch" role="group" aria-label="Режим тренажёра">
              <button
                type="button"
                className={`trainer-format-chip${mode === "chart" ? " is-active" : ""}`}
                onClick={() => setMode("chart")}
              >
                <strong>Чарт стратегии</strong>
                <span>Раздачи из базы · сверка с вашими диапазонами</span>
              </button>
              <button
                type="button"
                className={`trainer-format-chip${mode === "pot_odds" ? " is-active" : ""}`}
                onClick={() => setMode("pot_odds")}
              >
                <strong>Ауты и шансы банка</strong>
                <span>Флеш-дро, стрит-дро, гатшот + оверкарты · Call / Fold</span>
              </button>
            </div>
          </section>

          {mode === "pot_odds" ? (
            <>
              <section className="trainer-setup-block">
                <h2>Что тренируем</h2>
                <p className="trainer-setup-sub">
                  Много раздач: флеш-дро, OESD, гатшот, оверкарты, комбо-дро. Считай ауты →
                  эквити (×2) → pot odds = ставка / (банк + 2×ставка). Equity ≥ odds — Call,
                  иначе Fold.
                </p>
              </section>
              <div className="trainer-setup-actions">
                <button type="button" className="trainer-start" onClick={startSession}>
                  Начать упражнения
                </button>
              </div>
            </>
          ) : (
            <>
          <section className="trainer-setup-block">
            <h2>Формат</h2>
            <div className="trainer-format-switch" role="group" aria-label="Формат">
              {FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`trainer-format-chip${format === opt.id ? " is-active" : ""}`}
                  onClick={() => setFormat(opt.id)}
                >
                  <strong>{opt.title}</strong>
                  <span>{opt.lead}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="trainer-setup-block">
            <h2>Стратегия</h2>
            {formatStrategies.length === 0 ? (
              <p className="muted">
                Нет стратегий для {formatBadge(format)}. Создай в разделе «Стратегии».
              </p>
            ) : (
              <label className="trainer-setup-select">
                Выбери стратегию
                <select
                  value={strategyId}
                  onChange={(e) => {
                    setStrategyId(e.target.value);
                    setPositions([]);
                    setSpots([]);
                  }}
                >
                  {formatStrategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.stack_depth ? ` · ${s.stack_depth}` : ""}
                      {s.table_size ? ` · ${s.table_size}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <section className="trainer-setup-block">
            <h2>Ситуации</h2>
            <p className="trainer-setup-sub">Пусто = все споты доступного режима</p>
            <div className="trainer-pos-filter" role="group" aria-label="Ситуации">
              <button
                type="button"
                className={`trainer-pos-chip${spots.length === 0 ? " is-on" : ""}`}
                onClick={() => setSpots([])}
              >
                Все
              </button>
              {availableSituations.map((sit) => (
                <button
                  key={sit.key}
                  type="button"
                  className={`trainer-pos-chip${spots.includes(sit.key) ? " is-on" : ""}`}
                  onClick={() => toggleSpot(sit.key)}
                >
                  {sit.label}
                </button>
              ))}
            </div>
          </section>

          <section className="trainer-setup-block">
            <h2>Позиции</h2>
            <p className="trainer-setup-sub">
              Фильтр перед стартом · {tableSize}
              {pushFold ? " · Push / Fold" : ""}
            </p>
            <div className="trainer-pos-filter" role="group" aria-label="Позиции решения">
              <button
                type="button"
                className={`trainer-pos-chip${positions.length === 0 ? " is-on" : ""}`}
                onClick={() => setPositions([])}
              >
                Все
              </button>
              {availablePositions.map((pos) => (
                <button
                  key={pos}
                  type="button"
                  className={`trainer-pos-chip${positions.includes(pos) ? " is-on" : ""}`}
                  onClick={() => togglePosition(pos)}
                >
                  {pos}
                </button>
              ))}
            </div>
          </section>

          <div className="trainer-setup-actions">
            <button
              type="button"
              className="trainer-start"
              disabled={!canStart}
              onClick={startSession}
            >
              Начать тренировку
            </button>
          </div>
            </>
          )}
        </div>
      ) : mode === "pot_odds" ? (
        <PotOddsDrillPanel
          score={score}
          onScore={(ok) =>
            setScore((s) => ({ ok: s.ok + (ok ? 1 : 0), total: s.total + 1 }))
          }
          onExit={backToSetup}
        />
      ) : (
        <>
          <div className="trainer-session-bar">
            <div className="trainer-session-meta">
              <strong>{activeStrategy?.name ?? "Стратегия"}</strong>
              <span>
                {formatBadge(format)}
                {positions.length ? ` · ${positions.join(", ")}` : " · все позиции"}
                {spots.length ? ` · ${spots.length} сит.` : ""}
                {` · ~${stackBb}bb`}
              </span>
            </div>
            <div className="trainer-session-actions">
              <button type="button" className="trainer-ghost" onClick={backToSetup}>
                Настройки
              </button>
              <button
                type="button"
                className="trainer-next"
                disabled={loading || !strategyId}
                onClick={() => void loadDeal(false)}
              >
                {loading ? "…" : "Следующая"}
              </button>
            </div>
          </div>

          {error ? <p className="error">{error}</p> : null}

          {hand && deal ? (
            <div className="trainer-stage">
              <div className="trainer-meta-bar">
                <span className="trainer-hand-code">{deal.hand_code}</span>
                <strong>
                  {shortBranchLabel(
                    deal.spot_key,
                    deal.hero_position,
                    deal.villain_position,
                  )}
                </strong>
                <em>
                  {deal.hero_position ?? "—"}
                  {deal.villain_position ? ` vs ${deal.villain_position}` : ""}
                  {` · ~${stackBb}bb`}
                </em>
              </div>

              <div className="trainer-table-wrap">
                <PokerTable
                  hand={hand}
                  actionIndex={actionIndex}
                  amountUnit="bb"
                  maxStackBb={stackBb}
                />
              </div>

              <div className="trainer-controls">
                {!grade ? (
                  <>
                    <p className="trainer-prompt">
                      {pushFold ? "Push или Fold?" : "Твоё решение префлоп"}
                    </p>
                    <div className="trainer-actions">
                      <button
                        type="button"
                        className="act-btn fold"
                        disabled={grading}
                        onClick={() => void onChoose("fold")}
                      >
                        {foldLabel}
                      </button>
                      {!pushFold ? (
                        <button
                          type="button"
                          className="act-btn call"
                          disabled={grading}
                          onClick={() => void onChoose("call")}
                        >
                          {callLabel}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="act-btn raise"
                        disabled={grading}
                        onClick={() => void onChoose("raise")}
                      >
                        {raiseLabel}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={`trainer-feedback${grade.correct ? " ok" : " bad"}`}>
                    <div className="trainer-verdict">
                      <VerdictMark ok={grade.correct} />
                      <div>
                        <strong>{grade.correct ? "Верно" : "Ошибка"}</strong>
                        <p>{grade.tip}</p>
                      </div>
                    </div>
                    <div className="trainer-mix" aria-label="Микс чарта">
                      {grade.raise_freq > 0.005 ? (
                        <i className="bar raise" style={{ flex: grade.raise_freq }} />
                      ) : null}
                      {grade.call_freq > 0.005 ? (
                        <i className="bar call" style={{ flex: grade.call_freq }} />
                      ) : null}
                      {grade.fold_freq > 0.005 ? (
                        <i className="bar fold" style={{ flex: grade.fold_freq }} />
                      ) : null}
                    </div>
                    <ul className="trainer-mix-legend">
                      <li>
                        <span className="act raise">{raiseLabel}</span> {pct(grade.raise_freq)}
                      </li>
                      {!pushFold ? (
                        <li>
                          <span className="act call">{callLabel}</span> {pct(grade.call_freq)}
                        </li>
                      ) : null}
                      <li>
                        <span className="act fold">{foldLabel}</span> {pct(grade.fold_freq)}
                      </li>
                    </ul>
                    {grade.played_in_hh ? (
                      <p className="muted trainer-hh">
                        В раздаче сыграл:{" "}
                        <span className={`act ${grade.played_in_hh}`}>
                          {actionLabel(grade.played_in_hh, actionMode)}
                        </span>
                        {" · "}
                        ты выбрал:{" "}
                        <span className={`act ${grade.chosen}`}>
                          {actionLabel(grade.chosen, actionMode)}
                        </span>
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="trainer-next"
                      onClick={() => void loadDeal(false)}
                    >
                      Дальше
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            !loading && !error && <p className="muted">Загружаю раздачу…</p>
          )}
        </>
      )}
    </section>
  );
}
