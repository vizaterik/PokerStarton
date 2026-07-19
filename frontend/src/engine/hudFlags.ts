/**
 * H2N-style per-hand HUD flags (port of backend hud_stats._analyze_hand).
 */

import type { ParsedHand } from "./types";

const STEAL_POS = new Set(["CO", "BTN", "SB"]);

export type HudFlags = {
  vpip: boolean;
  vpip_opp: boolean;
  pfr: boolean;
  pfr_opp: boolean;
  three_bet: boolean;
  three_bet_opp: boolean;
  fold_to_3bet: boolean;
  fold_to_3bet_opp: boolean;
  four_bet: boolean;
  four_bet_opp: boolean;
  ats: boolean;
  ats_opp: boolean;
  fold_bb_steal: boolean;
  fold_bb_steal_opp: boolean;
  limp: boolean;
  saw_flop: boolean;
  cbet: boolean;
  cbet_opp: boolean;
  fold_to_cbet: boolean;
  fold_to_cbet_opp: boolean;
  postflop_bets: number;
  postflop_raises: number;
  postflop_calls: number;
  went_to_showdown: boolean;
  won_at_showdown: boolean;
  won_when_saw_flop: boolean;
};

function moneyCall(action: string, amount: number | null): boolean {
  return action === "call" && amount != null && amount > 0;
}

