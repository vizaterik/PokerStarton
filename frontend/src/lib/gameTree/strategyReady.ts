/**
 * Whether the constructor has painted play charts for strategy compare.
 * Empty / unpainted trees make analysis look like “100% correct” with 0 decisions.
 */
import { collectAnalysisBranches } from "./branches";
import { loadTree } from "./persist";

export function strategyHasPlayCharts(strategyId: string): boolean {
  if (!strategyId) return false;
  try {
    return collectAnalysisBranches(loadTree(strategyId).root).length > 0;
  } catch {
    return false;
  }
}

/** Short notice after upload / in «Моя стратегия». */
export const STRATEGY_CHARTS_GAP_HINT =
  "Стратегия ещё без чартов: для точного анализа соберите ветки розыгрышей в конструкторе и закрасьте диапазоны.";
