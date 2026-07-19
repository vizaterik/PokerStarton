import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BankrollOverview,
  bankrollTxn,
  getBankroll,
  updateBankrollProfile,
} from "../api/client";
import {
  BRM_GAME_MODE_OPTIONS,
  BRM_STRATEGIES,
  BRM_STRATEGY_ORDER,
  buyinsRangeLabel,
  calculateLimitVerdict,
  resolveBrmGameMode,
  resolveBrmStrategyId,
  stakeLadderFor,
  type BrmGameMode,
  type BrmStrategyId,
} from "../lib/brmStrategies";
import BrmLimitWidget from "./BrmLimitWidget";
import StakeAdvice from "./StakeAdvice";

export type BankrollSection = "overview" | "update" | "strategy";

type Props = {
  section?: BankrollSection;
};

export default function BankrollPanel({ section = "overview" }: Props) {
  const [data, setData] = useState<BankrollOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    void getBankroll()
      .then((overview) => {
        setData(overview);
        if (overview.settings.balance > 0) {
          setAmount(String(overview.settings.balance));
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Не удалось загрузить банкролл"),
      );
  }, []);

  const gameMode = resolveBrmGameMode(data?.settings.game_mode);
  const strategyId = resolveBrmStrategyId(data?.settings.risk_profile ?? "standard");
  const goalStake = data?.settings.goal_stake ?? null;

  const verdict = useMemo(() => {
    const balance = data?.settings.balance ?? 0;
    return calculateLimitVerdict(balance, gameMode, strategyId, goalStake);
  }, [data?.settings.balance, gameMode, strategyId, goalStake]);

  const ladder = useMemo(() => stakeLadderFor(gameMode), [gameMode]);

  const activeStrategy = BRM_STRATEGIES[strategyId];
  const stopLoss = activeStrategy.stopLossBuyins?.[gameMode] ?? null;

  async function persistPrefs(patch: {
    risk_profile?: string;
    game_mode?: string;
    goal_stake?: string | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      const body =
        patch.goal_stake === null
          ? { ...patch, goal_stake: "" }
          : patch;
      const settings = await updateBankrollProfile(body);
      setData((prev) => {
        if (!prev) return prev;
        const mode = resolveBrmGameMode(settings.game_mode);
        const profiles = BRM_STRATEGY_ORDER.map((id) => {
          const s = BRM_STRATEGIES[id];
          return {
            id: s.id,
            name: s.name,
            description: s.description,
            buyins_range: buyinsRangeLabel(s, mode),
            buyins_target: s.buyins[mode],
            session_tip: s.sessionTip,
            stop_loss_buyins: s.stopLossBuyins?.[mode] ?? null,
          };
        });
        return { ...prev, settings, profiles };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  }

  async function onSelectMode(mode: BrmGameMode) {
    if (mode === gameMode) return;
    await persistPrefs({ game_mode: mode });
  }

  async function onSelectStrategy(id: BrmStrategyId) {
    if (id === strategyId) return;
    await persistPrefs({ risk_profile: id });
  }

  async function onSelectGoal(label: string) {
    const next = label === "" ? null : label;
    if (next === goalStake) return;
    await persistPrefs({ goal_stake: next });
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) {
      setError("Введите корректный банкролл");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await bankrollTxn({
        kind: "set",
        amount: value,
        note: note.trim() || undefined,
      });
      setData(next);
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить банкролл");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <p className="muted">{error ?? "Загрузка банкролла…"}</p>;
  }

  const { settings, entries } = data;

  const goalBlock = (
    <div className="bankroll-block brm-goal">
      <h2>Цель по лимиту</h2>
      <p className="muted bankroll-block-lead">
        Выбери лимит, к которому идёшь — покажем, сколько ещё нужно по правилам БРМ.
      </p>
      <label htmlFor="br-goal">Лимит-цель</label>
      <select
        id="br-goal"
        value={goalStake ?? ""}
        disabled={busy}
        onChange={(e) => void onSelectGoal(e.target.value)}
      >
        <option value="">Без цели (только следующий лимит)</option>
        {ladder.map((s) => (
          <option key={s.label} value={s.label}>
            {s.label}
            {gameMode === "cash" && s.bigBlind > 0
              ? ` · $${s.smallBlind.toFixed(2)}/$${s.bigBlind.toFixed(2)} · бай-ин $${s.buyin}`
              : ` · бай-ин $${s.buyin}`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="bankroll-panel">
      {error ? <p className="error">{error}</p> : null}

      {section === "overview" ? (
        <>
          <div className="bankroll-hero">
            <div>
              <span className="kpi-label">Текущий банкролл</span>
              <strong className="bankroll-balance">
                {settings.balance.toFixed(2)} <em>{settings.currency}</em>
              </strong>
            </div>
            <div className="bankroll-hero-meta">
              <span className="muted">
                {activeStrategy.name} ·{" "}
                {BRM_GAME_MODE_OPTIONS.find((m) => m.id === gameMode)?.title ?? gameMode}
                {goalStake ? ` · цель ${goalStake}` : ""}
              </span>
            </div>
          </div>
          {goalBlock}
          <BrmLimitWidget
            verdict={verdict}
            currency={settings.currency}
            gameMode={gameMode}
          />
          <StakeAdvice settings={settings} />
        </>
      ) : null}

      {section === "update" ? (
        <div className="bankroll-grid-2">
          <form className="bankroll-block" onSubmit={onSave}>
            <h2>Обновить банкролл</h2>
            <p className="muted bankroll-block-lead">
              Задай текущую сумму. Дальше баланс обновляется из загрузок сессий.
            </p>
            <label htmlFor="br-amount">Банкролл</label>
            <input
              id="br-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="2500"
              required
            />
            <label htmlFor="br-note">Комментарий (необязательно)</label>
            <input
              id="br-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: обновил после недели игры"
            />
            <button
              type="submit"
              className="cta"
              disabled={busy}
              style={{ width: "100%", marginTop: "0.5rem" }}
            >
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </form>

          <div className="bankroll-block">
            <h2>История обновлений</h2>
            {entries.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Пока пусто — задай стартовый банкролл или загрузи сессию в Анализе.
              </p>
            ) : (
              <ul className="ledger-list">
                {entries.map((e) => {
                  const isSession = e.kind === "session";
                  const delta =
                    e.amount === 0
                      ? "±0.00"
                      : `${e.amount > 0 ? "+" : ""}${e.amount.toFixed(2)}`;
                  return (
                    <li key={e.id}>
                      <div>
                        <strong>{isSession ? "Сессия" : "Обновление"}</strong>
                        <span className="muted">
                          {new Date(e.created_at).toLocaleString("ru-RU", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {e.note ? ` · ${e.note}` : ""}
                        </span>
                      </div>
                      <div className="ledger-amounts">
                        <span>
                          {e.balance_after.toFixed(2)} {settings.currency}
                        </span>
                        <em
                          className={
                            isSession ? (e.amount >= 0 ? "plus" : "minus") : undefined
                          }
                        >
                          {delta}
                        </em>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {section === "strategy" ? (
        <>
          <div className="bankroll-block brm-controls">
            <div className="brm-controls-row">
              <span className="brm-controls-label">Режим</span>
              <div className="brm-seg" role="tablist" aria-label="Режим игры">
                {BRM_GAME_MODE_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={gameMode === m.id}
                    className={gameMode === m.id ? "is-active" : ""}
                    disabled={busy}
                    onClick={() => void onSelectMode(m.id)}
                  >
                    {m.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="brm-controls-row">
              <span className="brm-controls-label">Стратегия</span>
              <div className="brm-seg brm-seg-brm" role="tablist" aria-label="Стратегия">
                {BRM_STRATEGY_ORDER.map((id) => {
                  const s = BRM_STRATEGIES[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={strategyId === id}
                      className={strategyId === id ? "is-active" : ""}
                      disabled={busy}
                      onClick={() => void onSelectStrategy(id)}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {goalBlock}

          <section className="brm-focus" aria-label="Выбранная стратегия">
            <header className="brm-focus-head">
              <div>
                <span className="kpi-label">Выбрано</span>
                <h2 className="brm-focus-title">{activeStrategy.name}</h2>
              </div>
              <span className="brm-focus-bi">
                {buyinsRangeLabel(activeStrategy, gameMode)}
              </span>
            </header>
            <p className="brm-focus-desc">{activeStrategy.description}</p>
            <p className="brm-focus-tip">
              {stopLoss != null
                ? `Стоп-лосс шота: −${stopLoss} бай-ина — затем обязательный спуск.`
                : activeStrategy.sessionTip}
            </p>

            <BrmLimitWidget
              verdict={verdict}
              currency={settings.currency}
              gameMode={gameMode}
            />
            <StakeAdvice settings={settings} />
          </section>
        </>
      ) : null}
    </div>
  );
}
