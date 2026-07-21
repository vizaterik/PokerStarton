/**
 * RegEx-based Hand History parser engine (H2N pipeline).
 *
 * Splits multi-hand dumps, parses via parseHh, classifies preflop lines,
 * and aggregates into an H2nReport. Safe for Worker / chunked main-thread use.
 */

import { computeHudFlags } from "../hudFlags";
import { parseHandHistory, splitHandBlocks } from "../parseHh";
import type { ParsedHand } from "../types";
import type {
  H2nParsedHand,
  H2nParseProgress,
  H2nReport,
  H2nTableSize,
} from "./types";
import { aggregateH2nReport } from "./aggregate";

const RE_RAKE_PS =
  /Total\s+pot\s+[^\n|]*\|\s*Rake\s+([$€£]?\s*[\d,.]+)/i;
const RE_RAKE_GG =
  /(?:Rake|Total\s+Rake)\s*[:=]?\s*([$€£]?\s*[\d,.]+)/i;
const RE_SHOWN =
  /^Seat\s+\d+:\s+([^\s(]+).*?\b(?:showed|mucked)\s+\[([2-9TJQKA][shdc]\s+[2-9TJQKA][shdc])\]/gim;
const RE_HAND_ID =
  /(?:PokerStars|GGPoker|Poker\s*Hand)\s*(?:Hand\s*)?#([A-Za-z0-9:-]+)/i;

const STEAL_POS = new Set(["CO", "BTN", "SB"]);

function parseMoneyToken(raw: string): number | null {
  const cleaned = raw.replace(/[$€£\s]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function extractRake(raw: string): number | null {
  const m = raw.match(RE_RAKE_PS) || raw.match(RE_RAKE_GG);
  if (!m) return null;
  return parseMoneyToken(m[1] ?? "");
}

export function extractShownCards(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  RE_SHOWN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_SHOWN.exec(raw)) !== null) {
    const name = (m[1] || "").trim();
    const cards = (m[2] || "").replace(/\s+/g, " ").trim();
    if (name && cards) out[name] = cards;
  }
  return out;
}

export function extractHandId(raw: string): string | null {
  const m = raw.match(RE_HAND_ID);
  return m?.[1] ? String(m[1]) : null;
}

export type PreflopLine =
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

/**
 * Classify hero's first voluntary preflop decision + limp continuations.
 * Opportunity counting for VPIP/PFR/3bet/etc. comes from computeHudFlags.
 */
export function classifyPreflopLine(hand: ParsedHand): {
  preflop_line: PreflopLine;
  hero_preflop_action: "fold" | "call" | "raise" | null;
  did_rfi: boolean;
  rfi_opp: boolean;
  did_limp: boolean;
  limp_opp: boolean;
  limp_fold: boolean;
  limp_call: boolean;
} {
  const preflop = hand.actions.filter((a) => a.street === "preflop");
  let raisesBefore = 0;
  let limpsBefore = 0;
  let callsAfterRaise = 0;
  let heroActed = false;
  let did_rfi = false;
  let rfi_opp = false;
  let did_limp = false;
  let limp_opp = false;
  let limp_fold = false;
  let limp_call = false;
  let preflop_line: PreflopLine = null;
  let hero_preflop_action: "fold" | "call" | "raise" | null = null;
  let heroOpenRaised = false;
  let faced3bet = false;

  for (const act of preflop) {
    if (act.is_hero) {
      if (!heroActed) {
        heroActed = true;
        if (raisesBefore === 0 && limpsBefore === 0) {
          rfi_opp = true;
          limp_opp = true;
        }

        if (act.action === "raise") {
          hero_preflop_action = "raise";
          if (raisesBefore === 0 && limpsBefore === 0) {
            did_rfi = true;
            heroOpenRaised = true;
            preflop_line = "rfi";
          } else if (raisesBefore === 0 && limpsBefore > 0) {
            preflop_line = "iso";
          } else if (raisesBefore === 1) {
            preflop_line =
              callsAfterRaise >= 1 ? "squeeze" : "three_bet";
          } else {
            preflop_line = "four_bet";
          }
        } else if (act.action === "call" && (act.amount ?? 0) > 0) {
          hero_preflop_action = "call";
          if (raisesBefore === 0) {
            did_limp = true;
            preflop_line = "limp";
          } else {
            preflop_line = "cold_call";
          }
        } else if (act.action === "fold") {
          hero_preflop_action = "fold";
          if (raisesBefore === 0) preflop_line = "other";
          else if (raisesBefore === 1) preflop_line = "fold_vs_open";
          else if (raisesBefore === 2) preflop_line = "fold_vs_3bet";
          else preflop_line = "fold_vs_4bet";
        }
      } else {
        // Continuations: limp-fold / limp-call; fold vs 3bet line label
        if (did_limp) {
          if (act.action === "fold") limp_fold = true;
          else if (act.action === "call" || act.action === "raise") limp_call = true;
        }
        if (heroOpenRaised && faced3bet && act.action === "fold") {
          preflop_line = "fold_vs_3bet";
        }
        if (heroOpenRaised && faced3bet && act.action === "raise") {
          preflop_line = "four_bet";
        }
      }
      continue;
    }

    if (act.action === "raise") {
      raisesBefore += 1;
      callsAfterRaise = 0;
      if (heroOpenRaised) faced3bet = true;
    } else if (act.action === "call" && (act.amount ?? 0) > 0) {
      if (raisesBefore === 0) limpsBefore += 1;
      else callsAfterRaise += 1;
    }
  }

  // Prefer parser spot when present
  const spot = (hand.detected_spot || "").toLowerCase();
  if (spot === "rfi" && did_rfi) preflop_line = "rfi";
  if (spot === "iso") preflop_line = "iso";
  if (spot === "squeeze") preflop_line = "squeeze";

  void STEAL_POS;
  return {
    preflop_line,
    hero_preflop_action,
    did_rfi,
    rfi_opp,
    did_limp,
    limp_opp,
    limp_fold,
    limp_call,
  };
}

export function enrichParsedHand(hand: ParsedHand): H2nParsedHand {
  const flags = hand.flags ?? computeHudFlags(hand);
  const line = classifyPreflopLine(hand);
  const rake = extractRake(hand.raw_text || "");
  const shown = extractShownCards(hand.raw_text || "");

  return {
    external_hand_id: hand.external_hand_id,
    played_at: hand.played_at,
    table_name: hand.table_name,
    table_max: (hand.table_max ?? null) as H2nTableSize | number | null,
    button_seat: hand.button_seat,
    small_blind: hand.small_blind,
    big_blind: hand.big_blind,
    rake,
    hero_name: hand.hero_name,
    hero_position: hand.hero_position,
    hero_hand: hand.hero_hand,
    shown_cards: shown,
    stack_bb: hand.stack_bb,
    hero_net: hand.hero_net,
    hero_net_bb: hand.hero_net_bb,
    preflop_line: line.preflop_line,
    hero_preflop_action: line.hero_preflop_action,
    did_rfi: line.did_rfi,
    rfi_opp: line.rfi_opp,
    did_limp: line.did_limp,
    limp_opp: line.limp_opp,
    limp_fold: line.limp_fold,
    limp_call: line.limp_call,
    vpip: flags.vpip,
    vpip_opp: flags.vpip_opp,
    pfr: flags.pfr,
    pfr_opp: flags.pfr_opp,
    three_bet: flags.three_bet,
    three_bet_opp: flags.three_bet_opp,
    four_bet: flags.four_bet,
    four_bet_opp: flags.four_bet_opp,
    fold_to_3bet: flags.fold_to_3bet,
    fold_to_3bet_opp: flags.fold_to_3bet_opp,
    ats: flags.ats,
    ats_opp: flags.ats_opp,
    fold_bb_steal: flags.fold_bb_steal,
    fold_bb_steal_opp: flags.fold_bb_steal_opp,
    saw_flop: flags.saw_flop,
    cbet: flags.cbet,
    cbet_opp: flags.cbet_opp,
    fold_to_cbet: flags.fold_to_cbet,
    fold_to_cbet_opp: flags.fold_to_cbet_opp,
    went_to_showdown: flags.went_to_showdown,
    won_at_showdown: flags.won_at_showdown,
    won_when_saw_flop: flags.won_when_saw_flop,
    postflop_bets: flags.postflop_bets,
    postflop_raises: flags.postflop_raises,
    postflop_calls: flags.postflop_calls,
    raw_text: hand.raw_text,
  };
}

/** @deprecated Use classifyPreflopLine; kept for API stability during rollout. */
export function classifyPreflop(hand: ParsedHand) {
  return classifyPreflopLine(hand);
}

export type HhParserEngineOptions = {
  onProgress?: (p: H2nParseProgress) => void;
  includeHands?: boolean;
  sourceFiles?: string[];
};

/**
 * Production entry: ingest raw HH text → typed H2N report.
 */
export class HhParserEngine {
  private opts: HhParserEngineOptions;

  constructor(opts: HhParserEngineOptions = {}) {
    this.opts = opts;
  }

  split(rawText: string): string[] {
    return splitHandBlocks(rawText);
  }

  /** Parse a single hand block → H2nParsedHand (null if unparseable). */
  parseOne(block: string): H2nParsedHand | null {
    const trimmed = block.trim();
    if (!trimmed) return null;
    try {
      const parsed = parseHandHistory(trimmed);
      const hand = parsed[0];
      if (!hand) return null;
      return enrichParsedHand(hand);
    } catch {
      return null;
    }
  }

  parseBatch(
    files: Array<{ name?: string; text: string }>,
    chunkSize = 200,
  ): { hands: H2nParsedHand[]; failed: number } {
    const onProgress = this.opts.onProgress;
    const allBlocks: string[] = [];
    for (const f of files) {
      allBlocks.push(...this.split(f.text));
    }
    onProgress?.({
      done: 0,
      total: allBlocks.length,
      phase: "split",
      message: `Split ${allBlocks.length} hands`,
    });

    const hands: H2nParsedHand[] = [];
    let failed = 0;
    for (let i = 0; i < allBlocks.length; i += chunkSize) {
      const slice = allBlocks.slice(i, i + chunkSize);
      for (const block of slice) {
        const h = this.parseOne(block);
        if (h) hands.push(h);
        else failed += 1;
      }
      onProgress?.({
        done: Math.min(i + chunkSize, allBlocks.length),
        total: allBlocks.length,
        phase: "parse",
        message: `Parsed ${Math.min(i + chunkSize, allBlocks.length)}/${allBlocks.length}`,
      });
    }
    return { hands, failed };
  }

  analyze(
    files: Array<{ name?: string; text: string }>,
    chunkSize = 200,
  ): H2nReport {
    const { hands, failed } = this.parseBatch(files, chunkSize);
    this.opts.onProgress?.({
      done: hands.length,
      total: hands.length,
      phase: "aggregate",
      message: "Aggregating H2N report",
    });
    const report = aggregateH2nReport(hands, {
      failed,
      sourceFiles: this.opts.sourceFiles ?? files.map((f) => f.name || "paste"),
      includeHands: this.opts.includeHands,
    });
    this.opts.onProgress?.({
      done: hands.length,
      total: hands.length,
      phase: "done",
      message: "Done",
    });
    return report;
  }

  async analyzeAsync(
    files: Array<{ name?: string; text: string }>,
    chunkSize = 100,
  ): Promise<H2nReport> {
    const allBlocks: string[] = [];
    for (const f of files) allBlocks.push(...this.split(f.text));
    const hands: H2nParsedHand[] = [];
    let failed = 0;
    for (let i = 0; i < allBlocks.length; i += chunkSize) {
      const slice = allBlocks.slice(i, i + chunkSize);
      for (const block of slice) {
        const h = this.parseOne(block);
        if (h) hands.push(h);
        else failed += 1;
      }
      this.opts.onProgress?.({
        done: Math.min(i + chunkSize, allBlocks.length),
        total: allBlocks.length,
        phase: "parse",
        message: `Parsed ${Math.min(i + chunkSize, allBlocks.length)}/${allBlocks.length}`,
      });
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    return aggregateH2nReport(hands, {
      failed,
      sourceFiles: this.opts.sourceFiles ?? files.map((f) => f.name || "paste"),
      includeHands: this.opts.includeHands,
    });
  }
}
