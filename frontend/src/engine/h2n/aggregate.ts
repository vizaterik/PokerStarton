import type {
  H2nActionMatrices,
  H2nOverallSummary,
  H2nParsedHand,
  H2nPositionalStats,
  H2nReport,
  H2nStat,
  H2nStreetAggression,
} from "./types";

const CORE_POSITIONS = ["UTG", "MP", "CO", "BTN", "SB", "BB"] as const;

function stat(cases: number, opportunities: number): H2nStat {
  return {
    cases,
    opportunities,
    pct: opportunities > 0 ? (100 * cases) / opportunities : null,
  };
}

function normPos(p: string | null | undefined): string {
  const u = (p || "").toUpperCase();
  if (u === "BU" || u === "BTN") return "BTN";
  if (u === "HJ" || u === "MP1") return "MP";
  if (u.startsWith("UTG")) return "UTG";
  if (CORE_POSITIONS.includes(u as (typeof CORE_POSITIONS)[number])) return u;
  return u || "UNK";
}

function winrateBb100(profitBb: number, hands: number): number | null {
  if (hands <= 0) return null;
  return (profitBb / hands) * 100;
}

type Acc = {
  hands: number;
  profitMoney: number;
  profitBb: number;
  stackBbSum: number;
  stackBbN: number;
  rake: number;
  vpip: number;
  vpipOpp: number;
  pfr: number;
  pfrOpp: number;
  three: number;
  threeOpp: number;
  four: number;
  fourOpp: number;
  f3: number;
  f3Opp: number;
  rfi: number;
  rfiOpp: number;
  limp: number;
  limpOpp: number;
  limpFold: number;
  limpCall: number;
  ats: number;
  atsOpp: number;
  foldBbSteal: number;
  foldBbStealOpp: number;
  wtsd: number;
  wtsdOpp: number;
  wsd: number;
  wsdOpp: number;
  wwsf: number;
  wwsfOpp: number;
  cbet: number;
  cbetOpp: number;
  foldCbet: number;
  foldCbetOpp: number;
  pfBets: number;
  pfRaises: number;
  pfCalls: number;
};

function emptyAcc(): Acc {
  return {
    hands: 0,
    profitMoney: 0,
    profitBb: 0,
    stackBbSum: 0,
    stackBbN: 0,
    rake: 0,
    vpip: 0,
    vpipOpp: 0,
    pfr: 0,
    pfrOpp: 0,
    three: 0,
    threeOpp: 0,
    four: 0,
    fourOpp: 0,
    f3: 0,
    f3Opp: 0,
    rfi: 0,
    rfiOpp: 0,
    limp: 0,
    limpOpp: 0,
    limpFold: 0,
    limpCall: 0,
    ats: 0,
    atsOpp: 0,
    foldBbSteal: 0,
    foldBbStealOpp: 0,
    wtsd: 0,
    wtsdOpp: 0,
    wsd: 0,
    wsdOpp: 0,
    wwsf: 0,
    wwsfOpp: 0,
    cbet: 0,
    cbetOpp: 0,
    foldCbet: 0,
    foldCbetOpp: 0,
    pfBets: 0,
    pfRaises: 0,
    pfCalls: 0,
  };
}

function addHand(acc: Acc, h: H2nParsedHand): void {
  acc.hands += 1;
  acc.profitMoney += h.hero_net ?? 0;
  acc.profitBb += h.hero_net_bb ?? 0;
  if (h.stack_bb != null) {
    acc.stackBbSum += h.stack_bb;
    acc.stackBbN += 1;
  }
  acc.rake += h.rake ?? 0;

  if (h.vpip_opp) {
    acc.vpipOpp += 1;
    if (h.vpip) acc.vpip += 1;
  }
  if (h.pfr_opp) {
    acc.pfrOpp += 1;
    if (h.pfr) acc.pfr += 1;
  }
  if (h.three_bet_opp) {
    acc.threeOpp += 1;
    if (h.three_bet) acc.three += 1;
  }
  if (h.four_bet_opp) {
    acc.fourOpp += 1;
    if (h.four_bet) acc.four += 1;
  }
  if (h.fold_to_3bet_opp) {
    acc.f3Opp += 1;
    if (h.fold_to_3bet) acc.f3 += 1;
  }
  if (h.rfi_opp) {
    acc.rfiOpp += 1;
    if (h.did_rfi) acc.rfi += 1;
  }
  if (h.limp_opp) {
    acc.limpOpp += 1;
    if (h.did_limp) acc.limp += 1;
  }
  if (h.did_limp) {
    if (h.limp_fold) acc.limpFold += 1;
    if (h.limp_call) acc.limpCall += 1;
  }
  if (h.ats_opp) {
    acc.atsOpp += 1;
    if (h.ats) acc.ats += 1;
  }
  if (h.fold_bb_steal_opp) {
    acc.foldBbStealOpp += 1;
    if (h.fold_bb_steal) acc.foldBbSteal += 1;
  }

  // WTSD opp ≈ saw flop
  if (h.saw_flop) {
    acc.wtsdOpp += 1;
    if (h.went_to_showdown) acc.wtsd += 1;
    acc.wwsfOpp += 1;
    if (h.won_when_saw_flop) acc.wwsf += 1;
  }
  if (h.went_to_showdown) {
    acc.wsdOpp += 1;
    if (h.won_at_showdown) acc.wsd += 1;
  }
  if (h.cbet_opp) {
    acc.cbetOpp += 1;
    if (h.cbet) acc.cbet += 1;
  }
  if (h.fold_to_cbet_opp) {
    acc.foldCbetOpp += 1;
    if (h.fold_to_cbet) acc.foldCbet += 1;
  }
  acc.pfBets += h.postflop_bets;
  acc.pfRaises += h.postflop_raises;
  acc.pfCalls += h.postflop_calls;
}

