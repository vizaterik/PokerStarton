import { useMemo, useState } from "react";

/** Unified point for H2N-style multi-line profit chart */
export type HudChartPoint = {
  hand_index: number;
  cum_total_bb: number;
  cum_wwsd_bb: number;
  cum_wsd_bb: number;
  cum_total_money: number;
  cum_wwsd_money: number;
  cum_wsd_money: number;
};

type Props = {
  curve: HudChartPoint[];
  unit?: "bb" | "money";
};

const W = 920;
const H = 380;
const PAD = { top: 28, right: 24, bottom: 40, left: 56 };

type LineKey = "total" | "wwsd" | "wsd";

function fmt(v: number, unit: "bb" | "money") {
  return unit === "bb" ? `${v.toFixed(1)} bb` : `$${v.toFixed(2)}`;
}

export default function HudLinesChart({ curve, unit = "bb" }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [visible, setVisible] = useState<Record<LineKey, boolean>>({
    total: true,
    wwsd: true,
    wsd: true,
  });

  const model = useMemo(() => {
    const total = curve.map((p) => (unit === "bb" ? p.cum_total_bb : p.cum_total_money));
    // User convention: red = without showdown, blue = at showdown
    const red = curve.map((p) => (unit === "bb" ? p.cum_wwsd_bb : p.cum_wwsd_money));
    const blue = curve.map((p) => (unit === "bb" ? p.cum_wsd_bb : p.cum_wsd_money));
    const n = Math.max(total.length, 1);
    const series: number[] = [0];
    if (visible.total) series.push(...total);
    if (visible.wwsd) series.push(...red);
    if (visible.wsd) series.push(...blue);
    const minV = Math.min(...series, -1);
    const maxV = Math.max(...series, 1);
    const span = maxV - minV || 1;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const xAt = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => PAD.top + ((maxV - v) / span) * innerH;
    const zeroY = yAt(0);

    const linePath = (values: number[]) =>
      values.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`).join(" ");

    const yTicks = [minV, minV + span * 0.25, 0, maxV - span * 0.25, maxV]
      .filter((v, i, arr) => arr.findIndex((x) => Math.abs(x - v) < span * 0.01) === i)
      .sort((a, b) => a - b);

    return {
      totalPath: linePath(total),
      bluePath: linePath(blue),
      redPath: linePath(red),
      total,
      blue,
      red,
      zeroY,
      yTicks,
      xAt,
      yAt,
      end: {
        total: total[total.length - 1] ?? 0,
        blue: blue[blue.length - 1] ?? 0,
        red: red[red.length - 1] ?? 0,
      },
    };
  }, [curve, unit, visible]);

  if (curve.length === 0) return null;

  const i = hover ?? curve.length - 1;
  const point = curve[i];

  function toggle(key: LineKey) {
    setVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // keep at least one line on
      if (!next.total && !next.wwsd && !next.wsd) return prev;
      return next;
    });
  }

  return (
    <div className="hud-lines-chart">
      <div className="hud-lines-legend">
        <button
          type="button"
          className={`leg-btn leg-total${visible.total ? " on" : ""}`}
          onClick={() => toggle("total")}
        >
          Общий <em>{fmt(model.end.total, unit)}</em>
        </button>
        <button
          type="button"
          className={`leg-btn leg-red${visible.wwsd ? " on" : ""}`}
          onClick={() => toggle("wwsd")}
        >
          Без вскрытия <em>{fmt(model.end.red, unit)}</em>
        </button>
        <button
          type="button"
          className={`leg-btn leg-blue${visible.wsd ? " on" : ""}`}
          onClick={() => toggle("wsd")}
        >
          На вскрытии <em>{fmt(model.end.blue, unit)}</em>
        </button>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="profit-chart-svg"
        role="img"
        aria-label="График: общий, без вскрытия (красная), на вскрытии (синяя)"
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={model.zeroY}
          y2={model.zeroY}
          className="chart-zero"
        />
        {model.yTicks.map((tick) => (
          <g key={tick}>
            <text x={PAD.left - 8} y={model.yAt(tick) + 4} textAnchor="end" className="chart-axis">
              {unit === "bb" ? tick.toFixed(0) : tick.toFixed(2)}
            </text>
          </g>
        ))}
        {visible.wwsd && <path d={model.redPath} className="hud-line red" />}
        {visible.wsd && <path d={model.bluePath} className="hud-line blue" />}
        {visible.total && <path d={model.totalPath} className="hud-line total" />}
        {curve.map((_, idx) => (
          <rect
            key={idx}
            x={model.xAt(idx) - (W - PAD.left - PAD.right) / Math.max(curve.length * 2, 2)}
            y={PAD.top}
            width={Math.max((W - PAD.left - PAD.right) / Math.max(curve.length, 1), 4)}
            height={H - PAD.top - PAD.bottom}
            fill="transparent"
            onMouseEnter={() => setHover(idx)}
          />
        ))}
        {hover != null && (
          <>
            <line
              x1={model.xAt(hover)}
              x2={model.xAt(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="chart-cross"
            />
            {visible.wwsd && (
              <circle cx={model.xAt(hover)} cy={model.yAt(model.red[hover])} r={4} className="hud-dot red" />
            )}
            {visible.wsd && (
              <circle cx={model.xAt(hover)} cy={model.yAt(model.blue[hover])} r={4} className="hud-dot blue" />
            )}
            {visible.total && (
              <circle cx={model.xAt(hover)} cy={model.yAt(model.total[hover])} r={4.5} className="hud-dot total" />
            )}
          </>
        )}
      </svg>
      {point && (
        <div className="hud-lines-tooltip">
          <strong>#{point.hand_index}</strong>
          <span className="tip-total">Общий {fmt(model.total[i], unit)}</span>
          <span className="tip-red">Без вскрытия {fmt(model.red[i], unit)}</span>
          <span className="tip-blue">На вскрытии {fmt(model.blue[i], unit)}</span>
        </div>
      )}
    </div>
  );
}

/** Map career results curve → chart points */
export function resultsCurveToHud(
  curve: Array<{
    hand_index: number;
    cum_bb: number;
    cum_money: number;
    cum_wwsd_bb?: number;
    cum_wsd_bb?: number;
    cum_wwsd_money?: number;
    cum_wsd_money?: number;
  }>,
): HudChartPoint[] {
  return curve.map((p) => ({
    hand_index: p.hand_index,
    cum_total_bb: p.cum_bb,
    cum_total_money: p.cum_money,
    cum_wwsd_bb: p.cum_wwsd_bb ?? 0,
    cum_wsd_bb: p.cum_wsd_bb ?? 0,
    cum_wwsd_money: p.cum_wwsd_money ?? 0,
    cum_wsd_money: p.cum_wsd_money ?? 0,
  }));
}

/** Map strategy analysis curve → chart points */
export function analysisCurveToHud(
  curve: Array<{
    hand_index: number;
    cum_total_bb: number;
    cum_wwsd_bb: number;
    cum_wsd_bb: number;
    cum_total_money: number;
    cum_wwsd_money: number;
    cum_wsd_money: number;
  }>,
): HudChartPoint[] {
  return curve.map((p) => ({
    hand_index: p.hand_index,
    cum_total_bb: p.cum_total_bb,
    cum_wwsd_bb: p.cum_wwsd_bb,
    cum_wsd_bb: p.cum_wsd_bb,
    cum_total_money: p.cum_total_money,
    cum_wwsd_money: p.cum_wwsd_money,
    cum_wsd_money: p.cum_wsd_money,
  }));
}
