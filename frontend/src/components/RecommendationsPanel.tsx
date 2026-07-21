import { useEffect, useState } from "react";
import {
  fetchStrategyRecommendations,
  type HudEvalItem,
  type RecommendationHandItem,
  type RecommendationsResponse,
} from "../api/client";
import {
  buildLocalRecommendations,
  clearLocalRecommendationsCache,
} from "../engine/localRecommendations";
import { peekAnalysisCache } from "../lib/analysisCache";
import HandReplayModal from "./HandReplayModal";

type Props = {
  strategyId: string;
  revision?: number;
};

type RecSub = "top" | "discipline" | "damage" | "pot" | "plan" | "grade";

const SUBS: { id: RecSub; label: string }[] = [
  { id: "top", label: "Топ-5 ошибок" },
  { id: "discipline", label: "Дисциплина" },
  { id: "damage", label: "Дорогие лики" },
  { id: "pot", label: "Банк" },
  { id: "plan", label: "План" },
  { id: "grade", label: "Оценка" },
];

function fmtHudValue(item: HudEvalItem) {
  if (item.value == null) return "—";
  if (item.unit === "ratio") return item.value.toFixed(2);
  return `${item.value.toFixed(1)}%`;
}

function statusLabel(status: string) {
  if (status === "low") return "ниже нормы";
  if (status === "high") return "выше нормы";
  if (status === "ok") return "в норме";
  return "мало данных";
}

const ACTION_RU: Record<string, string> = {
  fold: "Фолд",
  call: "Колл",
  raise: "Рейз",
  check: "Чек",
};

function actionLabel(a: string) {
  return ACTION_RU[a] ?? a;
}

function Money({ value, negative }: { value: number; negative?: boolean }) {
  const n = Math.abs(value);
  const sign = negative || value < 0 ? "−" : "";
  return (
    <span className="rec-money">
      {sign}${n.toFixed(2)}
    </span>
  );
}

function HandCard({
  item,
  onOpen,
}: {
  item: RecommendationHandItem;
  onOpen: (handId: string) => void;
}) {
  return (
    <li
      className="rec-card clickable-row"
      role="button"
      tabIndex={0}
      title="Открыть реплей"
      onClick={() => onOpen(item.hand_id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(item.hand_id);
        }
      }}
    >
      <div className="rec-card-top">
        <div className="rec-card-title">
          <strong>{item.title}</strong>
          <span className="rec-card-id">#{item.external_hand_id}</span>
        </div>
        <button
          type="button"
          className="rec-open-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(item.hand_id);
          }}
        >
          Открыть раздачу
        </button>
      </div>

      <div className="rec-hand-strip">
        <div>
          <em>Карты</em>
          <strong>{item.hero_cards || item.hand_code}</strong>
          <span>{item.hand_code}</span>
        </div>
        <div>
          <em>Позиция</em>
          <strong>{item.position}</strong>
        </div>
        <div>
          <em>Улица</em>
          <strong>{item.street.toUpperCase()}</strong>
        </div>
        {item.board.length > 0 ? (
          <div>
            <em>Борд</em>
            <strong>{item.board.join(" ")}</strong>
          </div>
        ) : null}
        <div>
          <em>Банк</em>
          <strong>${item.pot_before.toFixed(2)}</strong>
        </div>
        {item.bet_amount > 0 ? (
          <div>
            <em>Ставка</em>
            <strong>${item.bet_amount.toFixed(2)}</strong>
          </div>
        ) : null}
        <div>
          <em>Потеря</em>
          <strong className="rec-loss">
            <Money value={item.lost_money} negative />
          </strong>
        </div>
        {item.ev_loss > 0 ? (
          <div>
            <em>−EV спота</em>
            <strong>
              <Money value={item.ev_loss} negative />
            </strong>
          </div>
        ) : null}
      </div>

      <div className="rec-actions-row">
        <span className="rec-act rec-act-bad">
          Было: <b>{actionLabel(item.actual_action)}</b>
        </span>
        <span className="rec-act-arrow" aria-hidden>
          →
        </span>
        <span className="rec-act rec-act-good">
          Нужно: <b>{actionLabel(item.correct_action)}</b>
        </span>
        {item.pot_odds_pct != null && item.equity_pct != null ? (
          <span className="rec-math-pill">
            pot odds {item.pot_odds_pct}% · equity {item.equity_pct}%
            {item.outs != null ? ` · ${item.outs} outs` : ""}
          </span>
        ) : null}
      </div>

      <p className="rec-analysis">{item.analysis}</p>

      <div className="rec-example">
        <em>Пример как должно быть</em>
        <p>{item.example}</p>
      </div>
    </li>
  );
}

