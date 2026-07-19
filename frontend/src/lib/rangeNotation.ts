import { buildEmptyMatrix, CellFreq, comboWeight, HandCode, RANKS } from "./handMatrix";

const RANK_I = Object.fromEntries(RANKS.map((r, i) => [r, i])) as Record<string, number>;

const HAND_RE = /^[2-9TJQKA]{2}[SO]?$/i;
const PAIR_RE = /^[2-9TJQKA]{2}$/i;
const SUITED_RE = /^([2-9TJQKA])([2-9TJQKA])([SO])$/i;

export type ParsePokerRangeResult = {
  ok: boolean;
  hands: string[];
  error: string | null;
};

function normHand(code: string): HandCode | null {
  const u = code.toUpperCase();
  if (PAIR_RE.test(u) && u[0] === u[1]) return u;
  const m = u.match(SUITED_RE);
  if (!m) return null;
  const i1 = RANK_I[m[1]];
  const i2 = RANK_I[m[2]];
  if (i1 === i2) return null;
  const hi = i1 < i2 ? m[1] : m[2];
  const lo = i1 < i2 ? m[2] : m[1];
  return `${hi}${lo}${m[3].toLowerCase()}`;
}

function allHandCodes(): HandCode[] {
  const out: HandCode[] = [];
  for (let r = 0; r < 13; r += 1) {
    for (let c = 0; c < 13; c += 1) {
      const a = RANKS[r];
      const b = RANKS[c];
      if (r === c) out.push(`${a}${b}`);
      else if (r < c) out.push(`${a}${b}s`);
      else out.push(`${b}${a}o`);
    }
  }
  return out;
}

const ALL_HANDS = allHandCodes();

/** Expand poker range tokens like "22+", "ATs+", "KQo", "22-99", "54s-98s". */
export function expandRange(spec: string): HandCode[] {
  return parsePokerRange(spec);
}

/**
 * Parse a comma-separated poker range formula into canonical hand codes.
 * Supports: 22+, ATo+, KQs+, 54s-98s, AA, KK, AKs, and combinations.
 */
export function parsePokerRange(text: string): string[] {
  return parsePokerRangeDetailed(text).hands;
}

export function parsePokerRangeDetailed(text: string): ParsePokerRangeResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, hands: [], error: null };

  const out = new Set<HandCode>();
  const parts = trimmed
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const token = part.toUpperCase().replace(/\s+/g, "");
    if (!token) continue;
    try {
      const expanded = expandToken(token);
      if (expanded.length === 0) {
        return {
          ok: false,
          hands: [...out],
          error: `Не понял токен «${part}»`,
        };
      }
      for (const h of expanded) out.add(h);
    } catch {
      return { ok: false, hands: [...out], error: `Ошибка в «${part}»` };
    }
  }

  return { ok: true, hands: [...out], error: null };
}

function expandToken(token: string): HandCode[] {
  if (token.includes("-")) {
    const dash = token.indexOf("-");
    const left = token.slice(0, dash);
    const right = token.slice(dash + 1);
    if (left && right) return expandDash(left, right);
  }

  const plus = token.endsWith("+");
  const raw = plus ? token.slice(0, -1) : token;

  // Pairs: 22, 77+
  if (PAIR_RE.test(raw) && raw[0] === raw[1]) {
    const start = RANK_I[raw[0]];
    if (start == null) return [];
    if (!plus) return [raw];
    // 22+ → 22..AA (lower index = higher rank in RANKS)
    return RANKS.filter((_, i) => i <= start).map((r) => `${r}${r}`);
  }

  // Suited / offsuit: AKs, ATo, A2s+, KTo+
  const m = raw.match(SUITED_RE);
  if (!m) {
    // bare unpaired without s/o is invalid
    if (HAND_RE.test(raw)) return [];
    return [];
  }

  let iHi = RANK_I[m[1]];
  let iLo = RANK_I[m[2]];
  const suited = m[3].toLowerCase() as "s" | "o";
  if (iHi === iLo) return [];
  if (iHi > iLo) [iHi, iLo] = [iLo, iHi];
  const better = RANKS[iHi];

  if (!plus) return [`${better}${RANKS[iLo]}${suited}`];

  // ATo+ → ATo, AJo, AQo, AKo (kickers from T up to just below A)
  const codes: HandCode[] = [];
  for (let j = iLo; j > iHi; j -= 1) {
    codes.push(`${better}${RANKS[j]}${suited}`);
  }
  return codes;
}

