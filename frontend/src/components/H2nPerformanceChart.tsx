/**
 * H2N-style performance chart — custom SVG.
 * Four financial lines on a single symmetric Y-axis.
 * Discipline is shown only as a compliance % (not a line).
 */
import {
  useMemo,
  useRef,
  useState,
  startTransition,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { lttb } from "../lib/lttb";
import { areaPath, monotonePath } from "../lib/monotonePath";

export type H2nPerfPoint = {
  hand_index: number;
  net_bb: number;
  net_money: number;
  aiev_bb: number;
  aiev_money: number;
  wwsd_bb: number;
  wwsd_money: number;
  wsd_bb: number;
  wsd_money: number;
  compliance_rate: number;
};

type Unit = "bb" | "money";

type Props = {
  curve: H2nPerfPoint[];
  initialUnit?: Unit;
  bigBlind?: number | null;
  onUnitChange?: (unit: Unit) => void;
};

type LineKey = "net" | "aiev" | "wwsd" | "wsd";

const W = 700;
const H = 260;
const PAD = { top: 16, bottom: 28, left: 56, right: 14 };
const MAX_DRAW = 1200;
const TARGET_TICKS_MIN = 10;
const TARGET_TICKS_MAX = 14;
const TARGET_TICKS_IDEAL = 12;

const LINES: {
  key: LineKey;
  label: string;
  tip: string;
  color: string;
  filter: string;
  stroke: number;
  dash?: string;
}[] = [
  { key: "net", label: "Выигрыш", tip: "Amount Won", color: "#10B981", filter: "h2n-glow-green", stroke: 2.5 },
  {
    key: "aiev",
    label: "All-In EV",
    tip: "All-In EV",
    color: "#F59E0B",
    filter: "h2n-glow-amber",
    stroke: 2.35,
    dash: "8 5",
  },
  { key: "wsd", label: "На вскрытии", tip: "Showdown", color: "#3B82F6", filter: "h2n-glow-blue", stroke: 2.05 },
  { key: "wwsd", label: "Без вскрытия", tip: "Non-Showdown", color: "#EF4444", filter: "h2n-glow-red", stroke: 2.05 },
];

function pickMoney(p: H2nPerfPoint, key: LineKey, unit: Unit): number {
  if (unit === "bb") {
    if (key === "net") return p.net_bb;
    if (key === "aiev") return p.aiev_bb;
    if (key === "wwsd") return p.wwsd_bb;
    return p.wsd_bb;
  }
  if (key === "net") return p.net_money;
  if (key === "aiev") return p.aiev_money;
  if (key === "wwsd") return p.wwsd_money;
  return p.wsd_money;
}

function fmtHands(n: number) {
  if (n >= 1000) {
    const k = n / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return String(n);
}

function fmtGrouped(n: number, digits: number) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtMoney(v: number, unit: Unit) {
  if (unit === "bb") {
    const sign = v > 0 ? "+" : v < 0 ? "-" : "";
    return `${sign}${fmtGrouped(Math.abs(v), Math.abs(v) >= 100 ? 0 : 1)} bb`;
  }
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}$${fmtGrouped(Math.abs(v), 2)}`;
}

function fmtHandHeader(n: number) {
  return `Hand #${n.toLocaleString("en-US")}`;
}

function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const m = rough / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * pow;
}

type AxisScale = { minV: number; maxV: number; step: number; ticks: number[] };

function getSymmetricDomain(values: number[]): [number, number] {
  let maxVal = 0;
  for (const raw of values) {
    const val = Math.abs(raw || 0);
    if (val > maxVal) maxVal = val;
  }
  const bound = Math.max(1, Math.ceil(maxVal * 1.1));
  return [-bound, bound];
}