export default function RecommendationsPanel({ strategyId, revision = 0 }: Props) {
  const [sub, setSub] = useState<RecSub>("top");
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"local" | "server">("local");
  const [replayIds, setReplayIds] = useState<string[] | null>(null);
  const [replayStart, setReplayStart] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    setProgress(null);

    const localFp = peekAnalysisCache(strategyId)?.fingerprint?.startsWith("local:");
    if (localFp) {
      setSource("local");
      clearLocalRecommendationsCache();
      void buildLocalRecommendations(strategyId, (message) => {
        if (!controller.signal.aborted) setProgress(message);
      })
        .then((res) => {
          if (!controller.signal.aborted) setData(res);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : "Не удалось посчитать математику");
          setData(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
            setProgress(null);
          }
        });
    } else {
      setSource("server");
      void fetchStrategyRecommendations(strategyId, controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) setData(res);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof Error && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Не удалось загрузить рекомендации");
          setData(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }

    return () => {
      controller.abort();
    };
  }, [strategyId, revision]);

  const openHand = (list: RecommendationHandItem[], handId: string) => {
    const ids = list.map((x) => x.hand_id);
    const idx = Math.max(0, ids.indexOf(handId));
    setReplayIds(ids);
    setReplayStart(idx);
  };

  if (loading) {
    const handsHint = peekAnalysisCache(strategyId)?.handTotal;
    const base =
      progress ||
      (source === "local"
        ? "Считаем отчёт по текущей сессии…"
        : "Считаем отчёт по раздачам в базе…");
    return (
      <p className="muted">
        {base}
        {handsHint && handsHint > 0 ? ` · ${handsHint.toLocaleString("ru-RU")} рук` : ""}
      </p>
    );
  }
  if (error) {
    return <p className="error">{error}</p>;
  }
  if (!data) {
    return <p className="muted">Нет данных для разбора.</p>;
  }

  const handsInDb = data.hands_count;
  if (handsInDb === 0) {
    return (
      <div className="rec-panel">
        <header className="rec-head">
          <h2>Отчёт</h2>
          <p className="muted">
            {source === "local"
              ? "В текущей сессии нет раздач. Загрузите историю на странице Анализ."
              : "В активной базе нет раздач. Загрузите историю на странице Анализ."}
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="rec-panel">
      <header className="rec-head">
        <div className="rec-head-row">
          <div>
            <h2>Отчёт</h2>
            <p className="muted">
              Разбор{" "}
              <strong>
                {source === "local" ? "текущей сессии" : "активной сессии в базе"}
              </strong>
              : топ ошибок и ключевые цифры из уже посчитанного отчёта. Сверка с
              чартами — во вкладке «Стратегии».{" "}
              {typeof handsInDb === "number" ? (
                <>
                  Раздач: <strong>{handsInDb.toLocaleString("ru-RU")}</strong>
                  {" · "}
                </>
              ) : null}
              замечаний: <strong>{data.math_errors}</strong>
              {data.total_damage_money > 0 ? (
                <>
                  {" "}
                  · дорогие лики ≈{" "}
                  <strong className="rec-loss">${data.total_damage_money.toFixed(2)}</strong>
                </>
              ) : null}
            </p>
          </div>
          {data.evaluation ? (
            <button
              type="button"
              className="rec-score-badge"
              onClick={() => setSub("grade")}
              title="Открыть оценку игры"
            >
              <span className="rec-score-num">{data.evaluation.score.toFixed(1)}</span>
              <span className="rec-score-of">/10</span>
              <em>{data.evaluation.label}</em>
            </button>
          ) : null}
        </div>
      </header>

      <div className="preflop-subtabs" role="tablist" aria-label="Отчёт">
        {SUBS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={sub === s.id}
            className={sub === s.id ? "active" : ""}
            onClick={() => setSub(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sub === "top" ? (
        <section className="rec-section">
          <h3>Топ-5 ошибок</h3>
          <p className="muted rec-lead">
            Самые дорогие −EV решения из уже посчитанного отчёта по базе / сессии.
          </p>
          {data.critical_damage.length === 0 ? (
            <p className="rec-empty">Критических ошибок не найдено.</p>
          ) : (
            <ul className="rec-list rec-list-damage">
              {[...data.critical_damage]
                .sort((a, b) => b.lost_money - a.lost_money)
                .slice(0, 5)
                .map((item) => (
                  <HandCard
                    key={`${item.hand_id}-top`}
                    item={item}
                    onOpen={(id) => openHand(data.critical_damage, id)}
                  />
                ))}
            </ul>
          )}
        </section>
      ) : null}

      {sub === "discipline" ? (
        <section className="rec-section">
          <h3>Дисциплина</h3>
          <p className="muted rec-lead">
            Дорогие −EV коллы и слишком широкие открытия по позиционным порогам и pot odds.
          </p>
          {data.discipline.length === 0 ? (
            <p className="rec-empty">Префлоп −EV спотов не найдено.</p>
          ) : (
            <ul className="rec-list">
              {data.discipline.map((item) => (
                <HandCard
                  key={`${item.hand_id}-pf`}
                  item={item}
                  onOpen={(id) => openHand(data.discipline, id)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {sub === "damage" ? (
        <section className="rec-section">
          <h3>Дорогие лики</h3>
          <p className="muted rec-lead">
            Топ спотов, где −EV решение сильнее всего ударило по стеку.
          </p>
          {data.critical_damage.length === 0 ? (
            <p className="rec-empty">Крупных −EV ликов в загруженных раздачах не найдено.</p>
          ) : (
            <ul className="rec-list rec-list-damage">
              {[...data.critical_damage]
                .sort((a, b) => b.lost_money - a.lost_money)
                .slice(0, 5)
                .map((item) => (
                <HandCard
                  key={`${item.hand_id}-dmg`}
                  item={item}
                  onOpen={(id) => openHand(data.critical_damage, id)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {sub === "pot" ? (
        <section className="rec-section">
          <h3>Банк</h3>
          <p className="muted rec-lead">
            Коллы с дро на постфлопе, где pot odds выше equity (правило аутов ×2).
          </p>
          {data.pot_odds.length === 0 ? (
            <p className="rec-empty">−EV коллов с дро не найдено.</p>
          ) : (
            <ul className="rec-list">
              {data.pot_odds.map((item) => (
                <HandCard
                  key={`${item.hand_id}-${item.street}-${item.bet_amount}`}
                  item={item}
                  onOpen={(id) => openHand(data.pot_odds, id)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {sub === "plan" ? (
        <section className="rec-section">
          <h3>План на игру</h3>
          <p className="muted rec-lead">Чек-лист на следующую сессию по вашим самым дорогим математическим ошибкам.</p>
          <ol className="rec-plan">
            {data.plan.map((item) => (
              <li key={item.priority}>
                <span className="rec-plan-num">{item.priority}</span>
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {sub === "grade" ? (
        <section className="rec-section">
          <h3>Оценка игры</h3>
          {!data.evaluation ? (
            <p className="rec-empty">Недостаточно данных для оценки.</p>
          ) : (
            <>
              <div className="rec-grade-hero">
                <div className="rec-grade-ring" data-score={Math.round(data.evaluation.score)}>
                  <strong>{data.evaluation.score.toFixed(1)}</strong>
                  <span>из 10</span>
                </div>
                <div className="rec-grade-meta">
                  <h4>{data.evaluation.label}</h4>
                  <p>{data.evaluation.summary}</p>
                  <div className="rec-grade-split">
                    <span>
                      Отчёт <b>{data.evaluation.math_score.toFixed(1)}</b>
                    </span>
                    <span>
                      HUD <b>{data.evaluation.hud_score.toFixed(1)}</b>
                    </span>
                    <span>
                      Раздач <b>{data.evaluation.hands}</b>
                    </span>
                    <span>
                      Уверенность{" "}
                      <b>
                        {data.evaluation.confidence === "high"
                          ? "высокая"
                          : data.evaluation.confidence === "medium"
                            ? "средняя"
                            : "низкая"}
                      </b>
                    </span>
                  </div>
                </div>
              </div>

              {data.evaluation.focus.length > 0 ? (
                <div className="rec-focus">
                  <h4>Что подтянуть в первую очередь</h4>
                  <ol>
                    {data.evaluation.focus.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <h4 className="rec-hud-title">Разбор HUD</h4>
              <p className="muted rec-lead">
                Сравнение с коридором солидного 6-max рега: агрессия, вскрытие, стил, gap VPIP−PFR.
              </p>
              <ul className="rec-hud-list">
                {data.evaluation.hud.map((item) => (
                  <li key={item.key} className={`rec-hud-card status-${item.status}`}>
                    <div className="rec-hud-top">
                      <strong>{item.label}</strong>
                      <span className={`rec-hud-status status-${item.status}`}>
                        {statusLabel(item.status)}
                      </span>
                    </div>
                    <div className="rec-hud-vals">
                      <span className="rec-hud-value">{fmtHudValue(item)}</span>
                      <span className="muted">
                        цель{" "}
                        {item.target_min != null && item.target_max != null
                          ? item.unit === "ratio"
                            ? `${item.target_min}–${item.target_max}`
                            : `${item.target_min}–${item.target_max}%`
                          : "—"}
                        {" · "}n={item.samples}
                        {" · "}
                        {item.score.toFixed(1)}/10
                      </span>
                    </div>
                    <p>{item.recommendation}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      <HandReplayModal
        open={replayIds != null}
        strategyId={strategyId}
        handIds={replayIds}
        initialHandIndex={replayStart}
        label="Рекомендация · раздача"
        onClose={() => setReplayIds(null)}
      />
    </div>
  );
}