function expandDash(left: string, right: string): HandCode[] {
  // Pairs: 22-99
  if (
    PAIR_RE.test(left) &&
    left[0] === left[1] &&
    PAIR_RE.test(right) &&
    right[0] === right[1]
  ) {
    const a = RANK_I[left[0]];
    const b = RANK_I[right[0]];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return RANKS.filter((_, i) => i >= lo && i <= hi).map((r) => `${r}${r}`);
  }

  const ml = left.match(SUITED_RE);
  const mr = right.match(SUITED_RE);
  if (!ml || !mr) return [...expandToken(left), ...expandToken(right)];

  const suitedL = ml[3].toLowerCase();
  const suitedR = mr[3].toLowerCase();
  if (suitedL !== suitedR) return [...expandToken(left), ...expandToken(right)];
  const suited = suitedL as "s" | "o";

  let lHi = RANK_I[ml[1]];
  let lLo = RANK_I[ml[2]];
  if (lHi > lLo) [lHi, lLo] = [lLo, lHi];
  let rHi = RANK_I[mr[1]];
  let rLo = RANK_I[mr[2]];
  if (rHi > rLo) [rHi, rLo] = [rLo, rHi];

  // Same broadway: A2s-AJs
  if (lHi === rHi) {
    const better = RANKS[lHi];
    const from = Math.max(lLo, rLo);
    const to = Math.min(lLo, rLo);
    const codes: HandCode[] = [];
    for (let j = from; j >= to; j -= 1) {
      if (j === lHi) continue;
      codes.push(`${better}${RANKS[j]}${suited}`);
    }
    return codes;
  }

  // Connectors / gappers with same gap: 54s-98s, 75o-T9o
  const gapL = lLo - lHi;
  const gapR = rLo - rHi;
  if (gapL !== gapR || gapL < 1) {
    return [...expandToken(left), ...expandToken(right)];
  }

  const startHi = Math.max(lHi, rHi);
  const endHi = Math.min(lHi, rHi);
  const codes: HandCode[] = [];
  for (let hi = startHi; hi >= endHi; hi -= 1) {
    const lo = hi + gapL;
    if (lo > 12) continue;
    codes.push(`${RANKS[hi]}${RANKS[lo]}${suited}`);
  }
  return codes;
}

/** Parse "ATs:25, KQo:40" → map hand → raise weight 0..1 */
export function expandWeighted(spec: string): Map<HandCode, number> {
  const out = new Map<HandCode, number>();
  const parts = spec
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const [token, weightRaw] = part.split(":");
    if (!token) continue;
    const weight = weightRaw != null ? Math.min(1, Math.max(0, Number(weightRaw) / 100)) : 0.5;
    if (Number.isNaN(weight)) continue;
    for (const code of expandRange(token)) out.set(code, weight);
  }
  return out;
}

export type RangeBuildSpec = {
  raise?: string;
  call?: string;
  /** Raise/fold mixes: "A5s:25, 76s:40" */
  raiseFold?: string;
  /** Raise/call mixes: "99:50, AQs:35" */
  raiseCall?: string;
};

