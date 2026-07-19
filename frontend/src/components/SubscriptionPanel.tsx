import { useCallback, useEffect, useState } from "react";
import { getSubscription, selectPlan, SubscriptionInfo } from "../api/client";

function formatLimit(n: number | null | undefined, unlimited: boolean): string {
  if (unlimited || n == null) return "безлимит";
  return n.toLocaleString("ru-RU");
}

export default function SubscriptionPanel() {
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSub(await getSubscription());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить подписку");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSelect(planId: string) {
    if (!sub || planId === sub.plan.id) return;
    setBusyId(planId);
    setError(null);
    try {
      setSub(await selectPlan(planId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить тариф");
    } finally {
      setBusyId(null);
    }
  }

  if (!sub) {
    return (
      <div className="profile-card profile-sub-card">
        <h2>Подписка</h2>
        <p className="muted">{error ?? "Загрузка тарифов…"}</p>
      </div>
    );
  }

  const { plan, usage, plans, plan_started_at } = sub;

  return (
    <div className="profile-card profile-sub-card">
      <div className="profile-sub-head">
        <div>
          <h2>Подписка</h2>
          <p className="muted">Mock-оплата: выбор тарифа сразу переключает лимиты.</p>
        </div>
        <div className="profile-sub-current">
          <span className="profile-sub-badge">{plan.name}</span>
          <strong>
            ${plan.price_usd} / мес · {plan.price_rub.toLocaleString("ru-RU")} ₽
          </strong>
          {plan_started_at ? (
            <em>
              активен с {new Date(plan_started_at).toLocaleDateString("ru-RU")}
            </em>
          ) : null}
        </div>
      </div>

      <div className="profile-sub-usage">
        <div>
          <span>Стратегии</span>
          <strong>
            {usage.strategies} / {formatLimit(usage.strategies_limit, plan.unlimited_strategies)}
          </strong>
        </div>
        <div>
          <span>Раздачи за {usage.quota_month}</span>
          <strong>
            {usage.hands_month.toLocaleString("ru-RU")} /{" "}
            {formatLimit(usage.hands_month_limit, plan.unlimited_hands)}
          </strong>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="plan-grid">
        {plans.map((p) => {
          const current = p.id === plan.id;
          return (
            <article
              key={p.id}
              className={`plan-card${current ? " is-current" : ""}${p.is_hit ? " is-hit" : ""}`}
            >
              {p.is_hit ? <span className="plan-hit">Хит продаж</span> : null}
              <h3>{p.name}</h3>
              <p className="plan-tagline">{p.tagline}</p>
              <p className="plan-price">
                <strong>${p.price_usd}</strong>
                <span>/ мес</span>
              </p>
              <p className="plan-price-rub">{p.price_rub.toLocaleString("ru-RU")} ₽</p>
              <ul>
                {p.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <button
                type="button"
                className={current ? "cta-secondary" : "cta"}
                disabled={current || busyId === p.id}
                onClick={() => void onSelect(p.id)}
              >
                {current ? "Текущий" : busyId === p.id ? "Переключение…" : "Выбрать"}
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
