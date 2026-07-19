import { actsBefore, positionsAfter, positionsForModule, toDbPosition } from "./positions";
import type {
  ActionBeforeKey,
  ActionBeforeKind,
  MatrixActionLabel,
  SpotFilterState,
  StrategyModule,
  TablePosition,
} from "./types";

/**
 * Собирает ключ actionBefore для кэша чартов.
 * RFI → "RFI"; защита vs open от UTG → "RAISE_FROM_UTG".
 */
export function buildActionBeforeKey(
  kind: ActionBeforeKind,
  raiser: TablePosition | null,
): ActionBeforeKey | null {
  if (kind === "RFI") return "RFI";
  if (kind === "IP_OOP_DEFENSE" && raiser) {
    return `RAISE_FROM_${toDbPosition(raiser).replace(/\+/g, "")}` as ActionBeforeKey;
  }
  return null;
}

/**
 * Разбирает ключ actionBefore обратно в kind + raiser (для UI).
 * RAISE_FROM_UTG1 / RAISE_FROM_BTN обрабатываются через fromDb-подобные эвристики.
 */
export function parseActionBeforeKey(
  key: ActionBeforeKey,
  module: StrategyModule,
): { kind: ActionBeforeKind; raiser: TablePosition | null } {
  if (key === "RFI") return { kind: "RFI", raiser: null };
  const raw = key.replace(/^RAISE_FROM_/, "");
  // Восстанавливаем подписи: BTN→BU, UTG1→UTG+1, MP2→MP+2
  let label = raw;
  if (raw === "BTN") label = "BU";
  else if (raw === "UTG1") label = "UTG+1";
  else if (raw === "MP2") label = "MP+2";
  else if (raw === "HJ") label = "MP+2";

  const order = positionsForModule(module);
  const raiser =
    order.find((p) => p === label || toDbPosition(p).replace(/\+/g, "") === raw) ??
    null;
  return { kind: "IP_OOP_DEFENSE", raiser };
}

/**
 * Блок А — доступные ситуации «до нас».
 */
export const SITUATION_OPTIONS: {
  kind: ActionBeforeKind;
  label: string;
  hint: string;
}[] = [
  {
    kind: "RFI",
    label: "RFI",
    hint: "First In — все до нас выкинули",
  },
  {
    kind: "IP_OOP_DEFENSE",
    label: "vs Open",
    hint: "Оппонент сделал open-raise — укажи кто",
  },
];

/**
 * Позиции, с которых возможен open-raise (все кроме BB).
 * На BB нельзя открыть банк рейзом первым (уже закрывает действие).
 */
export function possibleRaiserPositions(module: StrategyModule): TablePosition[] {
  return positionsForModule(module).filter((p) => p !== "BB");
}

/**
 * Блок Б: какие позиции героя можно выбрать при текущем Блоке А.
 *
 * Правила:
 * - RFI → все позиции кроме BB (на BB нет RFI).
 * - vs Open от raiser → только позиции СТРОГО после рейзера.
 * - Ситуация не выбрана → список пуст (матрицу ещё нельзя настраивать).
 */
export function availableHeroPositions(
  module: StrategyModule,
  state: Pick<SpotFilterState, "situationKind" | "raiserPosition">,
): TablePosition[] {
  const { situationKind, raiserPosition } = state;

  // Пока ситуация не выбрана — герой недоступен
  if (!situationKind) return [];

  if (situationKind === "RFI") {
    // RFI запрещён на BB: банк уже «открыт» блайндами, это не first-in open
    return positionsForModule(module).filter((p) => p !== "BB");
  }

  // Защита: сначала обязан быть выбран рейзер
  if (!raiserPosition) return [];

  // Герой только после рейзера (MP не может защищаться vs BU — BU ходит позже)
  return positionsAfter(module, raiserPosition);
}

/**
 * Можно ли выбрать данного рейзера при уже выбранном герое.
 * Если герой ещё не выбран — любой open-рейзер (не BB) допустим.
 */
export function isRaiserAllowed(
  module: StrategyModule,
  raiser: TablePosition,
  hero: TablePosition | null,
): boolean {
  if (raiser === "BB") return false;
  if (!hero) return true;
  // Рейзер обязан ходить раньше героя
  return actsBefore(module, raiser, hero);
}

/**
 * Можно ли выбрать позицию героя при текущей ситуации.
 */
export function isHeroPositionAllowed(
  module: StrategyModule,
  state: SpotFilterState,
  hero: TablePosition,
): boolean {
  return availableHeroPositions(module, state).includes(hero);
}

/**
 * Действия кисти на матрице для спота.
 * RFI → Raise / Fold; vs Open → 3-Bet / Call / Fold.
 */
export function matrixActionsForSituation(
  kind: ActionBeforeKind | null,
): MatrixActionLabel[] {
  if (kind === "RFI") return ["raise", "fold"];
  if (kind === "IP_OOP_DEFENSE") return ["3bet", "call", "fold"];
  return [];
}

/**
 * Полная валидация фильтра: готов ли спот к редактированию матрицы.
 */
export function isFilterReady(
  module: StrategyModule,
  state: SpotFilterState,
): boolean {
  if (!state.situationKind || !state.heroPosition) return false;
  if (state.situationKind === "IP_OOP_DEFENSE") {
    if (!state.raiserPosition) return false;
    if (!isRaiserAllowed(module, state.raiserPosition, state.heroPosition)) {
      return false;
    }
  }
  return isHeroPositionAllowed(module, state, state.heroPosition);
}

/**
 * Нормализует состояние после смены Блока А / рейзера:
 * сбрасывает героя, если он стал недопустимым.
 */
export function sanitizeFilterState(
  module: StrategyModule,
  state: SpotFilterState,
): SpotFilterState {
  const next = { ...state };

  if (next.situationKind === "RFI") {
    next.raiserPosition = null;
  }

  if (
    next.raiserPosition &&
    !possibleRaiserPositions(module).includes(next.raiserPosition)
  ) {
    next.raiserPosition = null;
  }

  if (next.heroPosition && !isHeroPositionAllowed(module, next, next.heroPosition)) {
    next.heroPosition = null;
  }

  return next;
}
