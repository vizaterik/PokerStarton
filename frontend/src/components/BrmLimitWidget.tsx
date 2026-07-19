import type { LimitProgress, LimitVerdict } from "../lib/brmStrategies";
import { blindsCaption, resolveBrmGameMode } from "../lib/brmStrategies";

type Props = {
  verdict: LimitVerdict;
  currency?: string;
  gameMode?: string;
};

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function ProgressRow({
  title,
  progress,
  currency,
}: {
  title: string;
  progress: LimitProgress;
  currency: string;
}) {
  const blinds = progress.blinds ? ` ${progress.blinds}` : "";
  return (
    <div className={`brm-progress${progress.reached ? " is-done" : ""}`}>
      <div className="brm-progress-head">
        <strong>
          {title}: {progress.label}
          {blinds}
        </strong>
        <span>
          {progress.reached
            ? "достигнуто"
            : `ещё $${formatMoney(progress.remaining)} ${currency}`}
        </span>
      </div>
      <div
        className="brm-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.pct)}
        aria-label={`${title} ${progress.label}`}
      >
        <i style={{ width: `${progress.pct}%` }} />
      </div>
      <p className="brm-progress-meta muted">
        ${formatMoney(progress.have)} из ${formatMoney(progress.needTotal)}{" "}
        {currency} · {progress.pct.toFixed(0)}%
      </p>
    </div>
  );
}

/** Плашка-рекомендатор лимита по БРМ. */
export default function BrmLimitWidget({
  verdict,
  currency = "USD",
  gameMode = "cash",
}: Props) {
  const mode = resolveBrmGameMode(gameMode);
  const tone =
    verdict.status === "shot"
      ? "shot"
      : verdict.status === "drop" || verdict.status === "shortfall"
        ? "warn"
        : verdict.status === "empty"
          ? "empty"
          : "ok";

  const stake = verdict.recommended;
  const bankroll = verdict.affordableBuyin * verdict.requiredBuyins;
  const stakeBuyin = stake?.buyin ?? null;
  const blinds = stake ? blindsCaption(stake, mode) : "";
  const needTotal =
    stakeBuyin != null ? stakeBuyin * verdict.requiredBuyins : null;

  const showGoal =
    verdict.goalProgress &&
    (!verdict.nextProgress ||
      verdict.goalProgress.label !== verdict.nextProgress.label);

  return (
    <section className={`brm-verdict brm-verdict-${tone}`} aria-live="polite">
      <header className="brm-verdict-head">
        <span className="kpi-label">Рекомендация по лимиту</span>
        <strong className="brm-verdict-title">{verdict.headline}</strong>
      </header>
      <p className="brm-verdict-detail">{verdict.detail}</p>
      {stake && verdict.status !== "empty" ? (
        <dl className="brm-verdict-stats">
          <div>
            <dt>Лимит</dt>
            <dd>
              {stake.label}
              {blinds ? ` ${blinds}` : ""}
            </dd>
          </div>
          <div>
            <dt>Бай-ин</dt>
            <dd>
              ${formatMoney(stake.buyin)} {currency}
              {mode === "cash" ? " (100 бб)" : ""}
            </dd>
          </div>
          <div>
            <dt>Нужно</dt>
            <dd>${formatMoney(needTotal ?? 0)}</dd>
          </div>
          <div>
            <dt>Есть</dt>
            <dd>${formatMoney(bankroll)}</dd>
          </div>
          {verdict.stopLossBuyins != null ? (
            <div>
              <dt>Стоп-лосс шота</dt>
              <dd>−{verdict.stopLossBuyins} бай-ина</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {verdict.nextProgress ? (
        <ProgressRow
          title="До следующего лимита"
          progress={verdict.nextProgress}
          currency={currency}
        />
      ) : null}
      {showGoal && verdict.goalProgress ? (
        <ProgressRow
          title="До цели"
          progress={verdict.goalProgress}
          currency={currency}
        />
      ) : null}

      {verdict.status === "shortfall" && stake && needTotal != null ? (
        <p className="brm-verdict-hint muted">
          Для {stake.label} нужно ${formatMoney(needTotal)}, есть $
          {formatMoney(bankroll)}.
        </p>
      ) : null}
    </section>
  );
}