export function computeHudFlags(
  hand: Pick<
    ParsedHand,
    | "actions"
    | "hero_name"
    | "hero_position"
    | "villain_position"
    | "went_to_showdown"
    | "hero_net"
    | "hero_net_wsd"
  >,
): HudFlags {
  const flags: HudFlags = {
    vpip: false,
    vpip_opp: false,
    pfr: false,
    pfr_opp: false,
    three_bet: false,
    three_bet_opp: false,
    fold_to_3bet: false,
    fold_to_3bet_opp: false,
    four_bet: false,
    four_bet_opp: false,
    ats: false,
    ats_opp: false,
    fold_bb_steal: false,
    fold_bb_steal_opp: false,
    limp: false,
    saw_flop: false,
    cbet: false,
    cbet_opp: false,
    fold_to_cbet: false,
    fold_to_cbet_opp: false,
    postflop_bets: 0,
    postflop_raises: 0,
    postflop_calls: 0,
    went_to_showdown: hand.went_to_showdown,
    won_at_showdown: false,
    won_when_saw_flop: false,
  };

  const preflop = hand.actions.filter((a) => a.street === "preflop");
  const flop = hand.actions.filter((a) => a.street === "flop");
  const postflop = hand.actions.filter((a) =>
    ["flop", "turn", "river"].includes(a.street),
  );
  flags.saw_flop = flop.length > 0 || postflop.some((a) => a.street === "flop");

  const heroName = (hand.hero_name || "Hero").toLowerCase();
  let raisesBefore = 0;
  let limpsBefore = 0;
  let openerName: string | null = null;
  let heroActed = false;
  let heroFoldedPre = false;
  let heroOpenRaised = false;
  let faced3bet = false;

  for (const act of preflop) {
    if (act.is_hero) {
      if (heroFoldedPre) continue;
      if (!heroActed) {
        heroActed = true;
        const pos = (hand.hero_position || "").toUpperCase();
        flags.vpip_opp = true;
        flags.pfr_opp = true;

        if (act.action === "raise") {
          flags.vpip = true;
          flags.pfr = true;
          if (raisesBefore === 0) heroOpenRaised = true;
          else if (raisesBefore === 1) flags.three_bet = true;
          else if (raisesBefore >= 2) flags.four_bet = true;
        } else if (moneyCall(act.action, act.amount)) {
          flags.vpip = true;
          if (raisesBefore === 0) flags.limp = true;
        } else if (act.action === "fold") {
          heroFoldedPre = true;
        }

        if (raisesBefore === 1) flags.three_bet_opp = true;
        if (raisesBefore >= 2) flags.four_bet_opp = true;

        if (raisesBefore === 0 && limpsBefore === 0 && STEAL_POS.has(pos)) {
          flags.ats_opp = true;
          if (act.action === "raise") flags.ats = true;
        }

        if (
          pos === "BB" &&
          raisesBefore === 1 &&
          limpsBefore === 0 &&
          openerName
        ) {
          const openPos = (hand.villain_position || "").toUpperCase();
          if (STEAL_POS.has(openPos)) {
            flags.fold_bb_steal_opp = true;
            if (act.action === "fold") flags.fold_bb_steal = true;
          }
        }
      } else {
        if (heroOpenRaised && faced3bet) {
          flags.fold_to_3bet_opp = true;
          flags.four_bet_opp = true;
          if (act.action === "fold") {
            flags.fold_to_3bet = true;
            heroFoldedPre = true;
          } else if (act.action === "raise") {
            flags.four_bet = true;
          }
        } else if (act.action === "fold") {
          heroFoldedPre = true;
        }
      }
      continue;
    }

    if (act.action === "raise") {
      raisesBefore += 1;
      if (raisesBefore === 1) openerName = act.player_name;
      if (heroOpenRaised && !faced3bet) faced3bet = true;
    } else if (moneyCall(act.action, act.amount) && raisesBefore === 0) {
      limpsBefore += 1;
    }
  }

  if (heroOpenRaised && faced3bet) {
    flags.fold_to_3bet_opp = true;
    flags.four_bet_opp = true;
  }
  if (!heroActed && preflop.length) {
    flags.vpip_opp = true;
    flags.pfr_opp = true;
  }

  let lastPfAggressor: string | null = null;
  for (const act of preflop) {
    if (act.action === "raise") lastPfAggressor = act.player_name;
  }

  if (
    lastPfAggressor &&
    lastPfAggressor.toLowerCase() === heroName &&
    flags.saw_flop &&
    !heroFoldedPre
  ) {
    let priorAgg = false;
    for (const act of flop) {
      if (act.is_hero) {
        if (!priorAgg) {
          flags.cbet_opp = true;
          if (act.action === "raise") flags.cbet = true;
        }
        break;
      }
      if (act.action === "raise") priorAgg = true;
    }
  }

  if (
    lastPfAggressor &&
    lastPfAggressor.toLowerCase() !== heroName &&
    flags.saw_flop &&
    !heroFoldedPre
  ) {
    const pfa = lastPfAggressor.toLowerCase();
    let seenAgg = false;
    for (const act of flop) {
      const actor = (act.player_name || "").toLowerCase();
      if (!seenAgg) {
        if (act.action === "raise") {
          if (actor === pfa) {
            seenAgg = true;
            flags.fold_to_cbet_opp = true;
          } else break;
        }
        continue;
      }
      if (act.is_hero) {
        if (act.action === "fold") flags.fold_to_cbet = true;
        break;
      }
    }
  }

  for (const act of postflop) {
    if (!act.is_hero) continue;
    if (act.action === "raise") {
      const prior = postflop.filter(
        (a) =>
          a.street === act.street &&
          a.action_order < act.action_order &&
          a.action === "raise",
      );
      if (prior.length) flags.postflop_raises += 1;
      else flags.postflop_bets += 1;
    } else if (moneyCall(act.action, act.amount)) {
      flags.postflop_calls += 1;
    }
  }

  const net = hand.hero_net ?? 0;
  if (flags.saw_flop && net > 0) flags.won_when_saw_flop = true;
  if (flags.went_to_showdown && (hand.hero_net_wsd ?? 0) > 0) {
    flags.won_at_showdown = true;
  } else if (flags.went_to_showdown && net > 0) {
    flags.won_at_showdown = true;
  }

  return flags;
}

export function mergeFlagsIntoHand(hand: ParsedHand): ParsedHand {
  const f = computeHudFlags(hand);
  return {
    ...hand,
    vpip: f.vpip,
    pfr: f.pfr,
    three_bet: f.three_bet,
    three_bet_opp: f.three_bet_opp,
    flags: f,
  };
}
