import type { HandMix } from "../gameTree/types";
import { buildActionBeforeKey, parseActionBeforeKey } from "./situations";
import type {
  ActionBeforeKey,
  ChartMatrixData,
  MatrixActionLabel,
  SpotChartEntry,
  SpotChartsCache,
  SpotFilterState,
  StrategyModule,
  TablePosition,
} from "./types";
import { toDbPosition } from "./positions";

/**
 * Пустой кэш чартов.
 */
export function emptyChartsCache(): SpotChartsCache {
  return { charts: [] };
}

/**
 * Ищет чарт по паре (actionBefore, hero).
 */
export function findChart(
  cache: SpotChartsCache,
  actionBefore: ActionBeforeKey,
  heroPosition: TablePosition,
): SpotChartEntry | undefined {
  return cache.charts.find(
    (c) => c.actionBefore === actionBefore && c.heroPosition === heroPosition,
  );
}

/**
 * Upsert чарта в кэш (иммутабельно).
 */
export function upsertChart(
  cache: SpotChartsCache,
  entry: SpotChartEntry,
): SpotChartsCache {
  const idx = cache.charts.findIndex(
    (c) =>
      c.actionBefore === entry.actionBefore &&
      c.heroPosition === entry.heroPosition,
  );
  if (idx < 0) {
    return { charts: [...cache.charts, entry] };
  }
  const charts = cache.charts.slice();
  charts[idx] = entry;
  return { charts };
}

/**
 * Сохраняет matrixData для текущего фильтра в дерево charts[].
 * Если фильтр неполный — возвращает cache без изменений.
 */
export function saveFilterChart(
  cache: SpotChartsCache,
  state: SpotFilterState,
  matrixData: ChartMatrixData,
): SpotChartsCache {
  if (!state.situationKind || !state.heroPosition) return cache;
  const actionBefore = buildActionBeforeKey(
    state.situationKind,
    state.raiserPosition,
  );
  if (!actionBefore) return cache;

  return upsertChart(cache, {
    actionBefore,
    heroPosition: state.heroPosition,
    matrixData: { ...matrixData },
  });
}

/**
 * Загружает matrixData для фильтра (или пустой объект).
 */
export function loadFilterChart(
  cache: SpotChartsCache,
  state: SpotFilterState,
): ChartMatrixData {
  if (!state.situationKind || !state.heroPosition) return {};
  const actionBefore = buildActionBeforeKey(
    state.situationKind,
    state.raiserPosition,
  );
  if (!actionBefore) return {};
  return { ...(findChart(cache, actionBefore, state.heroPosition)?.matrixData ?? {}) };
}

/**
 * Сериализация кэша в JSON-строку (для localStorage / экспорта).
 */
export function serializeChartsCache(cache: SpotChartsCache): string {
  return JSON.stringify(cache, null, 2);
}

/**
 * Десериализация с мягкой валидацией формы.
 */
export function deserializeChartsCache(raw: string): SpotChartsCache {
  try {
    const parsed = JSON.parse(raw) as SpotChartsCache;
    if (!parsed || !Array.isArray(parsed.charts)) return emptyChartsCache();
    return {
      charts: parsed.charts.filter(
        (c) =>
          c &&
          typeof c.actionBefore === "string" &&
          typeof c.heroPosition === "string" &&
          c.matrixData &&
          typeof c.matrixData === "object",
      ),
    };
  } catch {
    return emptyChartsCache();
  }
}

/**
 * Ключ localStorage для кэша чартов стратегии.
 */
export function chartsStorageKey(strategyId: string): string {
  return `pokerstraton.spotCharts.v1.${strategyId}`;
}

export function loadChartsFromStorage(strategyId: string): SpotChartsCache {
  try {
    const raw = localStorage.getItem(chartsStorageKey(strategyId));
    if (!raw) return emptyChartsCache();
    return deserializeChartsCache(raw);
  } catch {
    return emptyChartsCache();
  }
}

export function saveChartsToStorage(
  strategyId: string,
  cache: SpotChartsCache,
): void {
  localStorage.setItem(chartsStorageKey(strategyId), serializeChartsCache(cache));
}

/**
 * Дискретная метка чарта → частоты HandMix для отрисовки матрицы 13×13.
 * raise/3bet → RAISE; call → CALL; fold → FOLD.
 */
export function labelToHandMix(label: MatrixActionLabel | undefined): HandMix {
  if (label === "raise" || label === "3bet") {
    return { FOLD: 0, CALL: 0, RAISE: 1 };
  }
  if (label === "call") {
    return { FOLD: 0, CALL: 1, RAISE: 0 };
  }
  return { FOLD: 1, CALL: 0, RAISE: 0 };
}

/**
 * HandMix → ближайшая дискретная метка с учётом допустимых действий спота.
 */
export function handMixToLabel(
  mix: HandMix,
  allowed: MatrixActionLabel[],
): MatrixActionLabel {
  const r = mix.RAISE ?? 0;
  const c = mix.CALL ?? 0;
  if (r >= c && r >= 0.5) {
    return allowed.includes("3bet") ? "3bet" : "raise";
  }
  if (c >= 0.5 && allowed.includes("call")) return "call";
  return "fold";
}

/**
 * ChartMatrixData → Record<hand, HandMix> для GtoMatrix.
 */
export function matrixDataToRanges(
  data: ChartMatrixData,
): Record<string, HandMix> {
  const out: Record<string, HandMix> = {};
  for (const [hand, label] of Object.entries(data)) {
    out[hand] = labelToHandMix(label);
  }
  return out;
}

/**
 * Применяет кисть к одной руке в ChartMatrixData.
 */
export function paintChartHand(
  data: ChartMatrixData,
  hand: string,
  action: MatrixActionLabel,
  erase = false,
): ChartMatrixData {
  const next = { ...data };
  if (erase || action === "fold") {
    // Стирание / fold — убираем из кэша или пишем fold явно
    if (erase) delete next[hand];
    else next[hand] = "fold";
    return next;
  }
  next[hand] = action;
  return next;
}

/**
 * Маппинг фильтра → поля StrategySpot в API (spot_key + villain).
 */
export function filterToApiSpot(
  state: SpotFilterState,
): { spotKey: string; hero: string; villain: string | null } | null {
  if (!state.situationKind || !state.heroPosition) return null;
  const hero = toDbPosition(state.heroPosition);
  if (state.situationKind === "RFI") {
    return { spotKey: "rfi", hero, villain: null };
  }
  if (!state.raiserPosition) return null;
  return {
    spotKey: "vs_open",
    hero,
    villain: toDbPosition(state.raiserPosition),
  };
}

/**
 * Восстанавливает фильтр из ключа чарта (для навигации по кэшу).
 */
export function filterFromChartEntry(
  entry: SpotChartEntry,
  module: StrategyModule,
): SpotFilterState {
  const parsed = parseActionBeforeKey(entry.actionBefore, module);
  return {
    situationKind: parsed.kind,
    raiserPosition: parsed.raiser,
    heroPosition: entry.heroPosition,
  };
}
