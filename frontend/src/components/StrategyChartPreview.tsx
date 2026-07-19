import type { CellFreq } from "../lib/handMatrix";
import RangeMatrix from "./RangeMatrix";

type Props = {
  cells: Record<string, CellFreq>;
  selected?: string | null;
  onSelectHand?: (handCode: string) => void;
  emptyHint?: string;
};

/** Read-only strategy range chart (raise / call / fold mix). */
export default function StrategyChartPreview({
  cells,
  selected = null,
  onSelectHand,
  emptyHint = "Нет чарта стратегии для этого спота",
}: Props) {
  const hasAny = Object.values(cells).some(
    (c) => c.raise_freq > 0 || c.call_freq > 0,
  );

  if (!hasAny) {
    return <p className="muted">{emptyHint}</p>;
  }

  return (
    <RangeMatrix
      cells={cells}
      selected={selected}
      disabled
      onPaint={() => undefined}
      onSelect={onSelectHand}
    />
  );
}
