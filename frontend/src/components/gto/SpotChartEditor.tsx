/**
 * Редактор чартов по спотам: фильтры (Блок А/Б) + матрица 13×13 без смены дизайна.
 * Каждой паре [ситуация до нас] + [герой] соответствует свой chart в кэше.
 */
import { useEffect, useMemo, useState } from "react";
import type { StrategyDetail } from "../../api/client";
import {
  createSpot,
  listCells,
  listSpots,
  upsertCells,
} from "../../api/client";
import {
  emptyChartsCache,
  filterToApiSpot,
  isFilterReady,
  isMatrixActionAllowed,
  loadChartsFromStorage,
  loadFilterChart,
  matrixActionsForSituation,
  matrixDataToRanges,
  paintChartHand,
  resolveStrategyModule,
  saveChartsToStorage,
  saveFilterChart,
  type ChartMatrixData,
  type MatrixActionLabel,
  type SpotChartsCache,
  type SpotFilterState,
} from "../../lib/spotFilters";
import type { HandMix, PaintAction } from "../../lib/gameTree/types";
import { formatBadge } from "../../lib/strategyModules";
import GtoMatrix from "./GtoMatrix";
import SpotFilterBar from "./SpotFilterBar";

type Props = {
  strategy: StrategyDetail;
};

const INITIAL_FILTER: SpotFilterState = {
  situationKind: null,
  raiserPosition: null,
  heroPosition: null,
};

/** Кисть UI → метка чарта с учётом ситуации. */
function brushToLabel(
  brush: PaintAction,
  situation: SpotFilterState["situationKind"],
): MatrixActionLabel {
  if (brush === "FOLD") return "fold";
  if (brush === "CALL") return "call";
  // RAISE в vs Open пишем как 3bet
  if (situation === "IP_OOP_DEFENSE") return "3bet";
  return "raise";
}

function labelToBrush(label: MatrixActionLabel): PaintAction {
  if (label === "fold") return "FOLD";
  if (label === "call") return "CALL";
  return "RAISE";
}

