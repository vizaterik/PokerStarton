import type { BranchRangeSpot } from "../../lib/gameTree/rangeSpots";

export type RangeSpotView = BranchRangeSpot & {
  raisePct: number;
  callPct: number;
  foldPct: number;
};

type Props = {
  spots: RangeSpotView[];
  activeNodeId: string | null;
  onSelect: (nodeId: string) => void;
  title?: string;
  subtitle?: string;
};

/** Seat range switcher — click position → full Fold/Call/Raise mix on the matrix. */
export default function RangeSpotsBar({
  spots,
  activeNodeId,
  onSelect,
  title = "Ренджи линии",
  subtitle = "позиция → полный рендж · кисть Fold / Call / Raise ниже",
}: Props) {
  if (spots.length === 0) return null;

  return (
    <div className="gto-range-spots">
      <header className="gto-range-spots-head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </header>
      <div className="gto-range-spots-row">
        {spots.map((spot) => {
          const active = activeNodeId === spot.nodeId;
          return (
            <button
              key={spot.nodeId}
              type="button"
              className={`gto-range-spot${active ? " is-active" : ""}`}
              title={`Рендж ${spot.label}`}
              onClick={() => onSelect(spot.nodeId)}
            >
              <em>{spot.label}</em>
              <span>
                R {spot.raisePct.toFixed(0)}% · C {spot.callPct.toFixed(0)}% · F{" "}
                {spot.foldPct.toFixed(0)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
