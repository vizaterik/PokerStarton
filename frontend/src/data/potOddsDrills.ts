/** Тренажёр: ауты и шансы банка (правило ×2 к следующей улице). */

export type PotOddsDrill = {
  id: number;
  hero_hand: string;
  board: string;
  pot_size: number;
  opponent_bet: number;
  outs: number;
  pot_odds_percentage: number;
  equity_percentage: number;
  correct_action: "CALL" | "FOLD";
  explanation: string;
  /** 6-max seats — same table layout as chart trainer. */
  hero_position: string;
  villain_position: string;
};

type DrillSeed = {
  hero_hand: string;
  board: string;
  pot_size: number;
  opponent_bet: number;
  outs: number;
  explanation: string;
};

/** Villain opens, hero calls later in the preflop order (6-max). */
const MATCHUPS: ReadonlyArray<{ hero: string; villain: string }> = [
  { hero: "BB", villain: "BTN" },
  { hero: "BB", villain: "CO" },
  { hero: "BB", villain: "HJ" },
  { hero: "BB", villain: "UTG" },
  { hero: "SB", villain: "BTN" },
  { hero: "SB", villain: "CO" },
  { hero: "SB", villain: "HJ" },
  { hero: "BTN", villain: "CO" },
  { hero: "BTN", villain: "HJ" },
  { hero: "BTN", villain: "UTG" },
  { hero: "CO", villain: "HJ" },
  { hero: "CO", villain: "UTG" },
  { hero: "HJ", villain: "UTG" },
  { hero: "BB", villain: "SB" },
];

/** pot_odds% = round(bet / (pot + 2×bet) × 100); equity% = outs × 2 */
function buildDrill(id: number, seed: DrillSeed): PotOddsDrill {
  const { pot_size, opponent_bet, outs } = seed;
  const pot_odds_percentage = Math.round(
    (opponent_bet / (pot_size + 2 * opponent_bet)) * 100,
  );
  const equity_percentage = Math.min(100, outs * 2);
  const correct_action: "CALL" | "FOLD" =
    equity_percentage >= pot_odds_percentage ? "CALL" : "FOLD";
  const matchup = MATCHUPS[(id - 1) % MATCHUPS.length]!;
  return {
    id,
    hero_hand: seed.hero_hand,
    board: seed.board,
    pot_size,
    opponent_bet,
    outs,
    pot_odds_percentage,
    equity_percentage,
    correct_action,
    explanation: seed.explanation,
    hero_position: matchup.hero,
    villain_position: matchup.villain,
  };
}

