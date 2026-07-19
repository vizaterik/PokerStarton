import { useMemo, useState } from "react";
import type { CurvePoint } from "../api/client";

type Props = {
  curve: CurvePoint[];
  unit?: "bb" | "money";
};

const W = 640;
const H = 240;
const PAD = { top: 18, right: 16, bottom: 28, left: 48 };

export default function ProfitChart({ curve, unit = "bb" }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    const values = curve.map((p) => (unit === "bb" ? p.cum_bb : p.cum_money));
    const n = Math.max(values.length, 1);
    const minV = Math.min(0, ...values, -1);
    const maxV = Math.max(0, ...values, 1);
    const span = maxV - minV || 1;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const xAt = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => PAD.top + ((maxV - v) / span) * innerH;
    const zeroY = yAt(0);

    const pts = values.map((v, i) => ({ x: xAt(i), y: yAt(v), v, i }));

    // Build green (above 0) and red (below 0) area paths by walking segments.
    let green = "";
    let red = "";
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const cross =
        (a.v >= 0 && b.v < 0) || (a.v < 0 && b.v >= 0)
          ? {
              t: a.v / (a.v - b.v || 1),
              x: a.x + (b.x - a.x) * (a.v / (a.v - b.v || 1)),
            }
          : null;

      if (a.v >= 0 && b.v >= 0) {
        green += `M ${a.x} ${zeroY} L ${a.x} ${a.y} L ${b.x} ${b.y} L ${b.x} ${zeroY} Z `;
      } else if (a.v <= 0 && b.v <= 0) {
        red += `M ${a.x} ${zeroY} L ${a.x} ${a.y} L ${b.x} ${b.y} L ${b.x} ${zeroY} Z `;
      } else if (cross) {
        if (a.v >= 0) {
          green += `M ${a.x} ${zeroY} L ${a.x} ${a.y} L ${cross.x} ${zeroY} Z `;
          red += `M ${cross.x} ${zeroY} L ${b.x} ${b.y} L ${b.x} ${zeroY} Z `;
        } else {
          red += `M ${a.x} ${zeroY} L ${a.x} ${a.y} L ${cross.x} ${zeroY} Z `;
          green += `M ${cross.x} ${zeroY} L ${b.x} ${b.y} L ${b.x} ${zeroY} Z `;
        }
      }
    }

    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const yTicks = [minV, minV + span * 0.25, 0, maxV - span * 0.25, maxV]
      .filter((v, i, arr) => arr.findIndex((x) => Math.abs(x - v) < span * 0.01) === i)
      .sort((a, b) => a - b);

    return { pts, green, red, line, zeroY, yTicks, yAt, minV, maxV, values };
  }, [curve, unit]);

  if (curve.length === 0) return null;

  const active = hover != null ? model.pts[hover] : null;
  const activePoint = hover != null ? curve[hover] : null;

  return (
    <div className="profit-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="profit-chart-svg"
        role="img"
        aria-label="График кумулятивного выигрыша"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="greenFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3dd68c" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#3dd68c" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="redFill" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ff5a5a" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ff5a5a" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {model.yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={model.yAt(tick)}
              y2={model.yAt(tick)}
              className="chart-grid"
            />
            <text x={PAD.left - 10} y={model.yAt(tick) + 4} className="chart-axis" textAnchor="end">
              {unit === "bb" ? tick.toFixed(0) : tick.toFixed(2)}
            </text>
          </g>
        ))}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={model.zeroY}
          y2={model.zeroY}
          className="chart-zero"
        />

        {model.green && <path d={model.green} fill="url(#greenFill)" />}
        {model.red && <path d={model.red} fill="url(#redFill)" />}

        <path d={model.line} className="chart-line" fill="none" />

        {/* invisible hit targets */}
        {model.pts.map((p) => (
          <circle
            key={p.i}
            cx={p.x}
            cy={p.y}
            r={10}
            fill="transparent"
            onMouseEnter={() => setHover(p.i)}
          />
        ))}

        {active && (
          <>
            <line
              x1={active.x}
              x2={active.x}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="chart-cross"
            />
            <circle cx={active.x} cy={active.y} r={5} className="chart-dot" />
          </>
        )}

        <text x={PAD.left} y={H - 10} className="chart-axis">
          Руки →
        </text>
        <text x={W - PAD.right} y={H - 10} className="chart-axis" textAnchor="end">
          {curve.length} hands
        </text>
      </svg>

      {active && activePoint && (
        <div
          className="chart-tooltip"
          style={{
            left: `${(active.x / W) * 100}%`,
          }}
        >
          <strong>
            #{activePoint.hand_index} · {unit === "bb" ? `${activePoint.cum_bb.toFixed(1)} bb` : `$${activePoint.cum_money.toFixed(2)}`}
          </strong>
          <span>
            Раздача:{" "}
            {unit === "bb"
              ? `${activePoint.hand_bb >= 0 ? "+" : ""}${activePoint.hand_bb.toFixed(1)} bb`
              : `${activePoint.hand_money >= 0 ? "+" : ""}$${activePoint.hand_money.toFixed(2)}`}
          </span>
        </div>
      )}
    </div>
  );
}