export function matrixFromRanges(
  raiseSpec: string | RangeBuildSpec,
  callSpec = "",
): Record<HandCode, CellFreq> {
  const spec: RangeBuildSpec =
    typeof raiseSpec === "string" ? { raise: raiseSpec, call: callSpec } : raiseSpec;

  const matrix = buildEmptyMatrix();
  const raiseHands = new Set(expandRange(spec.raise ?? ""));
  const callHands = new Set(expandRange(spec.call ?? ""));
  const raiseFold = expandWeighted(spec.raiseFold ?? "");
  const raiseCall = expandWeighted(spec.raiseCall ?? "");

  for (const code of raiseHands) {
    matrix[code] = { raise_freq: 1, call_freq: 0, fold_freq: 0 };
  }
  for (const code of callHands) {
    if (raiseHands.has(code)) {
      matrix[code] = { raise_freq: 0.5, call_freq: 0.5, fold_freq: 0 };
    } else {
      matrix[code] = { raise_freq: 0, call_freq: 1, fold_freq: 0 };
    }
  }
  for (const [code, w] of raiseCall) {
    matrix[code] = {
      raise_freq: round4(w),
      call_freq: round4(1 - w),
      fold_freq: 0,
    };
  }
  for (const [code, w] of raiseFold) {
    matrix[code] = {
      raise_freq: round4(w),
      call_freq: 0,
      fold_freq: round4(1 - w),
    };
  }
  return matrix;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

export function matrixToPayload(matrix: Record<HandCode, CellFreq>) {
  return Object.entries(matrix).map(([hand_code, freq]) => ({
    hand_code,
    raise_freq: freq.raise_freq,
    call_freq: freq.call_freq,
    fold_freq: freq.fold_freq,
  }));
}

export function countRangeCombos(hands: Iterable<string>): number {
  let n = 0;
  for (const h of hands) n += comboWeight(h);
  return n;
}

export function rangeComboSummary(hands: string[]): { combos: number; pct: number } {
  const combos = countRangeCombos(hands);
  return { combos, pct: (combos / 1326) * 100 };
}

/**
 * Compress a set of hands into the shortest poker-range notation.
 * Prefer 22+, ATs+, 54s-98s over long enumerations.
 */
export function compressRange(hands: Iterable<string>): string {
  const set = new Set<string>();
  for (const h of hands) {
    const n = normHand(h) ?? (PAIR_RE.test(h.toUpperCase()) ? h.toUpperCase() : null);
    if (n) set.add(n);
  }
  if (set.size === 0) return "";

  const tokens: string[] = [];
  const remaining = new Set(set);

  // —— Pairs ——
  const pairOn = RANKS.map((r) => remaining.has(`${r}${r}`));
  for (const t of compressRuns(pairOn, (i) => `${RANKS[i]}${RANKS[i]}`, true)) {
    tokens.push(t);
    for (const h of expandRange(t)) remaining.delete(h);
  }

  // —— Connectors / gappers first (so 54s-98s beats a pile of singles) ——
  const connectorTokens = compressConnectors([...remaining]);
  for (const t of connectorTokens) {
    tokens.push(t);
    for (const h of expandRange(t)) remaining.delete(h);
  }

  // —— Suited / offsuit by high card (ATs+, KQo, …) ——
  for (const suited of ["s", "o"] as const) {
    for (let hi = 0; hi < 12; hi += 1) {
      const flags = Array.from({ length: 13 }, () => false);
      for (let lo = hi + 1; lo < 13; lo += 1) {
        const code = `${RANKS[hi]}${RANKS[lo]}${suited}`;
        if (remaining.has(code)) flags[lo] = true;
      }
      for (const t of compressRuns(
        flags,
        (lo) => `${RANKS[hi]}${RANKS[lo]}${suited}`,
        false,
        hi,
      )) {
        tokens.push(t);
        for (const h of expandRange(t)) remaining.delete(h);
      }
    }
  }

  const still = [...remaining].sort((a, b) => handSortKey(a) - handSortKey(b));
  tokens.push(...still);

  return finalizeTokens(tokens);
}

function handSortKey(code: string): number {
  if (code.length === 2) return RANK_I[code[0]] * 100;
  const hi = RANK_I[code[0]];
  const lo = RANK_I[code[1]];
  const suited = code.endsWith("s") ? 0 : 50;
  return hi * 100 + lo + suited;
}

/**
 * Compress boolean flags indexed by rank index into notation tokens.
 * For pairs: index = pair rank. For broadway: index = kicker rank, floorHi = high card index.
 */
function compressRuns(
  flags: boolean[],
  labelAt: (i: number) => string,
  isPair: boolean,
  floorHi = -1,
): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < flags.length) {
    if (!flags[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < flags.length && flags[j + 1]) j += 1;

    // For broadway kickers, "on" runs go toward better cards (lower index).
    // We scan low→high index; for + we need runs that reach the best possible kicker (floorHi+1).
    if (isPair) {
      // pairs: index 0=AA ... 12=22. Run from i..j (AA side to 22 side).
      // If run starts at AA (0): emit `${RANKS[j]}${RANKS[j]}+` e.g. 22+ or 77+
      if (i === 0) {
        tokens.push(j === 0 ? "AA" : `${RANKS[j]}${RANKS[j]}+`);
      } else if (i === j) {
        tokens.push(labelAt(i));
      } else {
        tokens.push(`${labelAt(j)}-${labelAt(i)}`);
      }
    } else {
      // kickers: lower index = better kicker. Run i..j where i is best in run.
      const bestPossible = floorHi + 1;
      if (i === bestPossible) {
        // reaches top → X+
        tokens.push(j === i ? labelAt(i) : `${labelAt(j)}+`);
      } else if (i === j) {
        tokens.push(labelAt(i));
      } else {
        tokens.push(`${labelAt(j)}-${labelAt(i)}`);
      }
    }

    // mark consumed conceptually by advancing
    i = j + 1;
  }
  return tokens;
}