export default function SpotChartEditor({ strategy }: Props) {
  const module = useMemo(
    () =>
      resolveStrategyModule(strategy.format ?? "cash", strategy.table_size ?? "6-max"),
    [strategy.format, strategy.table_size],
  );

  const [filter, setFilter] = useState<SpotFilterState>(INITIAL_FILTER);
  const [cache, setCache] = useState<SpotChartsCache>(() =>
    loadChartsFromStorage(strategy.id),
  );
  const [matrixData, setMatrixData] = useState<ChartMatrixData>({});
  const [brush, setBrush] = useState<PaintAction>("RAISE");
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const ready = isFilterReady(module, filter);
  const allowedLabels = matrixActionsForSituation(filter.situationKind);

  // При смене стратегии — перечитываем кэш
  useEffect(() => {
    setCache(loadChartsFromStorage(strategy.id));
    setFilter(INITIAL_FILTER);
    setMatrixData({});
  }, [strategy.id]);

  // При смене фильтра — подгружаем чарт этой пары
  useEffect(() => {
    if (!ready) {
      setMatrixData({});
      return;
    }
    setMatrixData(loadFilterChart(cache, filter));
    // Подстраиваем кисть под допустимые действия спота
    const labels = matrixActionsForSituation(filter.situationKind);
    if (labels[0]) setBrush(labelToBrush(labels[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cache snapshot on filter change only
  }, [filter.situationKind, filter.raiserPosition, filter.heroPosition, ready, module]);

  // Автосохранение кэша в localStorage
  useEffect(() => {
    saveChartsToStorage(strategy.id, cache);
  }, [cache, strategy.id]);

  const ranges: Record<string, HandMix> = useMemo(
    () => matrixDataToRanges(matrixData),
    [matrixData],
  );

  function onPaint(hand: string, erase = false) {
    if (!ready) return;
    const label = brushToLabel(brush, filter.situationKind);
    if (!erase && !isMatrixActionAllowed(filter.situationKind, label)) return;

    setMatrixData((prev) => {
      const next = paintChartHand(prev, hand, label, erase);
      setCache((c) => saveFilterChart(c, filter, next));
      return next;
    });
  }

  /** Синхронизация текущего чарта в API StrategySpot (Trainer / анализ). */
  async function syncCurrentToApi() {
    const api = filterToApiSpot(filter);
    if (!api || !ready) return;
    setSyncNote("Сохранение в стратегию…");
    try {
      const spots = await listSpots(strategy.id);
      let spot = spots.find(
        (s) =>
          s.spot_key === api.spotKey &&
          s.hero_position === api.hero &&
          (s.villain_position ?? null) === api.villain,
      );
      if (!spot) {
        spot = await createSpot(strategy.id, {
          spot_key: api.spotKey,
          hero_position: api.hero,
          villain_position: api.villain,
          label: null,
          stack_bb_min: null,
          stack_bb_max: null,
          sort_order: spots.length,
        });
      }
      const cells = Object.entries(matrixData).map(([hand_code, label]) => {
        const mix = matrixDataToRanges({ [hand_code]: label })[hand_code];
        return {
          hand_code,
          raise_freq: mix.RAISE,
          call_freq: mix.CALL,
          fold_freq: mix.FOLD,
        };
      });
      // Добиваем отсутствующие руки fold'ом не нужно — upsert частичный
      if (cells.length > 0) await upsertCells(spot.id, cells);
      // Подтягиваем уже сохранённые ячейки обратно (на случай частичной матрицы)
      await listCells(spot.id);
      setSyncNote("Чарт сохранён в стратегию");
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : "Ошибка сохранения");
    }
  }

  function clearAllCharts() {
    if (!window.confirm("Очистить все локальные чарты этой стратегии?")) return;
    setCache(emptyChartsCache());
    setMatrixData({});
  }

  return (
    <div className="spf-editor">
      <header className="spf-editor-top">
        <div>
          <h2>Споты · позиции</h2>
          <p>
            {formatBadge(strategy.format ?? "cash")} · {strategy.table_size} ·{" "}
            {strategy.stack_depth}
          </p>
        </div>
        <div className="spf-editor-actions">
          <button type="button" className="spf-btn" onClick={() => void syncCurrentToApi()} disabled={!ready}>
            В стратегию
          </button>
          <button type="button" className="spf-btn ghost" onClick={clearAllCharts}>
            Очистить кэш
          </button>
        </div>
      </header>

      <SpotFilterBar module={module} state={filter} onChange={setFilter} />

      <div className={`spf-matrix-wrap${ready ? "" : " is-disabled"}`}>
        {!ready ? (
          <div className="spf-matrix-lock">
            <strong>Матрица заблокирована</strong>
            <span>Выбери ситуацию (Блок А) и позицию героя (Блок Б)</span>
          </div>
        ) : (
          <>
            <div className="gto-paint-bar">
              <span className="gto-paint-label">Кисть</span>
              {allowedLabels.map((label) => {
                const a = labelToBrush(label);
                return (
                  <button
                    key={label}
                    type="button"
                    className={`gto-paint ${a.toLowerCase()}${brush === a ? " active" : ""}`}
                    onClick={() => setBrush(a)}
                  >
                    {label === "3bet" ? "3-Bet" : label === "raise" ? "Raise" : label === "call" ? "Call" : "Fold"}
                  </button>
                );
              })}
              <span className="gto-paint-hint">
                {filter.situationKind === "RFI" ? "RFI" : `vs ${filter.raiserPosition}`} ·{" "}
                {filter.heroPosition} · {Object.keys(matrixData).length} рук
              </span>
            </div>
            <GtoMatrix
              ranges={ranges}
              paintAction={brush}
              weight={100}
              onPaint={onPaint}
            />
          </>
        )}
      </div>

      {syncNote ? <p className="spf-sync-note">{syncNote}</p> : null}

      <details className="spf-json">
        <summary>JSON кэш чартов ({cache.charts.length})</summary>
        <pre>{JSON.stringify(cache, null, 2)}</pre>
      </details>
    </div>
  );
}
