/** Типы билдера постфлоп-правил (несколько веток). */

export type PostflopStreet = "flop" | "turn" | "river";

export type PreflopRole = "aggressor" | "caller" | "multiway";

export type BoardTexture =
  | "dry"
  | "wet"
  | "paired"
  | "monotone"
  | "a-high"
  | "k-high";

export type HandCategory =
  | "nuts_sets"
  | "top_pair"
  | "middle_pairs"
  | "strong_draws"
  | "weak_draws"
  | "air";

export type PostflopAction = "FOLD" | "CHECK" | "CALL" | "BET";

export type BetSizing = "33%" | "50%" | "75%" | "all-in";

export type HandCategoryRule = {
  handCategory: HandCategory;
  allowedActions: PostflopAction[];
  /** Есть, если среди allowedActions есть BET. */
  sizing?: BetSizing;
};

/** Один спот / ветка правил. */
export type PostflopRuleSet = {
  street: PostflopStreet;
  role: PreflopRole;
  boardTexture: BoardTexture[];
  rules: HandCategoryRule[];
};

/** Именованная ветка в дереве постфлоп-стратегии. */
export type PostflopRuleBranch = {
  id: string;
  name: string;
  ruleSet: PostflopRuleSet;
};

/** Все ветки правил стратегии. */
export type PostflopStrategyTree = {
  branches: PostflopRuleBranch[];
};

export const POSTFLOP_STREETS: { id: PostflopStreet; label: string }[] = [
  { id: "flop", label: "Флоп" },
  { id: "turn", label: "Тёрн" },
  { id: "river", label: "Ривер" },
];

export const PREFLOP_ROLES: { id: PreflopRole; label: string; tip: string }[] = [
  { id: "aggressor", label: "Агрессор", tip: "Последний префлоп-рейзер (PFR)" },
  { id: "caller", label: "Коллер", tip: "Заколлировал рейз префлоп" },
  { id: "multiway", label: "Мультивей", tip: "3+ игроков на флоп" },
];

export const BOARD_TEXTURES: { id: BoardTexture; label: string }[] = [
  { id: "dry", label: "Сухой" },
  { id: "wet", label: "Мокрый / динамичный" },
  { id: "paired", label: "Парный" },
  { id: "monotone", label: "Монотон" },
  { id: "a-high", label: "A-high" },
  { id: "k-high", label: "K-high" },
];

export const HAND_CATEGORIES: { id: HandCategory; label: string; hint: string }[] = [
  { id: "nuts_sets", label: "Натс / сеты", hint: "Сеты, две пары+, почти натс" },
  { id: "top_pair", label: "Топ-пары", hint: "Топ-пара + варианты кикера" },
  { id: "middle_pairs", label: "Средние / карманные", hint: "Андерперы, средняя пара" },
  { id: "strong_draws", label: "Сильные дро", hint: "Флеш-дро, OESD, комбо-дро" },
  { id: "weak_draws", label: "Слабые дро", hint: "Гатшоты, бэкдоры" },
  { id: "air", label: "Воздух / треш", hint: "Без пары и заметного эквити" },
];

export const POSTFLOP_ACTIONS: {
  id: PostflopAction;
  label: string;
  tone: "fold" | "check" | "call" | "bet";
}[] = [
  { id: "FOLD", label: "Фолд", tone: "fold" },
  { id: "CHECK", label: "Чек", tone: "check" },
  { id: "CALL", label: "Колл", tone: "call" },
  { id: "BET", label: "Бет / рейз", tone: "bet" },
];

export const BET_SIZINGS: { id: BetSizing; label: string }[] = [
  { id: "33%", label: "33% банка" },
  { id: "50%", label: "50% банка" },
  { id: "75%", label: "75% банка" },
  { id: "all-in", label: "Олл-ин" },
];

export function emptyRules(): HandCategoryRule[] {
  return HAND_CATEGORIES.map((c) => ({
    handCategory: c.id,
    allowedActions: [],
  }));
}

export function emptyPostflopRuleSet(): PostflopRuleSet {
  return {
    street: "flop",
    role: "aggressor",
    boardTexture: [],
    rules: emptyRules(),
  };
}

export function defaultPostflopRuleSet(): PostflopRuleSet {
  return {
    street: "flop",
    role: "aggressor",
    boardTexture: ["dry", "a-high"],
    rules: [
      { handCategory: "nuts_sets", allowedActions: ["BET"], sizing: "50%" },
      { handCategory: "top_pair", allowedActions: ["BET"], sizing: "33%" },
      { handCategory: "middle_pairs", allowedActions: ["CHECK"] },
      { handCategory: "strong_draws", allowedActions: ["BET"], sizing: "33%" },
      { handCategory: "weak_draws", allowedActions: ["CHECK"] },
      { handCategory: "air", allowedActions: ["CHECK", "FOLD"] },
    ],
  };
}

export function newBranchId() {
  return `branch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function cloneRuleSet(ruleSet: PostflopRuleSet): PostflopRuleSet {
  return {
    street: ruleSet.street,
    role: ruleSet.role,
    boardTexture: [...ruleSet.boardTexture],
    rules: ruleSet.rules.map((r) => ({
      handCategory: r.handCategory,
      allowedActions: [...r.allowedActions],
      ...(r.sizing ? { sizing: r.sizing } : {}),
    })),
  };
}

export function defaultPostflopTree(): PostflopStrategyTree {
  return {
    branches: [
      {
        id: newBranchId(),
        name: "Флоп · C-bet dry A-high",
        ruleSet: defaultPostflopRuleSet(),
      },
      {
        id: newBranchId(),
        name: "Флоп · vs bet (caller)",
        ruleSet: {
          street: "flop",
          role: "caller",
          boardTexture: ["dry", "a-high"],
          rules: [
            { handCategory: "nuts_sets", allowedActions: ["CALL", "BET"], sizing: "75%" },
            { handCategory: "top_pair", allowedActions: ["CALL"] },
            { handCategory: "middle_pairs", allowedActions: ["CALL", "FOLD"] },
            { handCategory: "strong_draws", allowedActions: ["CALL", "BET"], sizing: "75%" },
            { handCategory: "weak_draws", allowedActions: ["FOLD", "CALL"] },
            { handCategory: "air", allowedActions: ["FOLD"] },
          ],
        },
      },
    ],
  };
}

export function branchSummaryLabel(ruleSet: PostflopRuleSet): string {
  const street = POSTFLOP_STREETS.find((s) => s.id === ruleSet.street)?.label ?? ruleSet.street;
  const role = PREFLOP_ROLES.find((r) => r.id === ruleSet.role)?.label ?? ruleSet.role;
  const boards =
    ruleSet.boardTexture.length === 0
      ? "любой борд"
      : ruleSet.boardTexture
          .map((t) => BOARD_TEXTURES.find((b) => b.id === t)?.label ?? t)
          .join(", ");
  return `${street} · ${role} · ${boards}`;
}
