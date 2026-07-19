import { Brush, FREQ_PRESETS, brushToFreq, formatPct } from "../lib/handMatrix";

type Props = {
  brush: Brush;
  weight: number;
  onBrushChange: (brush: Brush) => void;
  onWeightChange: (weight: number) => void;
};

export default function FreqBrush({ brush, weight, onBrushChange, onWeightChange }: Props) {
  const preview = brushToFreq(brush, weight);
  const foldPct = Math.round(preview.fold_freq * 100);

  return (
    <div className="freq-brush">
      <div className="chip-row">
        <button
          type="button"
          className={`chip brush raise ${brush === "raise" ? "active" : ""}`}
          onClick={() => onBrushChange("raise")}
        >
          Raise
        </button>
        <button
          type="button"
          className={`chip brush call ${brush === "call" ? "active" : ""}`}
          onClick={() => onBrushChange("call")}
        >
          Call
        </button>
        <button
          type="button"
          className={`chip brush fold ${brush === "fold" ? "active" : ""}`}
          onClick={() => onBrushChange("fold")}
        >
          Fold
        </button>
      </div>

      {brush !== "fold" && (
        <>
          <div className="freq-slider-row">
            <div className="freq-slider-head">
              <span>Частота {brush === "raise" ? "Raise" : "Call"}</span>
              <strong>{weight}%</strong>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={weight}
              onChange={(e) => onWeightChange(Number(e.target.value))}
              className={`freq-range ${brush}`}
            />
          </div>
          <div className="freq-presets">
            {FREQ_PRESETS.map((pct) => (
              <button
                key={pct}
                type="button"
                className={`freq-preset ${weight === pct ? "active" : ""}`}
                onClick={() => onWeightChange(pct)}
              >
                {pct}%
              </button>
            ))}
          </div>
        </>
      )}

      <div className="brush-preview" aria-hidden="true">
        <div className="brush-preview-bars">
          <i style={{ width: `${preview.raise_freq * 100}%` }} className="raise" />
          <i style={{ width: `${preview.call_freq * 100}%` }} className="call" />
          <i style={{ width: `${preview.fold_freq * 100}%` }} className="fold" />
        </div>
        <div className="brush-preview-labels">
          <span>R {formatPct(preview.raise_freq * 100)}</span>
          <span>C {formatPct(preview.call_freq * 100)}</span>
          <span>F {foldPct}%</span>
        </div>
      </div>
    </div>
  );
}
