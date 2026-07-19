/**
 * Банкролл-менеджмент (БРМ): константы и расчёт рекомендуемого лимита.
 * Идентификаторы — на английском; комментарии и тексты для UI — на русском.
 */

/** Режим игры в разделе «Карьера». */
export type BrmGameMode = "cash" | "mtt" | "spins";

/** Идентификатор стратегии банкролл-менеджмента. */
export type BrmStrategyId = "conservative" | "standard" | "aggressive" | "shot_taking";

/** Ступенька лестницы лимитов (бай-ин = 100bb для кэша или цена турнира). */
export type StakeStep = {
  /** Короткая метка для UI, напр. NL50 или Spin $3 */
  label: string;
  /** Малый блайнд (только кэш); для MTT/Spins = 0 */
  smallBlind: number;
  /** Большой блайнд (только кэш); для MTT/Spins = 0 */
  bigBlind: number;
  /** Размер одного бай-ина в валюте банкролла */
  buyin: number;
};

/** Параметры одной стратегии БРМ. */
export type BrmStrategyConfig = {
  id: BrmStrategyId;
  /** Русское имя для переключателя */
  name: string;
  /** Краткое премиальное описание стиля */
  description: string;
  /** Подсказка к сессии / стоп-лоссу */
  sessionTip: string;
  /**
   * Сколько бай-инов держать на банкролле.
   * Кэш: 1 бай-ин = 100 бб стека; MTT/Spins: 1 бай-ин = цена регистрации.
   */
  buyins: Record<BrmGameMode, number>;
  /**
   * Для шот-менеджмента: сколько бай-инов можно проиграть, прежде чем спуститься.
   * У остальных стратегий — null.
   */
  stopLossBuyins: Record<BrmGameMode, number> | null;
};

/** Подписи режимов игры. */
export const BRM_GAME_MODE_OPTIONS: {
  id: BrmGameMode;
  title: string;
  lead: string;
}[] = [
  { id: "cash", title: "Кэш-игра", lead: "6-max NLHE · бай-ин = 100 бб" },
  { id: "mtt", title: "МТТ (Турниры)", lead: "Бай-ин = цена турнира" },
  { id: "spins", title: "Spin & Go", lead: "3-max · бай-ин = цена спина" },
];

/**
 * 4 стратегии БРМ: коэффициенты бай-инов по режимам.
 * Математика: рекомендуемый_байин = банкролл / buyins[режим].
 */
export const BRM_STRATEGIES: Record<BrmStrategyId, BrmStrategyConfig> = {
  conservative: {
    id: "conservative",
    name: "Консервативная",
    description:
      "Минимизирует риск разорения, подходит для стабильного заработка на дистанции.",
    sessionTip: "Держитесь основного или мягкого лимита. Выше — только при устойчивом плюсе.",
    // Кэш 100 BI = 10 000 бб; МТТ 200; Спины 150
    buyins: { cash: 100, mtt: 200, spins: 150 },
    stopLossBuyins: null,
  },
  standard: {
    id: "standard",
    name: "Стандартная",
    description:
      "Сбалансированный подход: рост по лимитам без лишнего стресса от дисперсии.",
    sessionTip: "Играйте основной лимит. Мягкий — при плохой форме или жёстком поле.",
    // Кэш 50 BI = 5 000 бб; МТТ/Спины по 100
    buyins: { cash: 50, mtt: 100, spins: 100 },
    stopLossBuyins: null,
  },
  aggressive: {
    id: "aggressive",
    name: "Агрессивная",
    description: "Быстрый рост капитала с повышенным риском даунсвинга.",
    sessionTip: "Основной лимит по расчёту. Выше — только после серии плюсовых сессий.",
    // Кэш 30 BI = 3 000 бб; МТТ 50; Спины 60
    buyins: { cash: 30, mtt: 50, spins: 60 },
    stopLossBuyins: null,
  },
  shot_taking: {
    id: "shot_taking",
    name: "Шот-менеджмент",
    description:
      "Экстремальный БРМ для перехода на лимит выше с чётким стоп-лоссом.",
    sessionTip:
      "Шот короткий: при достижении стоп-лосса сразу спускайтесь — без отыгрыша.",
    // Кэш 15 BI; МТТ 20; Спины 25
    buyins: { cash: 15, mtt: 20, spins: 25 },
    // Спуск: кэш −3 BI, МТТ/Спины −5 BI
    stopLossBuyins: { cash: 3, mtt: 5, spins: 5 },
  },
};

