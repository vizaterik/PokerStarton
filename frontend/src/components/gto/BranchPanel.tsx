import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSpot,
  fetchMissingSpots,
  type EnsuredSpotInfo,
} from "../../api/client";
import { listHandsForStrategy } from "../../engine/localDb";
import { listMissingSpotsLocal } from "../../engine/localMissingSpots";
import { spotPotKind, spotPotTag, treeMatchupLabel } from "../../lib/branchLabel";
import {
  STYLE_PRESETS,
  type StylePreset,
} from "../../lib/gameTree/branchPresets";
import type { BranchPotKind, SavedBranch } from "../../lib/gameTree/branches";
import { potKindTag } from "../../lib/gameTree/branches";
import {
  seedSpotIntoDoc,
  type SeedFocus,
} from "../../lib/gameTree/seedTreeFromSpots";
import { coveredByConstructorTags } from "../../lib/spotCoverage";
import type {
  GameTreeDocument,
  StackDepth,
  TableSize,
} from "../../lib/gameTree/types";

type PotFilter = "all" | BranchPotKind;
type ChartFilter = "all" | "empty" | "painted";

const POT_FILTERS: { id: PotFilter; label: string; short: string }[] = [
  { id: "all", label: "Все поты", short: "Все" },
  { id: "srp", label: "Raise pot", short: "Raise" },
  { id: "3bp", label: "3-bet pot", short: "3-bet" },
  { id: "4bp", label: "4-bet pot", short: "4-bet" },
  { id: "limp", label: "Limp pot", short: "Limp" },
];

const CHART_FILTERS: { id: ChartFilter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "empty", label: "Без чарта" },
  { id: "painted", label: "С чартом" },
];

const MISSING_PREVIEW = 6;
const MATCHUP_CHIP_LIMIT = 12;

type Props = {
  strategyId: string;
  doc: GameTreeDocument;
  branches: SavedBranch[];
  activeBranchId: string | null;
  activeStyleId: string | null;
  tableSize: TableSize;
  stackDepth: StackDepth;
  onOpen: (branch: SavedBranch) => void;
  onDelete: (branch: SavedBranch) => void;
  onResetAll: () => void;
  onApplyPreset: (preset: StylePreset) => void | Promise<void>;
  /** After adding a missing spot — apply tree + jump into editor */
  onSpotAdded?: (next: GameTreeDocument, focus: SeedFocus) => void;
};

function tableSizeLabel(size: TableSize): string {
  if (size === 2) return "HU";
  if (size === 3) return "3-Max";
  if (size === 8) return "8-Max";
  if (size === 9) return "9-Max";
  return "6-Max";
}

function missingKey(s: EnsuredSpotInfo) {
  return `${s.spot_key}|${s.hero_position}|${s.villain_position ?? ""}`;
}

