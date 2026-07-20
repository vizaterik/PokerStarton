export type SpotKey =
  | "rfi"
  | "limp"
  | "iso"
  | "vs_open"
  | "multiway"
  | "vs_3bet"
  | "vs_4bet"
  | "squeeze";

export type Position =
  | "UTG"
  | "UTG+1"
  | "MP"
  | "HJ"
  | "CO"
  | "BTN"
  | "SB"
  | "BB";

export type ActionFreq = {
  raise_freq: number;
  call_freq: number;
  fold_freq: number;
};

export const POSITIONS: Position[] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

export const SPOT_OPTIONS: { key: SpotKey; label: string }[] = [
  { key: "rfi", label: "RFI" },
  { key: "limp", label: "Limp" },
  { key: "iso", label: "ISO" },
  { key: "vs_open", label: "vs Open" },
  { key: "multiway", label: "Multiway" },
  { key: "vs_3bet", label: "vs 3-Bet" },
  { key: "vs_4bet", label: "vs 4-Bet" },
  { key: "squeeze", label: "Squeeze" },
];

/** Spots where a per-villain chart makes sense (defense / vs raise). */
export const VILLAIN_SCOPED_SPOTS: SpotKey[] = [
  "limp",
  "iso",
  "vs_open",
  "multiway",
  "vs_3bet",
  "vs_4bet",
  "squeeze",
];

export function spotSupportsVillain(spotKey: SpotKey): boolean {
  return VILLAIN_SCOPED_SPOTS.includes(spotKey);
}

export function villainChoicesFor(hero: Position): Position[] {
  return POSITIONS.filter((p) => p !== hero);
}

export function spotChartLabel(
  spotKey: SpotKey,
  hero: Position,
  villain: Position | null = null,
): string {
  const action =
    (
      {
        rfi: "RFI",
        limp: "Limp",
        iso: "ISO",
        vs_open: "vs Open",
        multiway: "Multiway",
        vs_3bet: "vs 3-Bet",
        vs_4bet: "vs 4-Bet",
        squeeze: "Squeeze",
      } as Record<SpotKey, string>
    )[spotKey] ?? spotKey;
  if (villain) return `${action} ${hero}vs${villain}`;
  return `${action} ${hero}`;
}

export type StrategySpot = {
  id: string;
  strategy_id: string;
  spot_key: string;
  hero_position: string;
  villain_position: string | null;
  stack_bb_min: string | null;
  stack_bb_max: string | null;
  label: string | null;
  sort_order: number;
};

export type StrategyCell = {
  id: string;
  spot_id: string;
  hand_code: string;
  raise_freq: string | number;
  call_freq: string | number;
  fold_freq: string | number;
};
