export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

export type HandCode = string;

export type CellFreq = {
  raise_freq: number;
  call_freq: number;
  fold_freq: number;
};

export type Brush = "raise" | "call" | "fold";

export const FREQ_PRESETS = [100, 75, 50, 25, 0] as const;

export function handCodeAt(row: number, col: number): HandCode {
  const r1 = RANKS[row];
  const r2 = RANKS[col];
  if (row === col) return `${r1}${r2}`;
  if (row < col) return `${r1}${r2}s`;
  return `${r2}${r1}o`;
}

export function buildEmptyMatrix(): Record<HandCode, CellFreq> {
  const out: Record<HandCode, CellFreq> = {};
  for (let row = 0; row < 13; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      out[handCodeAt(row, col)] = { raise_freq: 0, call_freq: 0, fold_freq: 1 };
    }
  }
  return out;
}

export function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

/** Build a valid strategy that sums to 1. Fold fills the remainder. */
export function makeFreq(raisePct: number, callPct: number): CellFreq {
  let r = clamp01(raisePct / 100);
  let c = clamp01(callPct / 100);
  if (r + c > 1) {
    const scale = 1 / (r + c);
    r *= scale;
    c *= scale;
  }
  const f = Math.max(0, 1 - r - c);
  return {
    raise_freq: round4(r),
    call_freq: round4(c),
    fold_freq: round4(f),
  };
}

export function brushToFreq(brush: Brush, weightPct = 100): CellFreq {
  const w = clamp01(weightPct / 100);
  if (brush === "raise") return makeFreq(w * 100, 0);
  if (brush === "call") return makeFreq(0, w * 100);
  return { raise_freq: 0, call_freq: 0, fold_freq: 1 };
}

export function freqsEqual(a: CellFreq, b: CellFreq, eps = 0.015) {
  return (
    Math.abs(a.raise_freq - b.raise_freq) < eps &&
    Math.abs(a.call_freq - b.call_freq) < eps &&
    Math.abs(a.fold_freq - b.fold_freq) < eps
  );
}

export function cellMatchesBrush(cell: CellFreq, brush: Brush, weightPct = 100): boolean {
  return freqsEqual(cell, brushToFreq(brush, weightPct));
}

export function dominantAction(cell: CellFreq): "raise" | "call" | "fold" | "mixed" {
  const { raise_freq: r, call_freq: c, fold_freq: f } = cell;
  const max = Math.max(r, c, f);
  const winners = [
    r === max ? "raise" : null,
    c === max ? "call" : null,
    f === max ? "fold" : null,
  ].filter(Boolean) as Array<"raise" | "call" | "fold">;
  if (winners.length !== 1 || max < 0.999) {
    if (max >= 0.999) return winners[0];
    return "mixed";
  }
  return winners[0];
}

export function cellBackground(cell: CellFreq): string {
  const { raise_freq: r, call_freq: c, fold_freq: f } = cell;
  if (r >= 0.999) return "var(--raise)";
  if (c >= 0.999) return "var(--call)";
  if (f >= 0.999) return "rgba(55, 78, 130, 0.45)";
  const rp = r * 100;
  const cp = (r + c) * 100;
  return `linear-gradient(90deg, var(--raise) 0% ${rp}%, var(--call) ${rp}% ${cp}%, rgba(55,78,130,0.55) ${cp}% 100%)`;
}

export function comboWeight(handCode: string): number {
  if (handCode.length === 2) return 6;
  if (handCode.endsWith("s")) return 4;
  return 12;
}

export type RangeStats = {
  playPct: number;
  raisePct: number;
  callPct: number;
  foldPct: number;
  raiseCombos: number;
  callCombos: number;
  foldCombos: number;
};

export function computeRangeStats(cells: Record<string, CellFreq>): RangeStats {
  let raiseCombos = 0;
  let callCombos = 0;
  let foldCombos = 0;
  for (let row = 0; row < 13; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      const code = handCodeAt(row, col);
      const w = comboWeight(code);
      const cell = cells[code] ?? { raise_freq: 0, call_freq: 0, fold_freq: 1 };
      raiseCombos += w * cell.raise_freq;
      callCombos += w * cell.call_freq;
      foldCombos += w * cell.fold_freq;
    }
  }
  const total = 1326;
  return {
    playPct: ((raiseCombos + callCombos) / total) * 100,
    raisePct: (raiseCombos / total) * 100,
    callPct: (callCombos / total) * 100,
    foldPct: (foldCombos / total) * 100,
    raiseCombos,
    callCombos,
    foldCombos,
  };
}

export function formatPct(n: number, digits = 0) {
  return `${n.toFixed(digits)}%`;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
