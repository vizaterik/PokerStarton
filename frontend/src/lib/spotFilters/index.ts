/**
 * Модуль фильтров спотов редактора стратегии (PokerStraton).
 *
 * Двухступенчатая модель:
 *   Блок А — ситуация до героя (RFI / vs Open + кто рейзил)
 *   Блок Б — позиция героя (только валидные по очереди хода)
 *
 * Кэш чартов: charts[{ actionBefore, heroPosition, matrixData }]
 */

export type {
  ActionBeforeKey,
  ActionBeforeKind,
  ChartMatrixData,
  MatrixActionLabel,
  SpotChartEntry,
  SpotChartsCache,
  SpotFilterState,
  StrategyModule,
  TablePosition,
} from "./types";

export {
  POSITIONS_BY_MODULE,
  actsBefore,
  fromDbPosition,
  positionIndex,
  positionLabel,
  positionsAfter,
  positionsForModule,
  resolveStrategyModule,
  toDbPosition,
} from "./positions";

export {
  SITUATION_OPTIONS,
  availableHeroPositions,
  buildActionBeforeKey,
  isFilterReady,
  isHeroPositionAllowed,
  isRaiserAllowed,
  matrixActionsForSituation,
  parseActionBeforeKey,
  possibleRaiserPositions,
  sanitizeFilterState,
} from "./situations";

export {
  buildDisabledMaps,
  heroDisabledReason,
  isMatrixActionAllowed,
  listEnabledHeroes,
  raiserDisabledReason,
  validateRaiseDefensePair,
} from "./validation";

export {
  chartsStorageKey,
  deserializeChartsCache,
  emptyChartsCache,
  filterFromChartEntry,
  filterToApiSpot,
  findChart,
  handMixToLabel,
  labelToHandMix,
  loadChartsFromStorage,
  loadFilterChart,
  matrixDataToRanges,
  paintChartHand,
  saveChartsToStorage,
  saveFilterChart,
  serializeChartsCache,
  upsertChart,
} from "./charts";
