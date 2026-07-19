/** Monotone cubic Hermite (Fritsch–Carlson) SVG path through points. */

export function monotonePath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M ${points[0].x} ${points[0].y}`;
  if (n === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const dx: number[] = [];
  const dy: number[] = [];
  const m: number[] = [];

  for (let i = 0; i < n - 1; i += 1) {
    dx.push(xs[i + 1] - xs[i]);
    dy.push(ys[i + 1] - ys[i]);
    m.push(dy[i] / (dx[i] || 1e-9));
  }

  const slopes = new Array<number>(n);
  slopes[0] = m[0];
  slopes[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (m[i - 1] * m[i] <= 0) slopes[i] = 0;
    else slopes[i] = (m[i - 1] + m[i]) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (Math.abs(m[i]) < 1e-12) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
    } else {
      const a = slopes[i] / m[i];
      const b = slopes[i + 1] / m[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        slopes[i] = t * a * m[i];
        slopes[i + 1] = t * b * m[i];
      }
    }
  }

  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx[i];
    const x1 = xs[i] + h / 3;
    const y1 = ys[i] + (slopes[i] * h) / 3;
    const x2 = xs[i + 1] - h / 3;
    const y2 = ys[i + 1] - (slopes[i + 1] * h) / 3;
    d += ` C ${x1} ${y1}, ${x2} ${y2}, ${xs[i + 1]} ${ys[i + 1]}`;
  }
  return d;
}

export function areaPath(
  points: { x: number; y: number }[],
  baselineY: number,
): string {
  if (points.length === 0) return "";
  const line = monotonePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
}