function buildSymmetricScale(
  domain: [number, number],
  unit: Unit,
  bigBlind: number | null | undefined,
): AxisScale {
  const [minV, maxV] = domain;
  const span = maxV - minV || 2;
  let step = niceStep(span / (TARGET_TICKS_IDEAL - 1));
  if (unit === "money" && bigBlind != null && bigBlind > 0) {
    const blinds = Math.max(1, Math.round(step / bigBlind));
    const snapped = niceStep(blinds) * bigBlind;
    if (snapped > 0) step = snapped;
  }
  if (unit === "bb") step = Math.max(1, niceStep(step));

  while (span / step + 1 > TARGET_TICKS_MAX) {
    const next = niceStep(step * 2);
    if (next <= step) break;
    step = next;
  }
  while (span / step + 1 < TARGET_TICKS_MIN && step > (unit === "bb" ? 1 : 0.01)) {
    const next = step / 2;
    if (next <= 0) break;
    const candidate = unit === "bb" ? Math.max(1, niceStep(next)) : niceStep(next);
    if (candidate >= step) break;
    step = candidate;
  }

  const ticks: number[] = [];
  const start = Math.round(minV / step);
  const end = Math.round(maxV / step);
  for (let i = start; i <= end; i += 1) {
    ticks.push(Number((i * step).toPrecision(12)));
  }
  if (!ticks.some((t) => Math.abs(t) < step * 1e-6)) {
    ticks.push(0);
    ticks.sort((a, b) => a - b);
  }

  return { minV, maxV, step, ticks };
}

function yTickLabel(v: number, unit: Unit, step: number) {
  if (unit === "bb") {
    const digits = step < 1 ? 1 : 0;
    const body = fmtGrouped(Math.abs(v), digits);
    if (v > 0) return `+${body} bb`;
    if (v < 0) return `-${body} bb`;
    return `0 bb`;
  }
  const digits = step < 1 ? 2 : 0;
  const body = fmtGrouped(Math.abs(v), digits);
  if (v > 0) return `+$${body}`;
  if (v < 0) return `-$${body}`;
  return `$0`;
}