export default function BranchPanel({
  strategyId,
  doc,
  branches,
  activeBranchId,
  activeStyleId,
  tableSize,
  stackDepth,
  onOpen,
  onDelete,
  onResetAll,
  onApplyPreset,
  onSpotAdded,
}: Props) {
  const [potFilter, setPotFilter] = useState<PotFilter>("all");
  const [matchupFilter, setMatchupFilter] = useState<string>("all");
  const [chartFilter, setChartFilter] = useState<ChartFilter>("all");
  const [missing, setMissing] = useState<EnsuredSpotInfo[]>([]);
  const [missingLoading, setMissingLoading] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [missingExpanded, setMissingExpanded] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const reloadMissing = useCallback(async () => {
    setMissingLoading(true);
    try {
      const localHands = await listHandsForStrategy(strategyId);
      if (localHands.length > 0) {
        // Live editor branches are source of truth — never disagree with the list above.
        setMissing(await listMissingSpotsLocal(strategyId, branches));
        return;
      }
      const res = await fetchMissingSpots(strategyId);
      // Empty constructor → all server missing stay; else filter by constructor tags.
      setMissing(
        !branches.length
          ? (res.missing ?? [])
          : (res.missing ?? []).filter(
              (s) =>
                !coveredByConstructorTags(
                  {
                    spot_key: s.spot_key,
                    hero_position: s.hero_position,
                    villain_position: s.villain_position,
                  },
                  branches,
                ),
            ),
      );
    } catch {
      try {
        setMissing(await listMissingSpotsLocal(strategyId, branches));
      } catch {
        setMissing([]);
      }
    } finally {
      setMissingLoading(false);
    }
  }, [strategyId, branches]);

  useEffect(() => {
    void reloadMissing();
  }, [reloadMissing, branches.length, doc.updatedAt]);

  const emptyCount = useMemo(
    () => branches.filter((b) => b.paintedCount <= 0).length,
    [branches],
  );
  const paintedCount = branches.length - emptyCount;

  /** Branches after chart filter — base for pot/matchup option counts. */
  const chartScoped = useMemo(() => {
    if (chartFilter === "empty") return branches.filter((b) => b.paintedCount <= 0);
    if (chartFilter === "painted") return branches.filter((b) => b.paintedCount > 0);
    return branches;
  }, [branches, chartFilter]);

  const potScoped = useMemo(() => {
    if (potFilter === "all") return chartScoped;
    return chartScoped.filter((b) => b.potKind === potFilter);
  }, [chartScoped, potFilter]);

  const matchupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of potScoped) {
      counts.set(b.label, (counts.get(b.label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [potScoped]);

  // Drop stale matchup when pot/chart changes and it no longer exists.
  useEffect(() => {
    if (matchupFilter === "all") return;
    if (!matchupOptions.some((m) => m.label === matchupFilter)) {
      setMatchupFilter("all");
    }
  }, [matchupFilter, matchupOptions]);

  const filtered = useMemo(() => {
    let list = potScoped;
    if (matchupFilter !== "all") {
      list = list.filter((b) => b.label === matchupFilter);
    }
    return [...list].sort((a, b) => {
      if (a.potKind !== b.potKind) return a.potKind.localeCompare(b.potKind);
      return a.label.localeCompare(b.label, "ru");
    });
  }, [potScoped, matchupFilter]);

  const potCounts = useMemo(() => {
    const base =
      matchupFilter === "all"
        ? chartScoped
        : chartScoped.filter((b) => b.label === matchupFilter);
    const counts: Record<PotFilter, number> = {
      all: base.length,
      limp: 0,
      srp: 0,
      "3bp": 0,
      "4bp": 0,
    };
    for (const b of base) counts[b.potKind] += 1;
    return counts;
  }, [chartScoped, matchupFilter]);

  const filtersActive =
    potFilter !== "all" || matchupFilter !== "all" || chartFilter !== "all";

  function resetFilters() {
    setPotFilter("all");
    setMatchupFilter("all");
    setChartFilter("all");
  }

  /** Already filtered vs painted constructor branches in reloadMissing. */
  const sortedMissing = useMemo(
    () =>
      [...missing].sort(
        (a, b) =>
          (a.profit_money ?? 0) - (b.profit_money ?? 0) ||
          (b.hands_count ?? 0) - (a.hands_count ?? 0),
      ),
    [missing],
  );
  const visibleMissing = missingExpanded
    ? sortedMissing
    : sortedMissing.slice(0, MISSING_PREVIEW);
  const hiddenMissing = Math.max(0, sortedMissing.length - MISSING_PREVIEW);

  async function addMissing(spot: EnsuredSpotInfo) {
    const key = missingKey(spot);
    if (addingKey) return;
    setAddingKey(key);
    setHint(null);
    try {
      await createSpot(strategyId, {
        spot_key: spot.spot_key,
        hero_position: spot.hero_position,
        villain_position: spot.villain_position,
        label: spot.label || undefined,
      });
      const seeded = seedSpotIntoDoc(doc, spot);
      if (seeded) {
        onSpotAdded?.(seeded.doc, {
          tipNodeId: seeded.tipNodeId,
          paintNodeId: seeded.paintNodeId,
        });
        return;
      }
      setHint(
        "Спот в базе есть, но линию в дереве не собрали — открой редактор и построй вручную.",
      );
      await reloadMissing();
    } catch (err: unknown) {
      setHint(err instanceof Error ? err.message : "Не удалось добавить ветку");
    } finally {
      setAddingKey(null);
    }
  }

  return (
    <div className="gto-branches-tab">
      <section className="gto-branches-filter" aria-label="Branch filters">
        <header className="gto-branches-head">
          <h2>Фильтр</h2>
          <span className="gto-branches-count">
            {filtered.length}
            {filtered.length !== branches.length ? ` / ${branches.length}` : ""}
          </span>
          {filtersActive ? (
            <button type="button" className="gto-filter-reset" onClick={resetFilters}>
              Сбросить
            </button>
          ) : null}
        </header>

        <div className="gto-filter-block">
          <span className="gto-filter-label">Пот</span>
          <div className="gto-filter-chips gto-filter-pots" role="group" aria-label="Тип пота">
            {POT_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                title={f.label}
                className={potFilter === f.id ? "is-active" : ""}
                disabled={f.id !== "all" && potCounts[f.id] === 0}
                onClick={() => setPotFilter(f.id)}
              >
                {f.short}
                <em>{potCounts[f.id]}</em>
              </button>
            ))}
          </div>
        </div>

        <div className="gto-filter-block">
          <span className="gto-filter-label">Матчап · кто vs кого</span>
          <div className="gto-filter-matchup-row">
            <label className="gto-filter-select-wrap">
              <select
                value={matchupFilter}
                onChange={(e) => setMatchupFilter(e.target.value)}
                aria-label="Матчап кто против кого"
              >
                <option value="all">Все матчапы ({potScoped.length})</option>
                {matchupOptions.map((m) => (
                  <option key={m.label} value={m.label}>
                    {m.label} · {m.count}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {matchupOptions.length > 0 ? (
            <div
              className="gto-filter-chips gto-filter-matchups"
              role="group"
              aria-label="Быстрый выбор матчапа"
            >
              {(matchupOptions.length > MATCHUP_CHIP_LIMIT
                ? matchupOptions.slice(0, MATCHUP_CHIP_LIMIT)
                : matchupOptions
              ).map((m) => (
                <button
                  key={m.label}
                  type="button"
                  className={matchupFilter === m.label ? "is-active" : ""}
                  onClick={() =>
                    setMatchupFilter((prev) => (prev === m.label ? "all" : m.label))
                  }
                >
                  {m.label}
                  <em>{m.count}</em>
                </button>
              ))}
              {matchupOptions.length > MATCHUP_CHIP_LIMIT ? (
                <span className="gto-filter-more muted">
                  +{matchupOptions.length - MATCHUP_CHIP_LIMIT} в списке
                </span>
              ) : null}
            </div>
          ) : (
            <p className="gto-branches-empty">Нет матчапов под выбранный пот.</p>
          )}
        </div>

        <div className="gto-filter-block gto-filter-block-tight">
          <span className="gto-filter-label">Чарт</span>
          <div className="gto-filter-chips" role="group" aria-label="Покрытие чартами">
            {CHART_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={chartFilter === f.id ? "is-active" : ""}
                onClick={() => setChartFilter(f.id)}
              >
                {f.label}
                <em>
                  {f.id === "all"
                    ? branches.length
                    : f.id === "empty"
                      ? emptyCount
                      : paintedCount}
                </em>
              </button>
            ))}
          </div>
        </div>

        <div className="gto-filter-foot">
          <p className="gto-filter-meta muted">
            {tableSizeLabel(tableSize)} · {stackDepth}bb
            {filtersActive
              ? ` · ${potFilter === "all" ? "все поты" : potKindTag(potFilter)}${
                  matchupFilter !== "all" ? ` · ${matchupFilter}` : ""
                }`
              : ""}
          </p>
          <button
            type="button"
            className="gto-branches-danger"
            disabled={branches.length === 0}
            onClick={() => {
              if (
                branches.length > 0 &&
                window.confirm("Удалить все ветки и ренджи? Это нельзя отменить.")
              ) {
                onResetAll();
              }
            }}
          >
            Очистить все
          </button>
        </div>
      </section>

      <section className="gto-branches" aria-label="Saved branches">
        <header className="gto-branches-head">
          <h2>
            {matchupFilter !== "all"
              ? matchupFilter
              : potFilter !== "all"
                ? potKindTag(potFilter)
                : chartFilter === "empty"
                  ? "Без чартов"
                  : chartFilter === "painted"
                    ? "С чартами"
                    : "Ветки"}
          </h2>
          <span className="gto-branches-count">
            {branches.length === 0 ? "пусто" : `${filtered.length}`}
          </span>
        </header>

        {branches.length === 0 ? (
          <p className="gto-branches-empty">
            Пока нет закрытых линий. Построй в редакторе или добавь спот из сессий ниже.
          </p>
        ) : filtered.length === 0 ? (
          <p className="gto-branches-empty">
            Нет веток под фильтр
            {potFilter !== "all" ? ` «${potKindTag(potFilter)}»` : ""}
            {matchupFilter !== "all" ? ` · ${matchupFilter}` : ""}.
            {filtersActive ? (
              <>
                {" "}
                <button type="button" className="gto-filter-reset-inline" onClick={resetFilters}>
                  Сбросить
                </button>
              </>
            ) : null}
          </p>
        ) : (
          <ul className="gto-branches-list gto-branches-list-full">
            {filtered.map((b) => {
              const isActive = b.id === activeBranchId;
              const empty = b.paintedCount <= 0;
              return (
                <li
                  key={b.id}
                  className={`gto-branch-row${isActive ? " is-active" : ""}${empty ? " is-empty" : ""}`}
                >
                  <button
                    type="button"
                    className="gto-branch-item"
                    onClick={() => onOpen(b)}
                  >
                    <span className="gto-branch-num">#{b.index}</span>
                    <span className="gto-branch-label">{b.label}</span>
                    <span className="gto-branch-meta">
                      <em className={`pot-${b.potKind}`}>{potKindTag(b.potKind)}</em>
                      {empty ? (
                        <em className="no-chart">нет чарта</em>
                      ) : (
                        <em className="has-range">{b.paintedCount} hands</em>
                      )}
                    </span>
                  </button>
                  <div className="gto-branch-actions">
                    <button
                      type="button"
                      className="gto-branch-open"
                      onClick={() => onOpen(b)}
                    >
                      Открыть
                    </button>
                    <button
                      type="button"
                      className="gto-branch-delete"
                      onClick={() => {
                        if (window.confirm(`Удалить ветку #${b.index}?\n${b.label}`)) {
                          onDelete(b);
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="gto-branches-missing" aria-label="Missing spots from sessions">
        <header className="gto-branches-head gto-branches-head-compact">
          <h2>Из сессий</h2>
          <span className="gto-branches-count">
            {missingLoading
              ? "…"
              : sortedMissing.length === 0
                ? "ок"
                : sortedMissing.length}
          </span>
        </header>
        {hint ? <p className="gto-branches-hint-ok">{hint}</p> : null}
        {missingLoading ? (
          <p className="gto-branches-empty">Сверяем…</p>
        ) : sortedMissing.length === 0 ? (
          <p className="gto-branches-empty">
            Все матчапы из сессий уже есть среди тегов конструктора.
          </p>
        ) : (
          <>
            <p className="gto-branches-hint" style={{ marginBottom: "0.35rem" }}>
              Ситуации из раздач без такого же тега в конструкторе (пот + матчап).
            </p>
            <ul className="gto-missing-list">
              {visibleMissing.map((s) => {
                const key = missingKey(s);
                const busy = addingKey === key;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className="gto-missing-row"
                      disabled={Boolean(addingKey)}
                      onClick={() => void addMissing(s)}
                    >
                      <span className="gto-missing-label">
                        <em className={`pot-tag pot-${spotPotKind(s.spot_key)}`}>
                          {spotPotTag(s.spot_key)}
                        </em>
                        {treeMatchupLabel(s.spot_key, s.hero_position, s.villain_position)}
                        <em className="gto-missing-tag">нет чарта</em>
                      </span>
                      <span className="gto-missing-meta">
                        {(s.hands_count ?? 0).toLocaleString("ru-RU")}
                      </span>
                      <span className="gto-missing-add">
                        {busy ? "…" : "+"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {hiddenMissing > 0 ? (
              <button
                type="button"
                className="gto-missing-more"
                onClick={() => setMissingExpanded((v) => !v)}
              >
                {missingExpanded
                  ? "Свернуть"
                  : `Ещё ${hiddenMissing}`}
              </button>
            ) : null}
          </>
        )}
      </section>

      <section className="gto-branches-presets" aria-label="Style presets">
        <header className="gto-branches-head">
          <h2>Каркас линий (опционально)</h2>
          <span className="gto-branches-count">
            {STYLE_PRESETS[0]?.lines.length ?? 0} линий
          </span>
        </header>
        <p className="gto-branches-hint">
          Создаёт дерево SRP / 3-bet / 4-bet / all-in. Уже закрашенные чарты не трогает —
          только пустые споты могут получить шаблон.
        </p>
        <div className="gto-preset-grid">
          {STYLE_PRESETS.map((preset) => {
            const isActive = activeStyleId === preset.id;
            return (
              <article
                key={preset.id}
                className={`gto-preset-card${isActive ? " is-active" : ""}`}
              >
                <div className="gto-preset-card-top">
                  <span className="gto-preset-tag">{preset.tag}</span>
                  <strong>{preset.name}</strong>
                </div>
                <p>{preset.description}</p>
                <div className="gto-preset-card-foot">
                  <em>каркас · без перезаписи чартов</em>
                  <button
                    type="button"
                    className="gto-preset-apply"
                    onClick={() => onApplyPreset(preset)}
                  >
                    {isActive ? "Достроить" : "Создать каркас"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
