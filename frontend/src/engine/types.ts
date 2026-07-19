/** Shared types for client-side HH parse + local analysis. */

export type ParsedAction = {
  street: string;
  action_order: number;
  player_name: string;
  is_hero: boolean;
  action: string;
  amount: number | null;
};

export type ParsedSeat = {
  seat: number;
  name: string;
  stack: number;
};

export type ParsedHand = {
  external_hand_id: string;
  raw_text: string;
  played_at: string | null;
  table_name: string | null;
  table_max: number | null;
  button_seat: number | null;
  small_blind: number | null;
  big_blind: number | null;
  hero_name: string | null;
  hero_position: string | null;
  hero_hand: string | null;
  hero_hand_code: string | null;
  detected_spot: string | null;
  villain_position: string | null;
  stack_bb: number | null;
  hero_preflop_action: string | null;
  hero_net: number | null;
  hero_net_bb: number | null;
  went_to_showdown: boolean;
  hero_net_wsd: number | null;
  hero_net_wsd_bb: number | null;
  hero_net_wwsd: number | null;
  hero_net_wwsd_bb: number | null;
  /** All seated players (needed for Trainer table even when hero acts first). */
  seats: ParsedSeat[];
  actions: ParsedAction[];
  /** HUD flags computed after parse */
  vpip: boolean;
  pfr: boolean;
  three_bet: boolean;
  three_bet_opp: boolean;
  /** Full H2N flag set (optional for older rows) */
  flags?: import("./hudFlags").HudFlags;
};

export type LocalImportResult = {
  strategyId: string;
  /** Newly written into IndexedDB */
  handsInserted: number;
  /** Already present in IndexedDB (same external_hand_id) */
  duplicatesSkipped: number;
  /** Successfully parsed from files (inserted + duplicates) */
  handsParsed: number;
  sessionId: string;
  /** @deprecated use handsParsed / handsInserted */
  hands: number;
};

export type ProgressPayload = {
  done: number;
  total: number;
  phase: string;
  message: string;
  pct: number;
};