function compressConnectors(hands: string[]): string[] {
  const byKey = new Map<string, number[]>(); // key = `${suited}:${gap}` → hi ranks present
  for (const h of hands) {
    if (h.length < 3) continue;
    const hi = RANK_I[h[0]];
    const lo = RANK_I[h[1]];
    const suited = h[2];
    const gap = lo - hi;
    if (gap < 1) continue;
    const key = `${suited}:${gap}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(hi);
  }

  const tokens: string[] = [];
  for (const [key, his] of byKey) {
    const [suited, gapStr] = key.split(":");
    const gap = Number(gapStr);
    const uniq = [...new Set(his)].sort((a, b) => a - b); // AA-side first
    let i = 0;
    while (i < uniq.length) {
      let j = i;
      while (j + 1 < uniq.length && uniq[j + 1] === uniq[j] + 1) j += 1;
      const hiStart = uniq[i];
      const hiEnd = uniq[j];
      const loStart = hiStart + gap;
      const loEnd = hiEnd + gap;
      if (loStart > 12 || loEnd > 12) {
        i = j + 1;
        continue;
      }
      if (i === j) {
        // single — leave for leftover enumeration
        i = j + 1;
        continue;
      }
      // Keep AK/KQ for broadway compression (AKs, KQs+), not connector dashes.
      if (hiStart <= RANK_I.K) {
        i = j + 1;
        continue;
      }
      const a = `${RANKS[hiEnd]}${RANKS[loEnd]}${suited}`;
      const b = `${RANKS[hiStart]}${RANKS[loStart]}${suited}`;
      // notation low-high in connector sense: 54s-98s
      tokens.push(`${a}-${b}`);
      i = j + 1;
    }
  }
  return tokens;
}

function finalizeTokens(tokens: string[]): string {
  // Drop empties; prefer unique expansion order
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const t of tokens) {
    if (!t) continue;
    const hands = expandRange(t);
    if (hands.length === 0) continue;
    // skip if fully redundant
    if (hands.every((h) => seen.has(h))) continue;
    for (const h of hands) seen.add(h);
    kept.push(t);
  }
  return kept.join(", ");
}

/** Hands currently "in range" from a frequency matrix (raise or call weight). */
export function handsFromMatrix(
  cells: Record<string, CellFreq>,
  threshold = 0.5,
): string[] {
  return ALL_HANDS.filter((code) => {
    const c = cells[code];
    if (!c) return false;
    return c.raise_freq + c.call_freq >= threshold;
  });
}

/** Build a raise/fold matrix from a selected hand set. */
export function matrixFromHandSet(hands: Iterable<string>): Record<HandCode, CellFreq> {
  const selected = new Set(
    [...hands].map((h) => normHand(h) ?? h.toUpperCase()).filter(Boolean),
  );
  const matrix = buildEmptyMatrix();
  for (const code of ALL_HANDS) {
    if (selected.has(code)) {
      matrix[code] = { raise_freq: 1, call_freq: 0, fold_freq: 0 };
    }
  }
  return matrix;
}
