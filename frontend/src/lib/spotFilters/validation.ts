import { actsBefore, positionIndex, positionsForModule } from "./positions";
import {
  availableHeroPositions,
  isHeroPositionAllowed,
  isRaiserAllowed,
  matrixActionsForSituation,
} from "./situations";
import type {
  ActionBeforeKind,
  MatrixActionLabel,
  SpotFilterState,
  StrategyModule,
  TablePosition,
} from "./types";

/** Результат проверки одной кнопки / комбинации. */
export type ValidationIssue = {
  code: string;
  message: string;
};

/**
 * Почему кнопка рейзера заблокирована (или null, если можно жать).
 */
export function raiserDisabledReason(
  module: StrategyModule,
  raiser: TablePosition,
  hero: TablePosition | null,
): ValidationIssue | null {
  if (raiser === "BB") {
    return {
      code: "raiser_bb",
      message: "BB не может сделать open-raise первым — банк уже открыт блайндами",
    };
  }
  if (hero && !actsBefore(module, raiser, hero)) {
    return {
      code: "raiser_after_hero",
      message: `Нельзя: рейз от ${raiser} при герое ${hero} — ${raiser} ходит не раньше героя`,
    };
  }
  if (positionIndex(module, raiser) < 0) {
    return {
      code: "raiser_unknown",
      message: `Позиция ${raiser} недоступна на этом столе`,
    };
  }
  return null;
}

/**
 * Почему кнопка героя заблокирована (или null).
 */
export function heroDisabledReason(
  module: StrategyModule,
  state: SpotFilterState,
  hero: TablePosition,
): ValidationIssue | null {
  if (!state.situationKind) {
    return {
      code: "need_situation",
      message: "Сначала выбери ситуацию в блоке «Действие до нас»",
    };
  }

  if (state.situationKind === "RFI" && hero === "BB") {
    return {
      code: "rfi_bb",
      message: "На BB нельзя сделать RFI (First In)",
    };
  }

  if (state.situationKind === "IP_OOP_DEFENSE") {
    if (!state.raiserPosition) {
      return {
        code: "need_raiser",
        message: "Укажи, кто сделал open-raise",
      };
    }
    if (!actsBefore(module, state.raiserPosition, hero)) {
      return {
        code: "hero_before_raiser",
        message: `Нельзя защищаться на ${hero} против рейза с ${state.raiserPosition} — герой ходит не позже рейзера`,
      };
    }
  }

  if (!isHeroPositionAllowed(module, state, hero)) {
    return {
      code: "hero_not_in_list",
      message: `Позиция ${hero} недоступна для текущей ситуации`,
    };
  }

  return null;
}

/**
 * Сводка disabled-флагов для UI кнопок.
 */
export function buildDisabledMaps(
  module: StrategyModule,
  state: SpotFilterState,
): {
  raisers: Record<string, boolean>;
  heroes: Record<string, boolean>;
  raiserReasons: Record<string, string>;
  heroReasons: Record<string, string>;
} {
  const raisers: Record<string, boolean> = {};
  const heroes: Record<string, boolean> = {};
  const raiserReasons: Record<string, string> = {};
  const heroReasons: Record<string, string> = {};

  for (const p of positionsForModule(module)) {
    const rr = raiserDisabledReason(module, p, state.heroPosition);
    raisers[p] = Boolean(rr);
    if (rr) raiserReasons[p] = rr.message;

    const hr = heroDisabledReason(module, state, p);
    heroes[p] = Boolean(hr);
    if (hr) heroReasons[p] = hr.message;
  }

  return { raisers, heroes, raiserReasons, heroReasons };
}

/**
 * Проверяет, допустимо ли действие кисти в текущей ситуации.
 * RFI: только raise/fold; vs open: 3bet/call/fold.
 */
export function isMatrixActionAllowed(
  kind: ActionBeforeKind | null,
  action: MatrixActionLabel,
): boolean {
  return matrixActionsForSituation(kind).includes(action);
}

/**
 * Валидирует произвольную пару (рейзер, герой) как «рейз от X, герой Y».
 * Используется при импорте / сохранении дерева.
 */
export function validateRaiseDefensePair(
  module: StrategyModule,
  raiser: TablePosition,
  hero: TablePosition,
): ValidationIssue | null {
  if (!isRaiserAllowed(module, raiser, hero)) {
    return raiserDisabledReason(module, raiser, hero);
  }
  const state: SpotFilterState = {
    situationKind: "IP_OOP_DEFENSE",
    raiserPosition: raiser,
    heroPosition: hero,
  };
  return heroDisabledReason(module, state, hero);
}

/**
 * Список героев, доступных прямо сейчас (для подсказок UI).
 */
export function listEnabledHeroes(
  module: StrategyModule,
  state: SpotFilterState,
): TablePosition[] {
  return availableHeroPositions(module, state);
}
