import { useRef } from "react";
import { CellFreq, handCodeAt, RANKS } from "../lib/handMatrix";

type Props = {
  cells: Record<string, CellFreq>;
  selected?: string | null;
  onPaint: (handCode: string, phase: "start" | "drag") => void;
  onSelect?: (handCode: string) => void;
  disabled?: boolean;
};

function cellTitle(code: string, cell: CellFreq) {
  const r = Math.round(cell.raise_freq * 100);
  const c = Math.round(cell.call_freq * 100);
  const f = Math.round(cell.fold_freq * 100);
  return `${code} — Raise ${r}% · Call ${c}% · Fold ${f}%`;
}

function cellBadge(cell: CellFreq): string | null {
  const r = cell.raise_freq;
  const c = cell.call_freq;
  if (r < 0.02 && c < 0.02) return null;
  if (r >= 0.98) return "100";
  if (c >= 0.98) return "100";
  if (r > 0.02 && c > 0.02) return `${Math.round(r * 100)}/${Math.round(c * 100)}`;
  if (r > 0.02) return String(Math.round(r * 100));
  return String(Math.round(c * 100));
}

export default function RangeMatrix({ cells, selected, onPaint, onSelect, disabled }: Props) {
  const painting = useRef(false);

  function paint(row: number, col: number, phase: "start" | "drag") {
    const code = handCodeAt(row, col);
    if (phase === "start") onSelect?.(code);
    if (disabled) return;
    onPaint(code, phase);
  }

  return (
    <div
      className={`range-matrix${disabled ? " is-readonly" : ""}`}
      onMouseLeave={() => {
        painting.current = false;
      }}
      onMouseUp={() => {
        painting.current = false;
      }}
    >
      <div className="range-matrix-corner" />
      {RANKS.map((rank) => (
        <div key={`col-${rank}`} className="range-matrix-label">
          {rank}
        </div>
      ))}
      {RANKS.map((rowRank, row) => (
        <div key={`row-${rowRank}`} className="range-matrix-row">
          <div className="range-matrix-label">{rowRank}</div>
          {RANKS.map((_, col) => {
            const code = handCodeAt(row, col);
            const cell = cells[code] ?? { raise_freq: 0, call_freq: 0, fold_freq: 1 };
            const badge = cellBadge(cell);
            const isSelected = selected === code;
            return (
              <button
                key={code}
                type="button"
                className={`range-matrix-cell${isSelected ? " selected" : ""}`}
                title={cellTitle(code, cell)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  painting.current = !disabled;
                  paint(row, col, "start");
                }}
                onMouseEnter={() => {
                  if (painting.current) paint(row, col, "drag");
                }}
              >
                <span className="cell-bars" aria-hidden="true">
                  {cell.raise_freq > 0.01 ? (
                    <i className="bar raise" style={{ flex: cell.raise_freq }} />
                  ) : null}
                  {cell.call_freq > 0.01 ? (
                    <i className="bar call" style={{ flex: cell.call_freq }} />
                  ) : null}
                  {cell.fold_freq > 0.01 || (cell.raise_freq <= 0.01 && cell.call_freq <= 0.01) ? (
                    <i className="bar fold" style={{ flex: Math.max(cell.fold_freq, 0.01) }} />
                  ) : null}
                </span>
                <span className="cell-code">{code}</span>
                {badge ? <span className="cell-pct">{badge}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
      <div className="range-matrix-legend">
        <span>
          <i className="lg raise" /> Raise
        </span>
        <span>
          <i className="lg call" /> Call
        </span>
        <span>
          <i className="lg fold" /> Fold
        </span>
      </div>
    </div>
  );
}
