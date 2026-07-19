/**
 * Фильтры спотов редактора стратегии (позиции / ситуации до героя).
 * Логика в стиле GTOBase: очередь позиций + валидация невозможных линий.
 */

/** Позиции стола в порядке хода (префлоп, слева направо). */
export type TablePosition =
  | "UTG"
  | "UTG+1"
  | "MP"
  | "MP+2"
  | "CO"
  | "BU"
  | "SB"
  | "BB";

/** Модуль формата стратегии — определяет размер стола и набор позиций. */
export type StrategyModule = "cash_6max" | "spins_3max" | "mtt_9max";

/** Ситуация «до нас» (Блок А). */
export type ActionBeforeKind = "RFI" | "IP_OOP_DEFENSE";

/**
 * Ключ ситуации в кэше чартов.
 * RFI — все до нас сфолдили.
 * RAISE_FROM_<POS> — оппонент открыл рейзом с указанной позиции.
 */
export type ActionBeforeKey = "RFI" | `RAISE_FROM_${string}`;

/** Допустимые действия кисти на матрице для данного спота. */
export type MatrixActionLabel = "raise" | "fold" | "call" | "3bet";

/** Одна ячейка чарта: рука → действие (дискретная метка для кэша). */
export type ChartMatrixData = Record<string, MatrixActionLabel>;

/** Запись чарта в JSON-кэше ситуаций. */
export type SpotChartEntry = {
  actionBefore: ActionBeforeKey;
  heroPosition: TablePosition;
  matrixData: ChartMatrixData;
};

/** Полное дерево / кэш чартов стратегии. */
export type SpotChartsCache = {
  charts: SpotChartEntry[];
};

/** Состояние двухступенчатого фильтра. */
export type SpotFilterState = {
  /** Блок А: тип ситуации (RFI или защита vs open). */
  situationKind: ActionBeforeKind | null;
  /** Под-выбор для защиты: кто сделал open-raise. */
  raiserPosition: TablePosition | null;
  /** Блок Б: активная позиция героя. */
  heroPosition: TablePosition | null;
};
