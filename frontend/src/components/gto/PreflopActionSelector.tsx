import { useState } from "react";
import type { DecisionButton, Seat } from "../../lib/gameTree/types";
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

function isAllInSizing(
  sizing: number | null | undefined,
  stackDepth: number,
): boolean {
  return sizing != null && sizing >= stackDepth - 0.5;
}

function answerChosen(
  win: SeatWindow,
  answer: DecisionButton,
  stackDepth: number,
): boolean {
  if (win.status === "active" || win.status === "waiting") return false;
  if (!win.lockedAction) return false;
  if (answer.action !== win.lockedAction) return false;
  if (answer.action !== "RAISE") return true;
  const lockedAllIn = isAllInSizing(win.lockedSizing, stackDepth);
  const answerAllIn = isAllInSizing(answer.defaultSizing ?? null, stackDepth);
  if (lockedAllIn || answerAllIn) return lockedAllIn === answerAllIn;
  if (win.lockedSizing == null || answer.defaultSizing == null) return true;
  return Math.abs(win.lockedSizing - answer.defaultSizing) < 0.05;
}

/**
 * GTO Wizard-style action tree: each seat column shows Fold / Call / Raise {n} / All-in.
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

  function handleAnswer(position: Seat, answer: DecisionButton) {
    if (disabled) return;
    const win = windows.find((w) => w.seat === position);
    if (!win) return;

    if (alreadyActed(win) && answerChosen(win, answer, stackDepth)) {
      openRange(position);
      return;
    }

    onWindowAction(
      position,
      answer.action,
      answer.action === "RAISE" ? answer.defaultSizing : undefined,
    );
  }

  return (
    <div className="pas mwb mwb--wizard">
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
          const isPaintTarget = editingSeat === win.seat;
          const isEditing = isPaintTarget && !past;
          const isHovered = hoveredSeat === win.seat;
          const tone = win.status === "active" ? "none" : win.borderTone;
          const canOpenRange =
            !disabled &&
            (Boolean(win.nodeId) ||
              win.status === "active" ||
              win.status === "waiting");
          const answers = win.answers?.length
            ? win.answers
            : ([
                { id: "fold", action: "FOLD", label: "Fold", tone: "fold" },
                { id: "call", action: "CALL", label: "Call", tone: "call" },
                { id: "raise", action: "RAISE", label: "Raise", tone: "raise" },
              ] as DecisionButton[]);

          return (
            <article
              key={win.seat}
              className={[
                "mwb-window",
                `mwb-tone-${tone}`,
                `mwb-status-${win.status}`,
                dimmed ? "is-dimmed" : "",
                isEditing ? "is-editing" : "",
                isPaintTarget && past ? "is-paint-target" : "",
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
                title={`Range ${win.label}`}
                onClick={() => openRange(win.seat)}
              >
                <h3 className="mwb-seat">{win.label}</h3>
                {win.statusLabel ? (
                  <span className={`mwb-badge mwb-badge-${win.status}`}>
                    {win.statusLabel}
                  </span>
                ) : null}
              </button>

              <div className="mwb-pills" role="group" aria-label={`${win.label} actions`}>
                {answers.map((answer) => {
                  const chosen = answerChosen(win, answer, stackDepth);
                  return (
                    <button
                      key={answer.id}
                      type="button"
                      className={[
                        "pas-pill",
                        answer.tone,
                        answer.id === "allin" ? "is-allin" : "",
                        chosen ? "is-chosen" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={disabled}
                      title={
                        chosen
                          ? `Range ${win.label}`
                          : past
                            ? `Switch to ${answer.label}`
                            : answer.label
                      }
                      onClick={() => handleAnswer(win.seat, answer)}
                    >
                      {answer.label}
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
