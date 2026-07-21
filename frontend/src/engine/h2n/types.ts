/**
 * Hand2Note-style analytics report schema.
 * Positions use the same seat labels as the HH parser (UTG / MP / CO / BTN / SB / BB).
 */

export type H2nPosition =
  | "UTG"
  | "UTG+1"
  | "UTG+2"
  | "MP"
  | "MP1"
  | "HJ"
  | "CO"
  | "BTN"
  | "SB"
  | "BB";

export type H2nTableSize = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type H2nStreet = "preflop" | "flop" | "turn" | "river";

/** Cases / opportunities → frequency (0–100) or null when no sample. */
export type H2nStat = {
  cases: number;
  opportunities: number;
  /** Percent 0–100, null if opportunities === 0. */
  pct: number | null;
};

export type H2nMoneyPair = {
  money: number;
  bb: number;
};

export type H2nOverallSummary = {
  hands: number;
  total_profit: H2nMoneyPair;
  winrate_bb100: number | null;
  vpip: H2nStat;
  pfr: H2nStat;
  three_bet: H2nStat;
  four_bet: H2nStat;
  fold_to_3bet: H2nStat;
  ats: H2nStat;
  wtsd: H2nStat;
  wsd: H2nStat;
  wwsf: H2nStat;
  /** Average effective stack in BB at hand start (hero). */
  avg_stack_bb: number | null;
  /** Total rake extracted from summaries (currency units). */
  total_rake: number;
};

export type H2nPositionalStats = {
  position: H2nPosition | string;
  hands: number;
  profit: H2nMoneyPair;
  winrate_bb100: number | null;
  vpip: H2nStat;
  pfr: H2nStat;
  three_bet: H2nStat;
  four_bet: H2nStat;
  fold_to_3bet: H2nStat;
  /** Raise first in when no one entered pot. */
  rfi: H2nStat;
  limp: H2nStat;
  limp_fold: H2nStat;
  limp_call: H2nStat;
  steal: H2nStat;
  fold_bb_vs_steal: H2nStat;
};

export type H2nStreetAggression = {
  street: Exclude<H2nStreet, "preflop">;
  /** (bets + raises) / (bets + raises + calls) when postflop aggression opportunities exist. */
  afq: H2nStat;
  cbet: H2nStat;
  fold_to_cbet: H2nStat;
  raise_cbet: H2nStat;
  call_cbet: H2nStat;
  donk: H2nStat;
  check_raise: H2nStat;
};

export type H2nActionMatrices = {
  /** RFI % by hero position. */
  rfi_by_position: Record<string, H2nStat>;
  limp_fold_by_position: Record<string, H2nStat>;
  limp_call_by_position: Record<string, H2nStat>;
  three_bet_by_position: Record<string, H2nStat>;
  fold_to_3bet_by_position: Record<string, H2nStat>;
  streets: H2nStreetAggression[];
};

/** One fully extracted hand for the H2N pipeline (hero-centric). */
export type H2nParsedHand = {
  external_hand_id: string;
  played_at: string | null;
  table_name: string | null;
  table_max: H2nTableSize | number | null;
  button_seat: number | null;
  small_blind: number | null;
  big_blind: number | null;
  rake: number | null;
  hero_name: string | null;
  hero_position: string | null;
  hero_hand: string | null;
  /** Villain hole cards shown at showdown (name → "As Kd"). */
  shown_cards: Record<string, string>;
  stack_bb: number | null;
  hero_net: number | null;
  hero_net_bb: number | null;
  /** Preflop line classification for hero's voluntary decision. */
  preflop_line:
    | "rfi"
    | "limp"
    | "iso"
    | "cold_call"
    | "three_bet"
    | "four_bet"
    | "squeeze"
    | "fold_vs_open"
    | "fold_vs_3bet"
    | "fold_vs_4bet"
    | "other"
    | null;
  hero_preflop_action: "fold" | "call" | "raise" | null;
  /** True when hero open-raised as first voluntary in (RFI opportunity taken). */
  did_rfi: boolean;
  rfi_opp: boolean;
  did_limp: boolean;
  limp_opp: boolean;
  limp_fold: boolean;
  limp_call: boolean;
  vpip: boolean;
  vpip_opp: boolean;
  pfr: boolean;
  pfr_opp: boolean;
  three_bet: boolean;
  three_bet_opp: boolean;
  four_bet: boolean;
  four_bet_opp: boolean;
  fold_to_3bet: boolean;
  fold_to_3bet_opp: boolean;
  ats: boolean;
  ats_opp: boolean;
  fold_bb_steal: boolean;
  fold_bb_steal_opp: boolean;
  saw_flop: boolean;
  cbet: boolean;
  cbet_opp: boolean;
  fold_to_cbet: boolean;
  fold_to_cbet_opp: boolean;
  went_to_showdown: boolean;
  won_at_showdown: boolean;
  won_when_saw_flop: boolean;
  postflop_bets: number;
  postflop_raises: number;
  postflop_calls: number;
  raw_text: string;
};

export type H2nReportMeta = {
  generated_at: string;
  hands_parsed: number;
  hands_failed: number;
  source_files: string[];
  room_hint: "pokerstars" | "gg" | "unknown";
};

/** Unified Hand2Note-style report payload. */
export type H2nReport = {
  meta: H2nReportMeta;
  overall: H2nOverallSummary;
  by_position: H2nPositionalStats[];
  action_matrices: H2nActionMatrices;
  /** Optional raw per-hand extract for debugging / further aggregation. */
  hands?: H2nParsedHand[];
};

export type H2nParseProgress = {
  done: number;
  total: number;
  phase: "split" | "parse" | "aggregate" | "done";
  message: string;
};
