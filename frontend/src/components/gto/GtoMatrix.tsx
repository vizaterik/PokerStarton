import { CSSProperties, useRef } from "react";
import { handCodeAt, RANKS } from "../../lib/handMatrix";
import { handMatchesBrush } from "../../lib/gameTree/engine";
import type { HandMix, PaintAction } from "../../lib/gameTree/types";

type Props = {
  ranges: Record<string, HandMix>;
  paintAction: PaintAction;
  weight: number;
  selected?: string | null;
  onPaint?: (handCode: string, erase?: boolean) => void;
  onSelect?: (handCode: string) => void;
  /** Preview matrix — no painting */
  readOnly?: boolean;
  /** When push_fold, RAISE band is treated as All-in visually (same colors). */
  actionMode?: "standard" | "push_fold";
};

/** Raise=red, Call=green, Fold=blue — fixed palette */
function cellStyle(mix: HandMix): CSSProperties {
  const r = mix.RAISE;
  const c = mix.CALL;
  const raiseEnd = r * 100;
  const callEnd = (r + c) * 100;
  return {
    background: `linear-gradient(90deg,
      #ef4444 0%,
      #ef4444 ${raiseEnd}%,
      #10b981 ${raiseEnd}%,
      #10b981 ${callEnd}%,
      #2563eb ${callEnd}%,
      #2563eb 100%)`,
  };
}

function badge(mix: HandMix): string | null {
  const r = mix.RAISE;
  const c = mix.CALL;
  if (r < 0.02 && c < 0.02) return null;
  if (r >= 0.98) return "100";
  if (c >= 0.98) return "100";
  if (r > 0.02 && c > 0.02) return `${Math.round(r * 100)}/${Math.round(c * 100)}`;
  if (r > 0.02) return String(Math.round(r * 100));
  return String(Math.round(c * 100));
}

export default function GtoMatrix({
  ranges,
  paintAction,
  weight,
  selected,
  onPaint,
  onSelect,
  readOnly = false,
  actionMode = "standard",
}: Props) {
  const painting = useRef(false);
  /** Locked for the whole drag stroke so drag doesn't flicker paint/erase. */
  const strokeErase = useRef(false);

  return (
    <div
      className={`gto-matrix brush-${paintAction.toLowerCase()}${readOnly ? " is-readonly" : ""}${actionMode === "push_fold" ? " is-push-fold" : ""}`}
      onMouseLeave={() => {
        painting.current = false;
      }}
      onMouseUp={() => {
        painting.current = false;
      }}
    >
      <div className="gto-matrix-corner" />
      {RANKS.map((rank) => (
        <div key={`c-${rank}`} className="gto-matrix-label">
          {rank}
        </div>
      ))}
      {RANKS.map((rowRank, row) => (
        <div key={`r-${rowRank}`} className="gto-matrix-row">
          <div className="gto-matrix-label">{rowRank}</div>
          {RANKS.map((_, col) => {
            const code = handCodeAt(row, col);
            const mix = ranges[code] ?? { FOLD: 1, CALL: 0, RAISE: 0 };
            const isSelected = selected === code;
            return (
              <button
                key={code}
                type="button"
                className={`gto-matrix-cell${isSelected ? " selected" : ""}`}
                style={cellStyle(mix)}
                title={`${code} — R ${Math.round(mix.RAISE * 100)}% · C ${Math.round(mix.CALL * 100)}% · F ${Math.round(mix.FOLD * 100)}% · повторный клик = fold`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (readOnly) {
                    onSelect?.(code);
                    return;
                  }
                  painting.current = true;
                  // Second click on the same brush paint → erase back to fold
                  strokeErase.current =
                    paintAction !== "FOLD" &&
                    handMatchesBrush(mix, paintAction, weight / 100);
                  onSelect?.(code);
                  onPaint?.(code, strokeErase.current);
                }}
                onMouseEnter={() => {
                  if (!readOnly && painting.current) {
                    onPaint?.(code, strokeErase.current);
                  }
                }}
              >
                <span className="gto-matrix-code">{code}</span>
                {badge(mix) ? <span className="gto-matrix-pct">{badge(mix)}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
