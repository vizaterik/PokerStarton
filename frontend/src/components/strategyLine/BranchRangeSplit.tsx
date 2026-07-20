import type { BranchStat } from "../../lib/gameTree/combos";

type Props = {
  splits: BranchStat[];
  heroAction?: string | null;
};

export default function BranchRangeSplit({ splits, heroAction }: Props) {
  if (!splits.length) return null;
  return (
    <ul className="branch-range-split" aria-label="Сплит диапазона">
      {splits.map((s) => (
        <li
          key={s.action}
          className={
            heroAction && s.action === heroAction
              ? "branch-range-split-item is-hero"
              : "branch-range-split-item"
          }
        >
          <strong>{s.label}</strong>
          <span>
            {s.pct}% · {s.combos} комбо
          </span>
        </li>
      ))}
    </ul>
  );
}
