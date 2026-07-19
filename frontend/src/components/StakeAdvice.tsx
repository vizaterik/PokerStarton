import type { BankrollSettings, StakeRecommendation } from "../api/client";
import { resolveBrmGameMode } from "../lib/brmStrategies";

type Props = {
  settings: BankrollSettings;
  compact?: boolean;
  sessionBigBlind?: number | null;
};

function roleLabel(role: string) {
  if (role === "primary") return "Основной";
  if (role === "soft") return "Мягкий";
  if (role === "stretch") return "Выше";
  return role;
}

function stakeMeta(s: StakeRecommendation, gameMode: string) {
  // Для МТТ и спинов показываем только бай-ин, без «$0.00 ББ»
  if (gameMode !== "cash" || s.big_blind <= 0) {
    return `бай-ин $${s.buyin_100bb}`;
  }
  return `$${s.big_blind.toFixed(2)} ББ · бай-ин $${s.buyin_100bb}`;
}

function fitForSession(bb: number | null | undefined, stakes: StakeRecommendation[]) {
  if (bb == null || stakes.length === 0) return null;
  const primary = stakes.find((s) => s.role === "primary");
  if (!primary) return null;
  const near = (a: number, b: number) => Math.abs(a - b) < Math.max(0.005, b * 0.05);
  if (near(bb, primary.big_blind)) return { kind: "ok" as const, text: `Сессия на ${primary.label} — в рамках стиля` };
  const soft = stakes.find((s) => s.role === "soft");
  if (soft && near(bb, soft.big_blind)) return { kind: "soft" as const, text: `Сессия на ${soft.label} — мягкий лимит` };
  const stretch = stakes.find((s) => s.role === "stretch");
  if (stretch && near(bb, stretch.big_blind))
    return { kind: "stretch" as const, text: `Сессия на ${stretch.label} — выше комфорта` };
  if (bb > primary.big_blind) return { kind: "high" as const, text: "Лимит сессии выше рекомендации" };
  return { kind: "low" as const, text: "Лимит сессии ниже рекомендации — можно поднимать" };
}

export default function StakeAdvice({ settings, compact, sessionBigBlind }: Props) {
  const stakes = settings.recommended_stakes ?? [];
  const gameMode = resolveBrmGameMode(settings.game_mode);

  if (settings.balance <= 0) {
    return (
      <div className={`stake-advice${compact ? " compact" : ""}`}>
        <p className="muted" style={{ margin: 0 }}>
          Задайте банкролл в «Карьера → Банкролл», чтобы получить рекомендации по лимитам.
        </p>
      </div>
    );
  }

  const fit = fitForSession(sessionBigBlind, stakes);
  const primary = stakes.find((s) => s.role === "primary");
  const shortfall = Boolean(primary?.shortfall);
  const headline = settings.primary_stake
    ? shortfall
      ? `Играйте ${settings.primary_stake} (банкролл ниже цели)`
      : `Играйте ${settings.primary_stake}`
    : "Нет подходящего лимита";

  return (
    <div className={`stake-advice${compact ? " compact" : ""}`}>
      {compact ? (
        <div className="stake-advice-head">
          <div>
            <span className="kpi-label">Рекомендация к сессии</span>
            <strong>{headline}</strong>
          </div>
          {fit && <span className={`stake-fit ${fit.kind}`}>{fit.text}</span>}
        </div>
      ) : null}

      {stakes.length > 0 && (
        <div className="stake-chips">
          {stakes.map((s) => (
            <div
              key={s.label}
              className={`stake-chip role-${s.role}${shortfall && s.role === "primary" ? " shortfall" : ""}`}
            >
              <strong>{s.label}</strong>
              <span>{roleLabel(s.role)}</span>
              <em>{stakeMeta(s, gameMode)}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
