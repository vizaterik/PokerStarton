import { useMemo, useState } from "react";
import type { ReplayAction, ReplayHand, ReplaySeat } from "../api/client";
import { POT_ODDS_DRILLS, type PotOddsDrill } from "../data/potOddsDrills";
import PokerTable from "./PokerTable";

/** Same 6-max order / table scale as chart trainer. */
const SEATS_6 = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;

function splitCards(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
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

function seatName(pos: string, heroPos: string, villainPos: string) {
  if (pos === heroPos) return "Hero";
  if (pos === villainPos) return "Villain";
  return `Seat ${SEATS_6.indexOf(pos as (typeof SEATS_6)[number]) + 1}`;
}

/** 6-max flop spot — same table layout/scale as chart trainer. */
function buildReplayHand(
  drill: PotOddsDrill,
  heroChoice: "CALL" | "FOLD" | null,
): { hand: ReplayHand; pauseAt: number } {
  const heroCards = splitCards(drill.hero_hand);
  const board = splitCards(drill.board);
  const half = drill.pot_size / 2;
  const heroPos = drill.hero_position;
  const villainPos = drill.villain_position;

  const seats: ReplaySeat[] = SEATS_6.map((pos, i) => {
    const isHero = pos === heroPos;
    return {
      seat: i + 1,
      name: seatName(pos, heroPos, villainPos),
      position: pos,
      stack: 100,
      is_hero: isHero,
      is_button: pos === "BTN",
      cards: isHero ? heroCards.join("") : null,
    };
  });

  const actions: ReplayAction[] = [];
  let order = 0;

  for (const pos of SEATS_6) {
    const name = seatName(pos, heroPos, villainPos);
    const isHero = pos === heroPos;
    if (pos === villainPos) {
      actions.push({
        street: "preflop",
        order: order++,
        player_name: name,
        is_hero: false,
        action: "raise",
        amount: half,
      });
      continue;
    }
    if (pos === heroPos) {
      actions.push({
        street: "preflop",
        order: order++,
        player_name: name,
        is_hero: true,
        action: "call",
        amount: half,
      });
      continue;
    }
    actions.push({
      street: "preflop",
      order: order++,
      player_name: name,
      is_hero: isHero,
      action: "fold",
      amount: null,
    });
  }

  const villainBetOrder = order;
  actions.push({
    street: "flop",
    order: order++,
    player_name: "Villain",
    is_hero: false,
    action: "raise",
    amount: drill.opponent_bet,
  });

  const heroDecideOrder = order;
  actions.push({
    street: "flop",
    order: order++,
    player_name: "Hero",
    is_hero: true,
    // Placeholder until answered — keeps Hero turn highlight while Villain bet is on table.
    action: heroChoice === "FOLD" ? "fold" : "call",
    amount: heroChoice === "FOLD" ? null : drill.opponent_bet,
  });

  const hand: ReplayHand = {
    id: `pod-${drill.id}`,
    external_hand_id: `pod-${drill.id}`,
    played_at: null,
    table_name: "Pot Odds Drill",
    small_blind: 0.5,
    big_blind: 1,
    hero_name: "Hero",
    hero_position: heroPos,
    hero_cards: heroCards,
    board,
    hero_net: 0,
    hero_net_bb: 0,
    seats,
    actions,
    raw_text: "",
  };

  // After villain bet: chip visible, next actor = Hero (turn glow).
  // After answer: show Hero CALL/FOLD pill.
  return {
    hand,
    pauseAt: heroChoice ? heroDecideOrder : villainBetOrder,
  };
}

type Props = {
  score: { ok: number; total: number };
  onScore: (correct: boolean) => void;
  onExit: () => void;
};

export default function PotOddsDrillPanel({ score, onScore, onExit }: Props) {
  const [order] = useState(() => {
    const ids = POT_ODDS_DRILLS.map((_, i) => i);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    return ids;
  });
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<"CALL" | "FOLD" | null>(null);

  const drill: PotOddsDrill | null = useMemo(() => {
    const idx = order[cursor % order.length];
    return idx == null ? null : POT_ODDS_DRILLS[idx] ?? null;
  }, [order, cursor]);

  const replay = useMemo(
    () => (drill ? buildReplayHand(drill, picked) : null),
    [drill, picked],
  );

  if (!drill || !replay) return null;

  const revealed = picked != null;
  const correct = picked === drill.correct_action;

  const choose = (action: "CALL" | "FOLD") => {
    if (picked) return;
    setPicked(action);
    onScore(action === drill.correct_action);
  };

  const next = () => {
    setPicked(null);
    setCursor((c) => c + 1);
  };

  return (
    <div className="pod-drill">
      <div className="trainer-session-bar">
        <div className="trainer-session-meta">
          <strong>Ауты и шансы банка</strong>
          <span>
            Задача {(cursor % order.length) + 1} из {order.length}
          </span>
        </div>
        <div className="trainer-session-actions">
          <button type="button" className="trainer-ghost" onClick={onExit}>
            Настройки
          </button>
          {revealed ? (
            <button type="button" className="trainer-next" onClick={next}>
              Следующая
            </button>
          ) : null}
        </div>
      </div>

      <div className="trainer-stage">
        <div className="trainer-meta-bar">
          <span className="trainer-hand-code">
            {splitCards(drill.hero_hand).join("").toUpperCase()}
          </span>
          <strong>
            {drill.hero_position} vs {drill.villain_position}
          </strong>
          <em>
            Флоп · банк {drill.pot_size} · bet {drill.opponent_bet}
          </em>
        </div>

        <div className="trainer-table-wrap">
          <PokerTable
            hand={replay.hand}
            actionIndex={replay.pauseAt}
            amountUnit="bb"
            maxStackBb={100}
          />
        </div>

        <div className="trainer-controls">
          {!revealed ? (
            <>
              <p className="trainer-prompt">
                Villain ставит <strong>{drill.opponent_bet}</strong> в банк{" "}
                <strong>{drill.pot_size}</strong>. Call или Fold?
              </p>
              <div className="trainer-actions is-duo">
                <button type="button" className="act-btn fold" onClick={() => choose("FOLD")}>
                  Fold
                </button>
                <button type="button" className="act-btn call" onClick={() => choose("CALL")}>
                  Call {drill.opponent_bet}
                </button>
              </div>
            </>
          ) : (
            <div className={`trainer-feedback${correct ? " ok" : " bad"}`}>
              <div className="trainer-verdict">
                <VerdictMark ok={correct} />
                <div>
                  <strong>
                    {correct ? "Верно" : "Ошибка"} · тут {drill.correct_action}
                  </strong>
                  <p>{drill.explanation}</p>
                </div>
              </div>

              <p className="pod-coach-line">
                Ауты <em>{drill.outs}</em>
                {" → "}
                эквити <em>{drill.equity_percentage}%</em> (×2)
                {" · "}
                pot odds <em>{drill.pot_odds_percentage}%</em>
                {" = "}
                {drill.opponent_bet}/({drill.pot_size}+2×{drill.opponent_bet})
                {" → "}
                {drill.correct_action}
              </p>

              <p className="muted">
                Счёт: {score.ok}/{score.total}
                {score.total
                  ? ` · ${Math.round((100 * score.ok) / score.total)}%`
                  : ""}
              </p>
              <button type="button" className="trainer-next" onClick={next}>
                Дальше
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
