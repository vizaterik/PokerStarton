/**
 * Блок А + Блок Б: фильтры ситуации и позиции героя.
 * Матрица разблокируется только когда фильтр валиден (isFilterReady).
 */
import {
  SITUATION_OPTIONS,
  buildDisabledMaps,
  isFilterReady,
  possibleRaiserPositions,
  positionsForModule,
  sanitizeFilterState,
  type SpotFilterState,
  type StrategyModule,
  type TablePosition,
} from "../../lib/spotFilters";

type Props = {
  module: StrategyModule;
  state: SpotFilterState;
  onChange: (next: SpotFilterState) => void;
};

export default function SpotFilterBar({ module, state, onChange }: Props) {
  const disabled = buildDisabledMaps(module, state);
  const raisers = possibleRaiserPositions(module);
  const heroes = positionsForModule(module);
  const ready = isFilterReady(module, state);

  function patch(partial: Partial<SpotFilterState>) {
    onChange(sanitizeFilterState(module, { ...state, ...partial }));
  }

  return (
    <div className="spf">
      {/* ── Блок А: что произошло до хода героя ── */}
      <section className="spf-block" aria-label="Действие до нас">
        <header className="spf-block-head">
          <h3>Действие до нас</h3>
          <span>Ситуация за столом</span>
        </header>

        <div className="spf-chips" role="group" aria-label="Тип ситуации">
          {SITUATION_OPTIONS.map((opt) => {
            const active = state.situationKind === opt.kind;
            return (
              <button
                key={opt.kind}
                type="button"
                className={`spf-chip${active ? " is-active" : ""}`}
                title={opt.hint}
                onClick={() =>
                  patch({
                    situationKind: opt.kind,
                    // Смена типа ситуации сбрасывает рейзера (sanitize добьёт героя)
                    raiserPosition:
                      opt.kind === "RFI" ? null : state.raiserPosition,
                  })
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Под-выбор рейзера — только для защиты vs open */}
        {state.situationKind === "IP_OOP_DEFENSE" ? (
          <div className="spf-sub">
            <span className="spf-sub-label">Кто сделал рейз?</span>
            <div className="spf-chips" role="group" aria-label="Позиция рейзера">
              {raisers.map((pos) => {
                const isOff = disabled.raisers[pos];
                const active = state.raiserPosition === pos;
                return (
                  <button
                    key={pos}
                    type="button"
                    className={`spf-chip spf-chip-raiser${active ? " is-active" : ""}`}
                    disabled={isOff}
                    title={disabled.raiserReasons[pos] ?? `Open-raise от ${pos}`}
                    onClick={() => patch({ raiserPosition: pos })}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Блок Б: позиция героя / активная матрица ── */}
      <section
        className={`spf-block${state.situationKind ? "" : " is-locked"}`}
        aria-label="Позиция героя"
      >
        <header className="spf-block-head">
          <h3>Позиция героя</h3>
          <span>
            {state.situationKind
              ? "Активная позиция · клик переключает матрицу"
              : "Сначала выбери ситуацию выше"}
          </span>
        </header>

        <div className="spf-chips" role="group" aria-label="Позиции героя">
          {heroes.map((pos: TablePosition) => {
            const isOff = disabled.heroes[pos];
            const active = state.heroPosition === pos;
            return (
              <button
                key={pos}
                type="button"
                className={`spf-chip spf-chip-hero${active ? " is-active" : ""}`}
                disabled={isOff}
                title={disabled.heroReasons[pos] ?? `Чарт для ${pos}`}
                onClick={() => patch({ heroPosition: pos })}
              >
                {pos}
              </button>
            );
          })}
        </div>

        <p className={`spf-status${ready ? " is-ready" : ""}`}>
          {ready
            ? `Матрица: ${
                state.situationKind === "RFI"
                  ? "RFI"
                  : `vs Open ${state.raiserPosition}`
              } · Hero ${state.heroPosition}`
            : "Выбери ситуацию и допустимую позицию героя, чтобы редактировать чарт"}
        </p>
      </section>
    </div>
  );
}