export default function H2nPerformanceChart({
  curve,
  initialUnit = "bb",
  bigBlind = null,
  onUnitChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [unit, setUnit] = useState<Unit>(initialUnit);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [visible, setVisible] = useState<Record<LineKey, boolean>>({
    net: true,
    aiev: true,
    wwsd: true,
    wsd: true,
  });

  function setUnitSafe(next: Unit) {
    if (next === unit) return;
    startTransition(() => {
      setUnit(next);
      onUnitChange?.(next);
    });
  }

  const model = useMemo(() => {
    if (curve.length === 0) return null;

    const series = curve.map((p) => ({
      hand_index: p.hand_index,
      net: pickMoney(p, "net", unit),
      aiev: pickMoney(p, "aiev", unit),
      wwsd: pickMoney(p, "wwsd", unit),
      wsd: pickMoney(p, "wsd", unit),
      compliance_rate: p.compliance_rate,
    }));

    const leftVals: number[] = [0];
    for (const p of series) {
      if (visible.net) leftVals.push(p.net);
      if (visible.aiev) leftVals.push(p.aiev);
      if (visible.wwsd) leftVals.push(p.wwsd);
      if (visible.wsd) leftVals.push(p.wsd);
    }

    const left = buildSymmetricScale(getSymmetricDomain(leftVals), unit, bigBlind);
    const leftSpan = left.maxV - left.minV || left.step;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = series.length;

    const xAt = (i: number) =>
      PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => PAD.top + ((left.maxV - v) / leftSpan) * innerH;

    const sampled = lttb(
      series,
      Math.min(MAX_DRAW, n),
      (p) => p.hand_index,
      (p) => p.net,
    );

    const toPts = (key: LineKey) =>
      sampled.map(({ point, index }) => ({
        x: xAt(index),
        y: yAt(point[key]),
      }));

    const paths: Record<LineKey, string> = {
      net: monotonePath(toPts("net")),
      aiev: monotonePath(toPts("aiev")),
      wwsd: monotonePath(toPts("wwsd")),
      wsd: monotonePath(toPts("wsd")),
    };

    const maxHand = series[n - 1]?.hand_index ?? n;
    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * maxHand));
    const last = series[n - 1];

    return {
      series,
      paths,
      netArea: areaPath(toPts("net"), yAt(0)),
      left,
      xTicks,
      xAt,
      yAt,
      end: {
        net: last.net,
        aiev: last.aiev,
        wwsd: last.wwsd,
        wsd: last.wsd,
        compliance: last.compliance_rate,
      },
    };
  }, [curve, visible, unit, bigBlind]);

  if (!model || curve.length === 0) return null;
  const chart = model;

  const active = hoverIdx != null ? chart.series[hoverIdx] : chart.series[chart.series.length - 1];
  const activeI = hoverIdx ?? chart.series.length - 1;

  function toggle(key: LineKey) {
    setVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!Object.values(next).some(Boolean)) return prev;
      return next;
    });
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const innerW = W - PAD.left - PAD.right;
    const t = Math.min(1, Math.max(0, (px - PAD.left) / innerW));
    setHoverIdx(Math.round(t * (chart.series.length - 1)));
  }

  const tipLeftPct = ((chart.xAt(activeI) / W) * 100).toFixed(2);
  const tipFlip = chart.xAt(activeI) > W * 0.58;

  const endByKey: Record<LineKey, number> = {
    net: chart.end.net,
    aiev: chart.end.aiev,
    wwsd: chart.end.wwsd,
    wsd: chart.end.wsd,
  };

  const activeByKey: Record<LineKey, number> = {
    net: active.net,
    aiev: active.aiev,
    wwsd: active.wwsd,
    wsd: active.wsd,
  };

  const moneyLines = LINES.filter((l) => visible[l.key]);
  const drawOrder: LineKey[] = ["wsd", "wwsd", "net", "aiev"];

  return (
    <div className="h2n-chart" ref={wrapRef}>
      <div className="h2n-chart-toolbar">
        <div className="h2n-unit-toggle" role="group" aria-label="Единицы">
          <button
            type="button"
            className={unit === "money" ? "active" : ""}
            onClick={() => setUnitSafe("money")}
          >
            $
          </button>
          <button
            type="button"
            className={unit === "bb" ? "active" : ""}
            onClick={() => setUnitSafe("bb")}
          >
            bb
          </button>
        </div>
        <span className="h2n-compliance-pill" title="Доля решений, совпавших со стратегией">
          Дисциплина {chart.end.compliance.toFixed(1)}%
        </span>
      </div>

      <div className="h2n-chart-legend" role="group" aria-label="Линии графика">
        {LINES.map((line) => {
          const on = visible[line.key];
          return (
            <button
              key={line.key}
              type="button"
              className={`h2n-leg h2n-leg-${line.key}${on ? " on" : " off"}`}
              aria-pressed={on}
              title={on ? `Скрыть: ${line.label}` : `Показать: ${line.label}`}
              onClick={() => toggle(line.key)}
            >
              <i style={{ background: line.color, boxShadow: on ? `0 0 8px ${line.color}99` : "none" }} />
              {line.label} <em>{fmtMoney(endByKey[line.key], unit)}</em>
            </button>
          );
        })}
      </div>

      <div className="h2n-chart-stage">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h2n-chart-svg"
          role="img"
          aria-label="Performance chart"
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIdx(null)}
        >
          <defs>
            <filter id="h2n-glow-green" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#10B981" floodOpacity="0.35" />
            </filter>
            <filter id="h2n-glow-amber" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#F59E0B" floodOpacity="0.35" />
            </filter>
            <filter id="h2n-glow-red" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#EF4444" floodOpacity="0.35" />
            </filter>
            <filter id="h2n-glow-blue" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#3B82F6" floodOpacity="0.35" />
            </filter>
            <linearGradient id="h2n-net-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(16, 185, 129, 0.08)" />
              <stop offset="55%" stopColor="rgba(16, 185, 129, 0.03)" />
              <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
            </linearGradient>
          </defs>

          <rect
            x={PAD.left}
            y={PAD.top}
            width={W - PAD.left - PAD.right}
            height={H - PAD.top - PAD.bottom}
            className="h2n-plot-bg"
          />

          {chart.left.ticks.map((tick) => {
            const isZero = Math.abs(tick) < chart.left.step * 0.001;
            if (isZero) return null;
            return (
              <g key={`yl-${tick}`}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={chart.yAt(tick)}
                  y2={chart.yAt(tick)}
                  className="h2n-grid"
                  strokeDasharray="2 4"
                />
                <text
                  x={PAD.left - 6}
                  y={chart.yAt(tick)}
                  dominantBaseline="middle"
                  textAnchor="end"
                  className="h2n-axis-y"
                >
                  {yTickLabel(tick, unit, chart.left.step)}
                </text>
              </g>
            );
          })}

          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={chart.yAt(0)}
            y2={chart.yAt(0)}
            className="h2n-zero"
          />
          <text
            x={PAD.left - 6}
            y={chart.yAt(0)}
            dominantBaseline="middle"
            textAnchor="end"
            className="h2n-axis-y h2n-axis-zero"
          >
            {yTickLabel(0, unit, chart.left.step)}
          </text>

          {chart.xTicks.map((handN) => {
            const maxH = chart.series[chart.series.length - 1].hand_index;
            const i =
              chart.series.length <= 1
                ? 0
                : Math.min(
                    chart.series.length - 1,
                    Math.max(
                      0,
                      Math.round(((handN - 1) / Math.max(maxH - 1, 1)) * (chart.series.length - 1)),
                    ),
                  );
            const x = handN === 0 ? PAD.left : chart.xAt(i);
            return (
              <text key={`x-${handN}`} x={x} y={H - 12} textAnchor="middle" className="h2n-axis-x">
                {fmtHands(handN)}
              </text>
            );
          })}

          {visible.net && <path d={chart.netArea} fill="url(#h2n-net-fill)" />}

          {drawOrder.map((key) => {
            if (!visible[key]) return null;
            const meta = LINES.find((l) => l.key === key)!;
            return (
              <path
                key={key}
                d={chart.paths[key]}
                fill="none"
                stroke={meta.color}
                strokeWidth={meta.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={meta.dash}
                filter={`url(#${meta.filter})`}
              />
            );
          })}

          {hoverIdx != null && (
            <>
              <line
                x1={chart.xAt(hoverIdx)}
                x2={chart.xAt(hoverIdx)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                className="h2n-crosshair"
              />
              {LINES.filter((l) => visible[l.key]).map((line) => (
                <circle
                  key={`dot-${line.key}`}
                  cx={chart.xAt(hoverIdx)}
                  cy={chart.yAt(chart.series[hoverIdx][line.key])}
                  r={line.key === "net" ? 4.5 : 3.8}
                  fill={line.color}
                  stroke="#0A0C10"
                  strokeWidth={1.5}
                  style={{ filter: `drop-shadow(0px 0px 5px ${line.color})` }}
                />
              ))}
            </>
          )}
        </svg>

        {hoverIdx != null && (
          <div className={`h2n-tip${tipFlip ? " flip" : ""}`} style={{ left: `${tipLeftPct}%` }}>
            <header>{fmtHandHeader(active.hand_index)}</header>

            <div className="h2n-tip-section">
              {moneyLines.map((line) => (
                <div key={line.key} className="h2n-tip-row">
                  <i style={{ background: line.color }} />
                  <span>{line.tip}</span>
                  <strong>{fmtMoney(activeByKey[line.key], unit)}</strong>
                </div>
              ))}
            </div>

            <div className="h2n-tip-section h2n-tip-section-strategy">
              <div className="h2n-tip-row strategy">
                <i style={{ background: "#A855F7" }} />
                <span>Дисциплина</span>
                <strong>{active.compliance_rate.toFixed(1)}%</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function analysisCurveToH2n(
  curve: Array<{
    hand_index: number;
    cum_total_bb: number;
    cum_total_money: number;
    cum_wwsd_bb: number;
    cum_wwsd_money: number;
    cum_wsd_bb: number;
    cum_wsd_money: number;
    cum_ev_bb?: number;
    cum_ev_money?: number;
    compliance_rate?: number;
  }>,
): H2nPerfPoint[] {
  return curve.map((p) => ({
    hand_index: p.hand_index,
    net_bb: p.cum_total_bb,
    net_money: p.cum_total_money,
    aiev_bb: p.cum_ev_bb ?? p.cum_total_bb,
    aiev_money: p.cum_ev_money ?? p.cum_total_money,
    wwsd_bb: p.cum_wwsd_bb,
    wwsd_money: p.cum_wwsd_money,
    wsd_bb: p.cum_wsd_bb,
    wsd_money: p.cum_wsd_money,
    compliance_rate: p.compliance_rate ?? 100,
  }));
}