/** Порядок отображения карточек БРМ. */
export const BRM_STRATEGY_ORDER: BrmStrategyId[] = [
  "conservative",
  "standard",
  "aggressive",
  "shot_taking",
];

/** Лестница кэш-лимитов: бай-ин = 100 × ББ. Блайнды — стандарт румов (не всегда SB = BB/2). */
/** Лестница кэш-лимитов PokerOK / GG. NL40 = $0.50/$1 (дефолт-бай-ин рума $40). */
export const CASH_STAKE_LADDER: StakeStep[] = [
  { label: "NL2", smallBlind: 0.01, bigBlind: 0.02, buyin: 2 },
  { label: "NL5", smallBlind: 0.02, bigBlind: 0.05, buyin: 5 },
  { label: "NL10", smallBlind: 0.05, bigBlind: 0.1, buyin: 10 },
  { label: "NL25", smallBlind: 0.1, bigBlind: 0.25, buyin: 25 },
  { label: "NL50", smallBlind: 0.25, bigBlind: 0.5, buyin: 50 },
  { label: "NL40", smallBlind: 0.5, bigBlind: 1, buyin: 40 },
  { label: "NL200", smallBlind: 1, bigBlind: 2, buyin: 200 },
  { label: "NL400", smallBlind: 2, bigBlind: 4, buyin: 400 },
  { label: "NL1K", smallBlind: 5, bigBlind: 10, buyin: 1000 },
];

/** Типичные бай-ины МТТ (регистрация = 1 бай-ин). */
export const MTT_STAKE_LADDER: StakeStep[] = [
  { label: "MTT $1", smallBlind: 0, bigBlind: 0, buyin: 1 },
  { label: "MTT $3.30", smallBlind: 0, bigBlind: 0, buyin: 3.3 },
  { label: "MTT $5.50", smallBlind: 0, bigBlind: 0, buyin: 5.5 },
  { label: "MTT $11", smallBlind: 0, bigBlind: 0, buyin: 11 },
  { label: "MTT $22", smallBlind: 0, bigBlind: 0, buyin: 22 },
  { label: "MTT $55", smallBlind: 0, bigBlind: 0, buyin: 55 },
  { label: "MTT $109", smallBlind: 0, bigBlind: 0, buyin: 109 },
  { label: "MTT $215", smallBlind: 0, bigBlind: 0, buyin: 215 },
  { label: "MTT $530", smallBlind: 0, bigBlind: 0, buyin: 530 },
];

/** Типичные цены Spin & Go. */
export const SPINS_STAKE_LADDER: StakeStep[] = [
  { label: "Spin $0.25", smallBlind: 0, bigBlind: 0, buyin: 0.25 },
  { label: "Spin $1", smallBlind: 0, bigBlind: 0, buyin: 1 },
  { label: "Spin $3", smallBlind: 0, bigBlind: 0, buyin: 3 },
  { label: "Spin $7", smallBlind: 0, bigBlind: 0, buyin: 7 },
  { label: "Spin $15", smallBlind: 0, bigBlind: 0, buyin: 15 },
  { label: "Spin $30", smallBlind: 0, bigBlind: 0, buyin: 30 },
  { label: "Spin $60", smallBlind: 0, bigBlind: 0, buyin: 60 },
  { label: "Spin $100", smallBlind: 0, bigBlind: 0, buyin: 100 },
];

/** Выбрать лестницу лимитов по режиму. */
export function stakeLadderFor(mode: BrmGameMode): StakeStep[] {
  if (mode === "mtt") return MTT_STAKE_LADDER;
  if (mode === "spins") return SPINS_STAKE_LADDER;
  return CASH_STAKE_LADDER;
}

/** Текст блайндов для кэша, иначе пустая строка. */
export function blindsCaption(step: StakeStep, mode: BrmGameMode): string {
  if (mode !== "cash" || step.bigBlind <= 0) return "";
  const sb = step.smallBlind > 0 ? step.smallBlind : step.bigBlind / 2;
  return `($${sb.toFixed(2)} / $${step.bigBlind.toFixed(2)})`;
}

/** Строка запаса бай-инов для карточки. */
export function buyinsRangeLabel(strategy: BrmStrategyConfig, mode: BrmGameMode): string {
  const n = strategy.buyins[mode];
  if (mode === "cash") {
    // 1 бай-ин кэша = 100 бб → показываем и BI, и бб
    return `${n} бай-инов (${n * 100} бб)`;
  }
  return `${n} бай-инов`;
}

