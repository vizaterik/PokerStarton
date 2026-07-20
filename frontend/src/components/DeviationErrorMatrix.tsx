import { handCodeAt, RANKS } from "../lib/handMatrix";
import type { ChartErrorCell } from "../api/client";

type Props = {
  cells: ChartErrorCell[];
  selectedHand?: string | null;
  onSelectHand?: (handCode: string) => void;
  /** Tooltip noun — «ошибка» or «разд.» for played range. */
  countNoun?: string;
  ariaLabel?: string;
};

function actionCounts(cell: ChartErrorCell) {
  let raise = cell.raise_count ?? 0;
  let call = cell.call_count ?? 0;
  let fold = cell.fold_count ?? 0;
  const total = raise + call + fold;
  // Fallback for older payloads without breakdown
  if (total === 0 && (cell.errors ?? 0) > 0) {
    const act = cell.actual_action;
    if (act === "raise") raise = cell.errors;
    else if (act === "call") call = cell.errors;
    else if (act === "fold") fold = cell.errors;
  }
  return { raise, call, fold, total: raise + call + fold };
}

/** Error matrix: raise=red, call=green, fold=blue; mix by error action share + count. */
export default function DeviationErrorMatrix({
  cells,
  selectedHand = null,
  onSelectHand,
  countNoun = "ошибка",
  ariaLabel = "Матрица ошибок",
}: Props) {
  const byCode = new Map(cells.map((c) => [c.hand_code, c]));

  return (
    <div className="dev-error-matrix" aria-label={ariaLabel}>
      <div className="dev-error-matrix-corner" />
      {RANKS.map((rank) => (
        <div key={`c-${rank}`} className="dev-error-matrix-label">
          {rank}
        </div>
      ))}
      {RANKS.map((rowRank, row) => (
        <div key={`r-${rowRank}`} className="dev-error-matrix-row">
          <div className="dev-error-matrix-label">{rowRank}</div>
          {RANKS.map((_, col) => {
            const code = handCodeAt(row, col);
            const hit = byCode.get(code);
            const { raise, call, fold, total } = hit
              ? actionCounts(hit)
              : { raise: 0, call: 0, fold: 0, total: 0 };
            const count = hit?.errors ?? total;
            const selected = selectedHand === code;
            const parts: string[] = [];
            if (raise) parts.push(`R ${raise}`);
            if (call) parts.push(`C ${call}`);
            if (fold) parts.push(`F ${fold}`);
            return (
              <button
                key={code}
                type="button"
                className={`dev-error-matrix-cell${total > 0 ? " has-count" : ""}${
                  selected ? " selected" : ""
                }`}
                title={
                  hit
                    ? `${code}: ${count}× ${countNoun}${parts.length ? ` (${parts.join(" · ")})` : ""}`
                    : `${code}: —`
                }
                onClick={() => onSelectHand?.(code)}
              >
                {total > 0 ? (
                  <span className="dev-error-matrix-bars" aria-hidden="true">
                    {raise > 0 ? (
                      <i className="bar raise" style={{ flex: raise }} />
                    ) : null}
                    {call > 0 ? (
                      <i className="bar call" style={{ flex: call }} />
                    ) : null}
                    {fold > 0 ? (
                      <i className="bar fold" style={{ flex: fold }} />
                    ) : null}
                  </span>
                ) : null}
                <span className="dev-error-matrix-code">{code}</span>
                {count > 0 ? (
                  <span className="dev-error-matrix-count">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
      <div className="dev-error-matrix-legend">
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
