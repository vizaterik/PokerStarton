import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createStrategy, deleteStrategy, listStrategies, Strategy } from "../api/client";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  FORMAT_OPTIONS,
  formatBadge,
  presetsFor,
  type ModulePreset,
  type StrategyFormat,
} from "../lib/strategyModules";
import "./StrategiesPage.css";

function limitHint(message: string) {
  if (!/лимит тарифа/i.test(message)) return null;
  return (
    <p className="muted">
      <Link to="/profile">Открыть тарифы в профиле</Link>
    </p>
  );
}

const NAME_EXAMPLES: Record<StrategyFormat, string[]> = {
  cash: ["NL100 6-max GTO", "Кэш BTN open", "Cash Leak-hunter"],
  mtt: ["MTT 6-max Bubble", "Sunday 8-max Ante", "MTT Финал Push"],
  spins: ["Spin 15bb Push", "Hyper Spin 25bb", "Spin 3-max BTN"],
};

const STAGE_LABEL: Record<string, string> = {
  early: "ранняя",
  ante: "анте",
  bubble: "баббл",
  final: "финал",
};

type WizardStep = 1 | 2 | 3;

export default function StrategiesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Strategy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Strategy | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [step, setStep] = useState<WizardStep>(1);
  const [format, setFormat] = useState<StrategyFormat>("cash");
  const [preset, setPreset] = useState<ModulePreset | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const presets = useMemo(() => presetsFor(format), [format]);
  const nameOk = name.trim().length >= 2;
  const nameExamples = NAME_EXAMPLES[format];
  const namePlaceholder = `Например: ${nameExamples[0]}`;

  async function refresh() {
    try {
      setItems(await listStrategies());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить стратегии");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setPreset(presets[0] ?? null);
  }, [presets]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!preset || !nameOk) {
      setError("Введите название стратегии (минимум 2 символа).");
      setStep(3);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createStrategy({
        name: name.trim(),
        format: preset.format,
        table_size: preset.table_size,
        stack_depth: preset.stack_depth,
        mtt_stage: preset.mtt_stage,
        action_mode: preset.action_mode,
      });
      setName("");
      setStep(1);
      navigate(`/strategies/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
    } finally {
      setCreating(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteStrategy(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  }

  function strategyMeta(s: Strategy) {
    const parts = [
      formatBadge(s.format ?? "cash"),
      s.table_size ?? "6-max",
      s.stack_depth ?? "100bb",
    ];
    if (s.mtt_stage) parts.push(STAGE_LABEL[s.mtt_stage] ?? s.mtt_stage);
    if (s.action_mode === "push_fold") parts.push("Push-Fold");
    return parts.join(" · ");
  }

  return (
    <section className="page strat-page">
      <header className="strat-page-head">
        <h1>Стратегии</h1>
        <p className="lead">
          Модули Cash, MTT и Spins: стол, стек и диапазоны в одном регламенте.
        </p>
      </header>
      {error && (
        <>
          <p className="error">{error}</p>
          {limitHint(error)}
        </>
      )}

      <div className="strat-layout">
        <form className="panel strat-col strat-wizard" onSubmit={onCreate}>
          <header className="strat-col-head">
            <div className="strat-col-title">
              <h2>Новая стратегия</h2>
              <p className="strat-col-sub muted">Cash · MTT · Spins</p>
            </div>
            <ol className="strat-wizard-steps" aria-label="Шаги создания">
              <li className={step === 1 ? "is-active" : step > 1 ? "is-done" : ""}>
                <span>1</span> Модуль
              </li>
              <li className={step === 2 ? "is-active" : step > 2 ? "is-done" : ""}>
                <span>2</span> Пресет
              </li>
              <li className={step === 3 ? "is-active" : ""}>
                <span>3</span> Название
              </li>
            </ol>
          </header>

          {step === 1 ? (
            <div key="step-1" className="strat-wizard-body">
              <p className="muted">Выберите формат игры и доступные позиции.</p>
              <div className="strat-format-grid">
                {FORMAT_OPTIONS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`strat-format-card${format === f.id ? " is-active" : ""}`}
                    onClick={() => setFormat(f.id)}
                  >
                    <strong>{f.title}</strong>
                    <span>{f.lead}</span>
                  </button>
                ))}
              </div>
              <div className="strat-wizard-actions">
                <button type="button" className="cta" onClick={() => setStep(2)}>
                  Далее
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div key="step-2" className="strat-wizard-body">
              <p className="muted">
                {format === "cash"
                  ? "Кэш: один режим — 6-max 100bb."
                  : format === "mtt"
                    ? "МТТ: выберите 6-max или 8-max и стадию турнира."
                    : "Spins: только 3-max — выберите глубину стека (bb)."}
              </p>
              <div className="strat-preset-grid">
                {presets.map((p) => (
                  <button
                    key={`${p.format}-${p.table_size}-${p.stack_depth}-${p.mtt_stage ?? "x"}`}
                    type="button"
                    className={`strat-preset-card${preset?.label === p.label ? " is-active" : ""}`}
                    onClick={() => setPreset(p)}
                  >
                    <strong>{p.label}</strong>
                    <em>
                      {p.table_size} · {p.stack_depth}
                      {p.action_mode === "push_fold" ? " · Push-Fold" : ""}
                      {p.mtt_stage ? ` · ${STAGE_LABEL[p.mtt_stage] ?? p.mtt_stage}` : ""}
                    </em>
                  </button>
                ))}
              </div>
              <div className="strat-wizard-actions">
                <button type="button" className="cta-secondary" onClick={() => setStep(1)}>
                  Назад
                </button>
                <button
                  type="button"
                  className="cta"
                  disabled={!preset}
                  onClick={() => setStep(3)}
                >
                  Далее
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div key="step-3" className="strat-wizard-body">
              {preset ? (
                <p className="strat-wizard-summary">
                  <span className={`strat-fmt-pill strat-fmt-${preset.format}`}>
                    {formatBadge(preset.format)}
                  </span>{" "}
                  {preset.label}
                  {preset.action_mode === "push_fold" ? (
                    <span className="badge">Push-Fold</span>
                  ) : null}
                </p>
              ) : null}
              <label htmlFor="name">Название стратегии</label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={namePlaceholder}
                required
                minLength={2}
                autoFocus
              />
              <div className="strat-name-examples" aria-label="Примеры названий">
                <span className="strat-name-examples-label">Примеры:</span>
                {nameExamples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="strat-name-chip"
                    onClick={() => setName(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </div>
              {!nameOk ? (
                <p className="muted strat-name-hint">Укажите название, чтобы открыть редактор.</p>
              ) : null}
              <div className="strat-wizard-actions">
                <button type="button" className="cta-secondary" onClick={() => setStep(2)}>
                  Назад
                </button>
                <button type="submit" className="cta" disabled={creating || !preset || !nameOk}>
                  {creating ? "Создание…" : "Создать и открыть"}
                </button>
              </div>
            </div>
          ) : null}
        </form>

        <aside className="panel strat-col strat-library" aria-label="Библиотека стратегий">
          <header className="strat-col-head">
            <div className="strat-col-title">
              <h2>Библиотека</h2>
              <p className="strat-col-sub muted">Ваши игровые модули</p>
            </div>
            <span className="strat-library-count" aria-label={`Всего ${items.length}`}>
              {items.length}
            </span>
          </header>

          {items.length === 0 ? (
            <div className="strat-library-empty">
              <p>Библиотека пуста</p>
              <span className="muted">Соберите первую стратегию — Cash, MTT или Spins.</span>
            </div>
          ) : (
            <ul className="strat-library-list">
              {items.map((s) => {
                const fmt = (s.format ?? "cash") as StrategyFormat;
                return (
                  <li key={s.id} className={`strat-card strat-card-${fmt}`}>
                    <Link to={`/strategies/${s.id}`} className="strat-card-main">
                      <div className="strat-card-top">
                        <span className={`strat-fmt-pill strat-fmt-${fmt}`}>{formatBadge(fmt)}</span>
                        {s.is_default ? <span className="strat-card-default">по умолчанию</span> : null}
                      </div>
                      <strong className="strat-card-name">{s.name}</strong>
                      <span className="strat-card-meta">{strategyMeta(s)}</span>
                    </Link>
                    <div className="strat-card-actions">
                      <Link className="strat-card-open" to={`/strategies/${s.id}`}>
                        Конструктор
                      </Link>
                      <button
                        type="button"
                        className="strat-card-delete"
                        disabled={deleting && pendingDelete?.id === s.id}
                        onClick={() => setPendingDelete(s)}
                      >
                        Удалить
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={pendingDelete != null}
        title="Удалить стратегию?"
        description={
          pendingDelete
            ? `«${pendingDelete.name}» будет удалён вместе с чартами. Сессии сохранятся.`
            : ""
        }
        confirmLabel="Удалить"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
