import { useState } from "react";
import type { Seat } from "../../lib/gameTree/types";
import type { SeatWindow } from "../../lib/gameTree/seatView";

type Props = {
  windows: SeatWindow[];
  history: { nodeId: string; text: string; current: boolean; potTag?: string }[];
  stackDepth: number;
  editingSeat: Seat | null;
  onWindowAction: (
    position: Seat,
    action: "FOLD" | "CALL" | "RAISE",
    sizingBB?: number,
  ) => void;
  /** Open full seat range (Fold/Call/Raise mix) — does not change paint brush. */
  onEditRange: (position: Seat) => void;
  onRewind: (nodeId: string) => void;
  disabled?: boolean;
};

function alreadyActed(win: SeatWindow): boolean {
  return (
    win.status === "locked" ||
    win.status === "folded" ||
    win.status === "auto-folded"
  );
}

function pillLabel(win: SeatWindow, action: "FOLD" | "CALL" | "RAISE"): string {
  if (action === "FOLD") return "FOLD";
  if (action === "CALL") return win.callPillText;
  return win.raisePillText;
}

/**
 * Position windows: click seat → full range.
 * Fold / Call / Raise (3-bet / 4-bet) подстраиваются под линию оппонентов.
 */
export default function PreflopActionSelector({
  windows,
  history,
  stackDepth,
  editingSeat,
  onWindowAction,
  onEditRange,
  onRewind,
  disabled,
}: Props) {
  const [hoveredSeat, setHoveredSeat] = useState<Seat | null>(null);

  function openRange(position: Seat) {
    onEditRange(position);
  }

  function isAllInSizing(sizing: number | null | undefined): boolean {
    return sizing != null && sizing >= stackDepth - 0.5;
  }

  function handleWindowAction(position: Seat, action: "FOLD" | "CALL" | "RAISE") {
    if (disabled) return;
    const win = windows.find((w) => w.seat === position);
    if (!win) return;

    // Same FOLD/CALL already locked → open range
    if (alreadyActed(win) && win.lockedAction === action && action !== "RAISE") {
      openRange(position);
      return;
    }

    // Same sized raise (не all-in) → open range; all-in ↔ 4-bet = смена ветки
    if (alreadyActed(win) && win.lockedAction === "RAISE" && action === "RAISE") {
      if (!isAllInSizing(win.lockedSizing)) {
        openRange(position);
        return;
      }
      // был all-in → клик 4-BET переключает на стандартный сайз
    }

    onWindowAction(position, action);
  }

  function pillChosen(win: SeatWindow, action: "FOLD" | "CALL" | "RAISE"): boolean {
    // Active / waiting — ещё не выбрали ответ на текущую ситуацию
    if (win.status === "active" || win.status === "waiting") return false;
    if (action === "RAISE") {
      // ALL-IN — отдельная кнопка; 4-BET/RAISE подсвечиваем только если не пуш
      return win.lockedAction === "RAISE" && !isAllInSizing(win.lockedSizing);
    }
    return win.lockedAction === action;
  }

  return (
    <div className="pas mwb">
      <div className="pas-history" aria-label="Branch history">
        {history.map((h, i) => (
          <span key={`${h.nodeId}-${i}`} className="pas-history-item">
            {i > 0 ? <span className="pas-history-arrow">→</span> : null}
            <button
              type="button"
              className={`pas-history-chip${h.current ? " is-current" : ""}`}
              onClick={() => {
                if (!h.current) onRewind(h.nodeId);
              }}
              disabled={h.current}
            >
              {h.potTag ? <em className="pas-history-pot">#{h.potTag}</em> : null}
              {h.text}
            </button>
          </span>
        ))}
      </div>

      <div className="mwb-row">
        {windows.map((win) => {
          const dimmed =
            win.status === "auto-folded" || win.status === "folded";
          const past = alreadyActed(win);
          const isEditing = editingSeat === win.seat;
          const isHovered = hoveredSeat === win.seat;
          const tone = win.status === "active" ? "none" : win.borderTone;
          const canOpenRange =
            !disabled &&
            (Boolean(win.nodeId) ||
              win.status === "active" ||
              win.status === "waiting");

          return (
            <article
              key={win.seat}
              className={[
                "mwb-window",
                `mwb-tone-${tone}`,
                `mwb-status-${win.status}`,
                dimmed ? "is-dimmed" : "",
                isEditing ? "is-editing" : "",
                isHovered ? "is-hovered" : "",
                canOpenRange ? "is-clickable" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseEnter={() => setHoveredSeat(win.seat)}
              onMouseLeave={() => setHoveredSeat(null)}
            >
              <button
                type="button"
                className="mwb-seat-hit"
                disabled={!canOpenRange}
                title={`Открыть рендж ${win.label}`}
                onClick={() => openRange(win.seat)}
              >
                <h3 className="mwb-seat">{win.label}</h3>
                <span className={`mwb-badge mwb-badge-${win.status}`}>
                  {win.statusLabel}
                </span>
                {past && win.lockedAction ? (
                  <span className="mwb-locked-meta">
                    {win.lockedAction === "RAISE"
                      ? win.lockedSizing != null
                        ? `${win.raisePillText} ${win.lockedSizing}bb`
                        : win.raisePillText
                      : win.lockedAction === "CALL"
                        ? win.callPillText
                        : "FOLD"}
                  </span>
                ) : win.status === "active" ? (
                  <span className="mwb-locked-meta mwb-locked-hint">
                    {win.facingRaiseCount === 0
                      ? "ответ · open"
                      : win.raiseLabel === "SQUEEZE"
                        ? "ответ · squeeze"
                        : win.facingRaiseCount === 1
                          ? "ответ · vs open"
                          : win.facingRaiseCount === 2
                            ? "ответ · vs 3-bet"
                            : "ответ · vs 4-bet"}
                  </span>
                ) : (
                  <span className="mwb-locked-meta mwb-locked-hint">рендж</span>
                )}
              </button>

              <div className="mwb-pills" role="group" aria-label={`${win.label} actions`}>
                {(["FOLD", "CALL", "RAISE"] as const).map((action) => {
                  const chosen = pillChosen(win, action);
                  const showFourBet =
                    action === "RAISE" &&
                    (((win.status === "active" || win.status === "waiting") &&
                      win.facingRaiseCount === 2) ||
                      (past && isAllInSizing(win.lockedSizing)));
                  const label = showFourBet ? "4-BET" : pillLabel(win, action);
                  return (
                    <button
                      key={action}
                      type="button"
                      className={[
                        "pas-pill",
                        action.toLowerCase(),
                        chosen ? "is-chosen" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={disabled}
                      title={
                        chosen
                          ? `Рендж ${win.label}`
                          : past
                            ? `Сменить на ${label}`
                            : `${label} · ветка ответа (стек ${stackDepth}bb)`
                      }
                      onClick={() => handleWindowAction(win.seat, action)}
                    >
                      {label}
                    </button>
                  );
                })}
                {/* vs 3-bet: ALL-IN рядом с 4-BET */}
                {(win.status === "active" || win.status === "waiting") &&
                win.facingRaiseCount === 2 ? (
                  <button
                    type="button"
                    className="pas-pill raise is-allin"
                    disabled={disabled}
                    title={`All-in ${stackDepth}bb`}
                    onClick={() => {
                      if (disabled) return;
                      onWindowAction(win.seat, "RAISE", stackDepth);
                    }}
                  >
                    ALL-IN
                  </button>
                ) : null}
                {/* Уже сделали 4-bet — можно сменить на ALL-IN */}
                {past &&
                win.lockedAction === "RAISE" &&
                !isAllInSizing(win.lockedSizing) &&
                win.raiseLabel === "4-BET" ? (
                  <button
                    type="button"
                    className="pas-pill raise is-allin"
                    disabled={disabled}
                    title={`Сменить на All-in ${stackDepth}bb`}
                    onClick={() => {
                      if (disabled) return;
                      onWindowAction(win.seat, "RAISE", stackDepth);
                    }}
                  >
                    ALL-IN
                  </button>
                ) : null}
                {/* Уже запушили — подсветка + клик в рендж */}
                {past &&
                win.lockedAction === "RAISE" &&
                isAllInSizing(win.lockedSizing) ? (
                  <button
                    type="button"
                    className="pas-pill raise is-chosen is-allin"
                    onClick={() => openRange(win.seat)}
                    title={`Рендж ${win.label}`}
                  >
                    ALL-IN
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <p className="pas-size-hint">
        Open → 3-BET · Raise+Call → SQUEEZE · vs 3-bet → 4-BET + ALL-IN
      </p>
    </div>
  );
}