const SEEDS: DrillSeed[] = [
  // —— Флеш-дро (9) ——
  {
    hero_hand: "Ah Kh",
    board: "Qh 7h 2d",
    pot_size: 100,
    opponent_bet: 25,
    outs: 9,
    explanation:
      "Флеш-дро: 9 аутов ≈ 18%. Pot odds ~17% — Call плюсовой.",
  },
  {
    hero_hand: "Jd Td",
    board: "Ad 8d 3c",
    pot_size: 50,
    opponent_bet: 50,
    outs: 9,
    explanation:
      "Флеш-дро ≈ 18%, но ставка в банк просит ~33%. Fold — слишком дорого.",
  },
  {
    hero_hand: "9s 8s",
    board: "As 4s 2c",
    pot_size: 70,
    opponent_bet: 20,
    outs: 9,
    explanation:
      "Флеш-дро 18%, банку нужно ~22%. Немного не хватает — Fold.",
  },
  {
    hero_hand: "Kc Qc",
    board: "Tc 6c 2h",
    pot_size: 90,
    opponent_bet: 20,
    outs: 9,
    explanation:
      "Флеш-дро 18% при pot odds ~18% — Call по краю.",
  },
  {
    hero_hand: "7h 6h",
    board: "Kh 9h 3d",
    pot_size: 40,
    opponent_bet: 10,
    outs: 9,
    explanation:
      "Дешёвая ставка: нужно ~17%, у флеш-дро 18% — Call.",
  },
  {
    hero_hand: "As 5s",
    board: "Js 8s 4d",
    pot_size: 120,
    opponent_bet: 80,
    outs: 9,
    explanation:
      "Овербет: pot odds ~29%, флеш-дро только 18% — Fold.",
  },

  // —— OESD (8) ——
  {
    hero_hand: "9c 8d",
    board: "7h 6s 2c",
    pot_size: 60,
    opponent_bet: 20,
    outs: 8,
    explanation:
      "OESD: 8 аутов ≈ 16%, pot odds 25%. Fold.",
  },
  {
    hero_hand: "Jh Th",
    board: "9d 8c 2s",
    pot_size: 80,
    opponent_bet: 15,
    outs: 8,
    explanation:
      "OESD 16% при pot odds ~16% — Call.",
  },
  {
    hero_hand: "7s 6c",
    board: "9h 8d 3c",
    pot_size: 45,
    opponent_bet: 30,
    outs: 8,
    explanation:
      "OESD 16%, нужно ~29%. Fold.",
  },
  {
    hero_hand: "Qd Jd",
    board: "Tc 9h 2s",
    pot_size: 100,
    opponent_bet: 30,
    outs: 8,
    explanation:
      "OESD ≈ 16%, pot odds ~19%. Чуть не хватает — Fold.",
  },
  {
    hero_hand: "5h 4h",
    board: "7c 6d 2s",
    pot_size: 55,
    opponent_bet: 12,
    outs: 8,
    explanation:
      "OESD 16% vs ~15% pot odds — Call.",
  },

  // —— Гатшот (4) ——
  {
    hero_hand: "Ah Kd",
    board: "Qc 9h 4s",
    pot_size: 60,
    opponent_bet: 15,
    outs: 4,
    explanation:
      "Чистый гатшот: 4 аута ≈ 8%. Нужно ~17% — Fold.",
  },
  {
    hero_hand: "Jc 9d",
    board: "Th 7c 2s",
    pot_size: 30,
    opponent_bet: 5,
    outs: 4,
    explanation:
      "Гатшот 8% при очень дешёвой ставке (~13%). Всё равно Fold — аутов мало.",
  },
  {
    hero_hand: "8s 7c",
    board: "6d 5h Ks",
    pot_size: 40,
    opponent_bet: 8,
    outs: 4,
    explanation:
      "Гатшот ≈ 8%, pot odds ~14%. Fold.",
  },

  // —— Гатшот + оверкарты (10) ——
  {
    hero_hand: "As Kd",
    board: "Qh 9c 4d",
    pot_size: 80,
    opponent_bet: 40,
    outs: 10,
    explanation:
      "Гатшот + две оверкарты ≈ 10 аутов (20%). Нужно 25% — Fold.",
  },
  {
    hero_hand: "Ah Qd",
    board: "Jc 8s 3h",
    pot_size: 70,
    opponent_bet: 20,
    outs: 10,
    explanation:
      "Гатшот + оверкарты ≈ 20%, pot odds ~18% — Call.",
  },
  {
    hero_hand: "Kc Qs",
    board: "Jh 7d 2c",
    pot_size: 90,
    opponent_bet: 45,
    outs: 10,
    explanation:
      "10 аутов ≈ 20% против pot odds 25%. Fold.",
  },
  {
    hero_hand: "Ad Jd",
    board: "Tc 6h 2s",
    pot_size: 50,
    opponent_bet: 12,
    outs: 10,
    explanation:
      "Гатшот + оверы ≈ 20%, нужно ~16% — Call.",
  },

  // —— Две оверкарты (6) ——
  {
    hero_hand: "Ah Kd",
    board: "9c 7s 2h",
    pot_size: 60,
    opponent_bet: 15,
    outs: 6,
    explanation:
      "Только оверкарты: 6 аутов ≈ 12%. Pot odds ~17% — Fold.",
  },
  {
    hero_hand: "Ac Qs",
    board: "8h 5d 3c",
    pot_size: 40,
    opponent_bet: 8,
    outs: 6,
    explanation:
      "Оверкарты 12% vs ~14% — Fold по краю.",
  },
  {
    hero_hand: "Kh Qd",
    board: "7c 4s 2d",
    pot_size: 35,
    opponent_bet: 5,
    outs: 6,
    explanation:
      "Оверкарты ≈ 12%, pot odds ~11% — Call.",
  },

  // —— Комбо-дро флеш + OESD (15) ——
  {
    hero_hand: "Jh Th",
    board: "9h 8c 2h",
    pot_size: 40,
    opponent_bet: 20,
    outs: 15,
    explanation:
      "Комбо-дро ≈ 15 аутов → 30%. Pot odds 25% — Call.",
  },
  {
    hero_hand: "9s 8s",
    board: "7s 6d 2s",
    pot_size: 100,
    opponent_bet: 60,
    outs: 15,
    explanation:
      "Сильное комбо-дро 30% при pot odds ~27% — Call.",
  },
  {
    hero_hand: "Qd Jd",
    board: "Td 9c 3d",
    pot_size: 55,
    opponent_bet: 40,
    outs: 15,
    explanation:
      "Комбо 30% vs ~30% pot odds — Call.",
  },
  {
    hero_hand: "7c 6c",
    board: "5c 4h 2c",
    pot_size: 80,
    opponent_bet: 80,
    outs: 15,
    explanation:
      "Комбо ≈ 30%, ставка в банк просит ~33%. Fold по краю.",
  },

  // —— Флеш + гатшот (12) ——
  {
    hero_hand: "Ah Th",
    board: "Kh 7c 2h",
    pot_size: 60,
    opponent_bet: 25,
    outs: 12,
    explanation:
      "Флеш + гатшот ≈ 12 аутов → 24%. Pot odds ~23% — Call.",
  },
  {
    hero_hand: "Kc 9c",
    board: "Qc 8d 3c",
    pot_size: 70,
    opponent_bet: 40,
    outs: 12,
    explanation:
      "12 аутов ≈ 24%, нужно ~27%. Fold.",
  },
  {
    hero_hand: "Js 7s",
    board: "Ts 5h 2s",
    pot_size: 45,
    opponent_bet: 15,
    outs: 12,
    explanation:
      "Флеш + гатшот 24% при ~20% pot odds — Call.",
  },

  // —— Пара + флеш-дро (часто ~10–12; считаем 9 flush + иногда 2 pair outs; use 11) ——
  {
    hero_hand: "Ah 9h",
    board: "9c 6h 2h",
    pot_size: 50,
    opponent_bet: 20,
    outs: 11,
    explanation:
      "Топ-пара + флеш-дро ≈ 11 аутов (22%). Pot odds ~22% — Call.",
  },
  {
    hero_hand: "Kd 8d",
    board: "8s 5d 3d",
    pot_size: 90,
    opponent_bet: 50,
    outs: 11,
    explanation:
      "Пара + флеш ≈ 22%, pot odds ~26%. Fold.",
  },

  // —— Две пары / сет не дро — skip; вместо: backdoor skip ——

  // —— Разные сайзинги / споты ——
  {
    hero_hand: "Ac Jc",
    board: "9c 4c 2s",
    pot_size: 200,
    opponent_bet: 50,
    outs: 9,
    explanation:
      "Флеш-дро 18% vs pot odds ~17% — Call.",
  },
  {
    hero_hand: "Ts 9s",
    board: "8h 7d 2c",
    pot_size: 110,
    opponent_bet: 35,
    outs: 8,
    explanation:
      "OESD 16% при ~19% — Fold.",
  },
  {
    hero_hand: "5d 4d",
    board: "Ad Kd 8c",
    pot_size: 65,
    opponent_bet: 20,
    outs: 9,
    explanation:
      "Флеш-дро 18% vs ~19% — Fold по краю.",
  },
  {
    hero_hand: "Qh Jh",
    board: "Th 6c 2h",
    pot_size: 75,
    opponent_bet: 25,
    outs: 12,
    explanation:
      "Флеш + гатшот 24% при ~20% — Call.",
  },
  {
    hero_hand: "8h 7d",
    board: "6s 5c Kc",
    pot_size: 48,
    opponent_bet: 16,
    outs: 8,
    explanation:
      "OESD 16% vs ~20% — Fold.",
  },
  {
    hero_hand: "As Ts",
    board: "Qs 7s 3d",
    pot_size: 36,
    opponent_bet: 9,
    outs: 9,
    explanation:
      "Флеш-дро 18% при ~17% — Call.",
  },
  {
    hero_hand: "Kd Jd",
    board: "Tc 9h 4s",
    pot_size: 85,
    opponent_bet: 25,
    outs: 8,
    explanation:
      "OESD 16% vs ~19% — Fold.",
  },
  {
    hero_hand: "9h 8h",
    board: "7h 3c 2h",
    pot_size: 95,
    opponent_bet: 30,
    outs: 9,
    explanation:
      "Флеш-дро 18% при ~19% — Fold.",
  },
  {
    hero_hand: "6c 5c",
    board: "9c 8d 2c",
    pot_size: 42,
    opponent_bet: 14,
    outs: 12,
    explanation:
      "Флеш + гатшот 24% vs ~20% — Call.",
  },
  {
    hero_hand: "Ah 7h",
    board: "Kh 4h 9s",
    pot_size: 150,
    opponent_bet: 100,
    outs: 9,
    explanation:
      "Флеш-дро 18% против огромной ставки (~29%) — Fold.",
  },
  {
    hero_hand: "Qc Jc",
    board: "Tc 8h 2d",
    pot_size: 58,
    opponent_bet: 14,
    outs: 12,
    explanation:
      "Флеш + гатшот ≈ 24%, pot odds ~16% — Call.",
  },
  {
    hero_hand: "2s 2h",
    board: "As Kd 7c",
    pot_size: 40,
    opponent_bet: 20,
    outs: 2,
    explanation:
      "Сет-майнинг: всего 2 аута ≈ 4%. Pot odds 25% — Fold.",
  },
  {
    hero_hand: "3d 3c",
    board: "Ah Qs 8h",
    pot_size: 28,
    opponent_bet: 4,
    outs: 2,
    explanation:
      "Два аута на сет ≈ 4%, даже при дешёвой ставке (~11%) — Fold.",
  },
  {
    hero_hand: "Ts 9d",
    board: "8c 7h 2s",
    pot_size: 66,
    opponent_bet: 18,
    outs: 8,
    explanation:
      "OESD 16% vs ~18% — Fold.",
  },
  {
    hero_hand: "Ad 5d",
    board: "Kd 9d 4c",
    pot_size: 72,
    opponent_bet: 18,
    outs: 9,
    explanation:
      "Флеш-дро 18% при ~17% — Call.",
  },
  {
    hero_hand: "Kh Qh",
    board: "Jh 9c 4h",
    pot_size: 88,
    opponent_bet: 44,
    outs: 12,
    explanation:
      "Флеш + гатшот 24% vs 25% — Fold по краю.",
  },
  {
    hero_hand: "8d 7d",
    board: "6d 5s Ac",
    pot_size: 52,
    opponent_bet: 13,
    outs: 12,
    explanation:
      "Флеш + гатшот 24% при ~17% — Call.",
  },
  {
    hero_hand: "Jc Tc",
    board: "9c 8s 4c",
    pot_size: 64,
    opponent_bet: 32,
    outs: 15,
    explanation:
      "Комбо-дро ≈ 30% при pot odds 25% — Call.",
  },
  {
    hero_hand: "As Jd",
    board: "Td 7c 2h",
    pot_size: 70,
    opponent_bet: 30,
    outs: 6,
    explanation:
      "Только оверкарты ≈ 12% vs ~23% — Fold.",
  },
];

export const POT_ODDS_DRILLS: PotOddsDrill[] = SEEDS.map((seed, i) =>
  buildDrill(i + 1, seed),
);