/** Статус вердикта по дисциплине. */
export type LimitVerdictStatus = "ok" | "shot" | "drop" | "shortfall" | "empty";

/** Прогресс до лимита (нужная сумма по БРМ vs текущий банкролл). */
export type LimitProgress = {
  label: string;
  blinds: string;
  needTotal: number;
  have: number;
  remaining: number;
  pct: number;
  reached: boolean;
};

/** Результат динамического расчёта лимита. */
export type LimitVerdict = {
  status: LimitVerdictStatus;
  /** Крупный заголовок плашки */
  headline: string;
  /** Пояснение под заголовком */
  detail: string;
  /** Сколько бай-инов требует выбранный БРМ */
  requiredBuyins: number;
  /** Максимальный бай-ин, который «тянет» банкролл: balance / requiredBuyins */
  affordableBuyin: number;
  recommended: StakeStep | null;
  previous: StakeStep | null;
  next: StakeStep | null;
  stopLossBuyins: number | null;
  /** До следующей ступени лестницы */
  nextProgress: LimitProgress | null;
  /** До выбранной цели (если задана) */
  goalProgress: LimitProgress | null;
};

export function progressToStake(
  bankroll: number,
  stake: StakeStep,
  requiredBuyins: number,
  mode: BrmGameMode,
): LimitProgress {
  const needTotal = stake.buyin * requiredBuyins;
  const have = Math.max(0, bankroll);
  const remaining = Math.max(0, needTotal - have);
  const pct = needTotal > 0 ? Math.min(100, (have / needTotal) * 100) : 0;
  return {
    label: stake.label,
    blinds: blindsCaption(stake, mode),
    needTotal,
    have,
    remaining,
    pct,
    reached: have + 1e-9 >= needTotal,
  };
}

function findStakeByLabel(mode: BrmGameMode, label: string | null | undefined): StakeStep | null {
  if (!label) return null;
  return stakeLadderFor(mode).find((s) => s.label === label) ?? null;
}

/**
 * Главная формула БРМ:
 * 1) affordableBuyin = bankroll / requiredBuyins
 * 2) primary = максимальный лимит лестницы с buyin ≤ affordableBuyin
 * 3) next / previous — соседние ступени
 * 4) вердикт: ok | shot (есть запас на шот) | drop (ниже цели) | shortfall
 */
