import type { StrategyFormat, TableSizeLabel } from "../strategyModules";
import type { StrategyModule, TablePosition } from "./types";

/**
 * Позиции по модулю стола (порядок хода префлоп).
 * Cash 6-max / Spins 3-max / MTT 9-max — как в ТЗ редактора PokerStraton.
 */
export const POSITIONS_BY_MODULE: Record<StrategyModule, TablePosition[]> = {
  /** Кэш 6-макс: UTG → MP → CO → BU → SB → BB */
  cash_6max: ["UTG", "MP", "CO", "BU", "SB", "BB"],
  /** Спины 3-макс: BU → SB → BB */
  spins_3max: ["BU", "SB", "BB"],
  /**
   * MTT 9-макс (сокращённый набор для чартов):
   * UTG, UTG+1, MP, MP+2, CO, BU, SB, BB
   */
  mtt_9max: ["UTG", "UTG+1", "MP", "MP+2", "CO", "BU", "SB", "BB"],
};

/**
 * Определяет модуль позиций по формату и размеру стола стратегии.
 */
export function resolveStrategyModule(
  format: StrategyFormat | string,
  tableSize: TableSizeLabel | string,
): StrategyModule {
  if (format === "spins" || tableSize === "3-max") return "spins_3max";
  if (format === "mtt" && (tableSize === "9-max" || tableSize === "8-max")) {
    return "mtt_9max";
  }
  // MTT 6-max и cash используют 6-максный порядок с MP
  if (format === "mtt") return "cash_6max";
  return "cash_6max";
}

/**
 * Возвращает упорядоченный список позиций для модуля.
 */
export function positionsForModule(module: StrategyModule): TablePosition[] {
  return [...POSITIONS_BY_MODULE[module]];
}

/**
 * Индекс позиции в порядке хода (меньше = раньше действует).
 * Неизвестная позиция → -1.
 */
export function positionIndex(
  module: StrategyModule,
  position: TablePosition,
): number {
  return POSITIONS_BY_MODULE[module].indexOf(position);
}

/**
 * True, если `earlier` ходит строго раньше `later` на этом столе.
 */
export function actsBefore(
  module: StrategyModule,
  earlier: TablePosition,
  later: TablePosition,
): boolean {
  const a = positionIndex(module, earlier);
  const b = positionIndex(module, later);
  if (a < 0 || b < 0) return false;
  return a < b;
}

/**
 * Позиции, сидящие СТРОГО после `from` (ход ещё не дошёл / позже в очереди).
 * Пример: рейз от UTG → MP, CO, BU, SB, BB.
 */
export function positionsAfter(
  module: StrategyModule,
  from: TablePosition,
): TablePosition[] {
  const order = POSITIONS_BY_MODULE[module];
  const idx = order.indexOf(from);
  if (idx < 0) return [];
  return order.slice(idx + 1);
}

/**
 * Человекочитаемая подпись позиции (BU остаётся BU в UI).
 */
export function positionLabel(position: TablePosition): string {
  return position;
}

/**
 * Маппинг UI-позиции (BU) → ключ в БД спотов (BTN).
 * Остальные позиции совпадают 1:1, кроме MP+2 → HJ для совместимости с API.
 */
export function toDbPosition(position: TablePosition): string {
  if (position === "BU") return "BTN";
  if (position === "MP+2") return "HJ";
  return position;
}

/**
 * Обратный маппинг: ключ БД → UI-позиция модуля.
 */
export function fromDbPosition(
  dbPos: string,
  module: StrategyModule,
): TablePosition | null {
  let normalized: string = dbPos;
  if (dbPos === "BTN") normalized = "BU";
  else if (dbPos === "HJ") normalized = "MP+2";

  const order = POSITIONS_BY_MODULE[module];
  return order.find((p) => p === normalized || p === dbPos) ?? null;
}