function toOverall(acc: Acc): H2nOverallSummary {
  return {
    hands: acc.hands,
    total_profit: { money: acc.profitMoney, bb: acc.profitBb },
    winrate_bb100: winrateBb100(acc.profitBb, acc.hands),
    vpip: stat(acc.vpip, acc.vpipOpp),
    pfr: stat(acc.pfr, acc.pfrOpp),
    three_bet: stat(acc.three, acc.threeOpp),
    four_bet: stat(acc.four, acc.fourOpp),
    fold_to_3bet: stat(acc.f3, acc.f3Opp),
    ats: stat(acc.ats, acc.atsOpp),
    wtsd: stat(acc.wtsd, acc.wtsdOpp),
    wsd: stat(acc.wsd, acc.wsdOpp),
    wwsf: stat(acc.wwsf, acc.wwsfOpp),
    avg_stack_bb: acc.stackBbN > 0 ? acc.stackBbSum / acc.stackBbN : null,
    total_rake: acc.rake,
  };
}

function toPositional(pos: string, acc: Acc): H2nPositionalStats {
  return {
    position: pos,
    hands: acc.hands,
    profit: { money: acc.profitMoney, bb: acc.profitBb },
    winrate_bb100: winrateBb100(acc.profitBb, acc.hands),
    vpip: stat(acc.vpip, acc.vpipOpp),
    pfr: stat(acc.pfr, acc.pfrOpp),
    three_bet: stat(acc.three, acc.threeOpp),
    four_bet: stat(acc.four, acc.fourOpp),
    fold_to_3bet: stat(acc.f3, acc.f3Opp),
    rfi: stat(acc.rfi, acc.rfiOpp),
    limp: stat(acc.limp, acc.limpOpp),
    limp_fold: stat(acc.limpFold, acc.limp),
    limp_call: stat(acc.limpCall, acc.limp),
    steal: stat(acc.ats, acc.atsOpp),
    fold_bb_vs_steal: stat(acc.foldBbSteal, acc.foldBbStealOpp),
  };
}

function afqStat(acc: Acc): H2nStat {
  const opp = acc.pfBets + acc.pfRaises + acc.pfCalls;
  const cases = acc.pfBets + acc.pfRaises;
  return stat(cases, opp);
}

function streetStub(
  street: H2nStreetAggression["street"],
  acc: Acc,
): H2nStreetAggression {
  return {
    street,
    afq: street === "flop" ? afqStat(acc) : stat(0, 0),
    cbet: street === "flop" ? stat(acc.cbet, acc.cbetOpp) : stat(0, 0),
    fold_to_cbet:
      street === "flop" ? stat(acc.foldCbet, acc.foldCbetOpp) : stat(0, 0),
    raise_cbet: stat(0, 0),
    call_cbet: stat(0, 0),
    donk: stat(0, 0),
    check_raise: stat(0, 0),
  };
}

function detectRoom(hands: H2nParsedHand[]): H2nReport["meta"]["room_hint"] {
  const sample = hands[0]?.raw_text || "";
  if (/PokerStars/i.test(sample)) return "pokerstars";
  if (/GGPoker|Poker Hand #HD/i.test(sample)) return "gg";
  return "unknown";
}

export function aggregateH2nReport(
  hands: H2nParsedHand[],
  opts: {
    failed?: number;
    sourceFiles?: string[];
    includeHands?: boolean;
  } = {},
): H2nReport {
  const overallAcc = emptyAcc();
  const byPos = new Map<string, Acc>();
  for (const p of CORE_POSITIONS) byPos.set(p, emptyAcc());

  for (const h of hands) {
    addHand(overallAcc, h);
    const pos = normPos(h.hero_position);
    if (!byPos.has(pos)) byPos.set(pos, emptyAcc());
    addHand(byPos.get(pos)!, h);
  }

  const by_position: H2nPositionalStats[] = CORE_POSITIONS.map((p) =>
    toPositional(p, byPos.get(p) || emptyAcc()),
  );
  // Include any non-core seats seen
  for (const [p, acc] of byPos) {
    if (!(CORE_POSITIONS as readonly string[]).includes(p) && acc.hands > 0) {
      by_position.push(toPositional(p, acc));
    }
  }

  const rfi_by_position: Record<string, H2nStat> = {};
  const limp_fold_by_position: Record<string, H2nStat> = {};
  const limp_call_by_position: Record<string, H2nStat> = {};
  const three_bet_by_position: Record<string, H2nStat> = {};
  const fold_to_3bet_by_position: Record<string, H2nStat> = {};

  for (const row of by_position) {
    rfi_by_position[row.position] = row.rfi;
    limp_fold_by_position[row.position] = row.limp_fold;
    limp_call_by_position[row.position] = row.limp_call;
    three_bet_by_position[row.position] = row.three_bet;
    fold_to_3bet_by_position[row.position] = row.fold_to_3bet;
  }

  const action_matrices: H2nActionMatrices = {
    rfi_by_position,
    limp_fold_by_position,
    limp_call_by_position,
    three_bet_by_position,
    fold_to_3bet_by_position,
    streets: [
      streetStub("flop", overallAcc),
      streetStub("turn", overallAcc),
      streetStub("river", overallAcc),
    ],
  };

  const report: H2nReport = {
    meta: {
      generated_at: new Date().toISOString(),
      hands_parsed: hands.length,
      hands_failed: opts.failed ?? 0,
      source_files: opts.sourceFiles ?? [],
      room_hint: detectRoom(hands),
    },
    overall: toOverall(overallAcc),
    by_position,
    action_matrices,
  };
  if (opts.includeHands) report.hands = hands;
  return report;
}