export function calculateLimitVerdict(
  bankroll: number,
  mode: BrmGameMode,
  strategyId: BrmStrategyId,
  goalStakeLabel?: string | null,
): LimitVerdict {
  // Берём конфиг стратегии (fallback — стандарт)
  const strategy = BRM_STRATEGIES[strategyId] ?? BRM_STRATEGIES.standard;
  // Коэффициент бай-инов для выбранного режима
  const requiredBuyins = strategy.buyins[mode];
  // Стоп-лосс только у шот-менеджмента
  const stopLossBuyins = strategy.stopLossBuyins?.[mode] ?? null;
  // Лестница лимитов режима
  const ladder = stakeLadderFor(mode);
  const goalStake = findStakeByLabel(mode, goalStakeLabel);

  const emptyProgress = (stake: StakeStep | null): LimitProgress | null =>
    stake ? progressToStake(0, stake, requiredBuyins, mode) : null;

  // Пустой банкролл — нет рекомендации
  if (!Number.isFinite(bankroll) || bankroll <= 0 || requiredBuyins <= 0) {
    const lowest = ladder[0] ?? null;
    return {
      status: "empty",
      headline: "Задайте банкролл",
      detail: "Укажите текущую сумму — система рассчитает лимит по выбранному БРМ.",
      requiredBuyins,
      affordableBuyin: 0,
      recommended: null,
      previous: null,
      next: lowest,
      stopLossBuyins,
      nextProgress: emptyProgress(lowest),
      goalProgress: goalStake ? progressToStake(0, goalStake, requiredBuyins, mode) : null,
    };
  }

  // Шаг 1: сколько стоит один «разрешённый» бай-ин
  const affordableBuyin = bankroll / requiredBuyins;

  // Шаг 2: все лимиты, которые полностью закрыты запасом бай-инов
  const affordable = ladder.filter((s) => s.buyin <= affordableBuyin + 1e-9);

  // Ниже даже самого дешёвого лимита
  if (affordable.length === 0) {
    const lowest = ladder[0];
    const need = lowest.buyin * requiredBuyins;
    const nextProgress = progressToStake(bankroll, lowest, requiredBuyins, mode);
    return {
      status: "shortfall",
      headline: `Цель: ${lowest.label}${blindsCaption(lowest, mode) ? ` ${blindsCaption(lowest, mode)}` : ""}`,
      detail: `Для ${lowest.label} нужно $${need.toFixed(2)}. Есть $${bankroll.toFixed(2)}.`,
      requiredBuyins,
      affordableBuyin,
      recommended: lowest,
      previous: null,
      next: ladder[1] ?? null,
      stopLossBuyins,
      nextProgress,
      goalProgress: goalStake
        ? progressToStake(bankroll, goalStake, requiredBuyins, mode)
        : nextProgress,
    };
  }

  // Основной (максимальный доступный) лимит
  const primaryIdx = ladder.findIndex((s) => s.label === affordable[affordable.length - 1].label);
  const recommended = ladder[primaryIdx];
  const previous = primaryIdx > 0 ? ladder[primaryIdx - 1] : null;
  const next = primaryIdx + 1 < ladder.length ? ladder[primaryIdx + 1] : null;
  const nextProgress = next ? progressToStake(bankroll, next, requiredBuyins, mode) : null;
  const goalProgress = goalStake
    ? progressToStake(bankroll, goalStake, requiredBuyins, mode)
    : null;

  // Шаг 3: хватает ли на шот следующего лимита по правилу shot_taking (или stretch)
  // Для шот-стиля: шот доступен, если BR ≥ next.buyin * shotBuyins
  // Для остальных: мягкий сигнал, если BR ≥ next.buyin * requiredBuyins * 0.85 (почти дотянули)
  let status: LimitVerdictStatus = "ok";
  let headline = "";
  let detail = "";

  const blinds = blindsCaption(recommended, mode);
  const blindsPart = blinds ? ` ${blinds}` : "";

  if (next) {
    const shotBuyins = strategy.id === "shot_taking" ? requiredBuyins : requiredBuyins;
    // Сколько нужно для полноценного следующего лимита по текущему БРМ
    const needForNext = next.buyin * shotBuyins;
    // Запас относительно текущего основного лимита
    const haveOnPrimary = bankroll / recommended.buyin;

    if (bankroll >= needForNext) {
      // Банкролл вырос: можно пробовать шот / переход
      status = "shot";
      headline = `Доступен переход! Шот на ${next.label}${blindsCaption(next, mode) ? ` ${blindsCaption(next, mode)}` : ""}`;
      detail = `Основной лимит по дисциплине — ${recommended.label}${blindsPart}. Банкролл уже тянет следующий уровень.`;
    } else if (haveOnPrimary < requiredBuyins * 0.85 && previous) {
      // Запас бай-инов на текущем лимите просел — защита капитала
      status = "drop";
      headline = `Внимание: спуститесь на ${previous.label}${blindsCaption(previous, mode) ? ` ${blindsCaption(previous, mode)}` : ""}`;
      detail = `Запас ниже комфортного (${haveOnPrimary.toFixed(0)} из ${requiredBuyins} бай-инов на ${recommended.label}).`;
    } else {
      status = "ok";
      headline = `Ваш рекомендуемый лимит: ${recommended.label}${blindsPart}`;
      detail = "Ваш банкролл полностью соответствует правилам дисциплины.";
    }
  } else {
    status = "ok";
    headline = `Ваш рекомендуемый лимит: ${recommended.label}${blindsPart}`;
    detail = "Верхняя ступень лестницы. Банкролл соответствует выбранному БРМ.";
  }

  // Для shot_taking всегда напоминаем стоп-лосс в detail
  if (stopLossBuyins != null) {
    detail += ` Стоп-лосс шота: −${stopLossBuyins} бай-ина — затем обязательный спуск.`;
  }

  return {
    status,
    headline,
    detail,
    requiredBuyins,
    affordableBuyin,
    recommended,
    previous,
    next,
    stopLossBuyins,
    nextProgress,
    goalProgress,
  };
}

/** Нормализация id профиля из API / старых алиасов. */
export function resolveBrmStrategyId(raw: string): BrmStrategyId {
  if (raw in BRM_STRATEGIES) return raw as BrmStrategyId;
  const aliases: Record<string, BrmStrategyId> = {
    professional: "conservative",
    nit: "conservative",
    balanced: "standard",
    degen: "shot_taking",
  };
  return aliases[raw] ?? "standard";
}

/** Нормализация режима из API. */
export function resolveBrmGameMode(raw: string | null | undefined): BrmGameMode {
  if (raw === "mtt" || raw === "spins" || raw === "cash") return raw;
  return "cash";
}
