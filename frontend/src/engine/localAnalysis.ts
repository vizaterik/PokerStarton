/**
 * Build full StrategyAnalysis + StrategyDeviationsResponse from local hands
 * using the same formulas as the server (HUD + chart compare).
 */

import {
  getStrategy,
  listCells,
  listSpots,
  type AnalysisCurvePoint,
  type ChartErrorSpot,
  type HudStat,
  type PositionHudRow,
  type PreflopBranchAccuracy,
  type PreflopOpenBreakdown,
  type PreflopPositionOpenRow,
  type PreflopSpotAccuracy,
  type StrategyAnalysis,
  type StrategyCell,
  type StrategyDeviation,
  type StrategyDeviationsResponse,
  type StrategySpot,
} from "../api/client";
import {
  CHART_COMPARE_VER,
  peekAnalysisCache,
  writeAnalysisCache,
} from "../lib/analysisCache";
import {
  branchTag,
  spotPotKind,
  spotPotTag,
  treeMatchupLabel,
} from "../lib/branchLabel";
import { readChartsRevision } from "../lib/chartsRevision";
import {
  collectAnalysisBranches,
  potKindTag,
  type BranchPotKind,
} from "../lib/gameTree/branches";
import { loadTree } from "../lib/gameTree/persist";
import { ensureConstructorChartsSynced } from "../lib/gameTree/syncTreeCharts";
import {
  constructorTagKey,
  groupChartErrorsByTreeBranches,
  normalizeChartPos,
  spotCoveredByBranches,
} from "../lib/spotCoverage";
import type { HudFlags } from "./hudFlags";
import { listHandsForStrategy, type HandRow } from "./localDb";
import { clearLocalRecommendationsCache } from "./localRecommendations";
import type { ProgressPayload } from "./types";

const SPOT_ORDER = ["rfi", "vs_open", "vs_3bet", "vs_4bet", "squeeze", "iso"];
const POS_ORDER = ["UTG", "UTG+1", "UTG+2", "MP", "HJ", "CO", "BTN", "SB", "BB"];
const EPS = 0.005;

function pct(cases: number, opps: number): number | null {
  if (opps <= 0) return null;
  return Math.round((1000 * cases) / opps) / 10;
}

function ratio(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 100) / 100;
}

function flagsOf(h: HandRow): HudFlags {
  if (h.flags) return h.flags;
  return {
    vpip: !!h.vpip,
    vpip_opp: true,
    pfr: !!h.pfr,
    pfr_opp: true,
    three_bet: !!h.three_bet,
    three_bet_opp: !!h.three_bet_opp,
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
    went_to_showdown: h.went_to_showdown,
    won_at_showdown: false,
    won_when_saw_flop: false,
  };
}

function isInPlayRange(raiseF: number, callF: number): boolean {
  return raiseF >= EPS || callF >= EPS;
}

/** Same rule as backend deviation.is_deviation */
function isDeviation(actual: string, raiseF: number, callF: number, foldF: number): boolean {
  const inRange = isInPlayRange(raiseF, callF);
  if (actual === "raise" || actual === "call") return !inRange;
  if (actual === "fold") return foldF < EPS;
  return true;
}

function pickExpected(raiseF: number, callF: number, foldF: number): string {
  if (raiseF >= callF && raiseF >= foldF) return "raise";
  if (callF >= foldF) return "call";
  return "fold";
}

/** Fast spot lookup for large session scoring. */
function buildSpotIndex(spots: StrategySpot[]) {
  const exact = new Map<string, StrategySpot>();
  const opens = new Map<string, StrategySpot>();
  for (const s of spots) {
    const hero = normalizeChartPos(s.hero_position);
    const vill = s.villain_position ? normalizeChartPos(s.villain_position) : "";
    const g = `${s.spot_key}|${hero}`;
    exact.set(`${g}|${vill}`, s);
    // Open charts only — never use a generic facing chart as “all folds”.
    if ((s.spot_key === "rfi" || s.spot_key === "iso") && !vill && !opens.has(g)) {
      opens.set(g, s);
    }
  }
  return (hand: HandRow): StrategySpot | null => {
    if (!hand.detected_spot || !hand.hero_position) return null;
    const hero = normalizeChartPos(hand.hero_position);
    const vill = hand.villain_position
      ? normalizeChartPos(hand.villain_position)
      : "";
    const g = `${hand.detected_spot}|${hero}`;
    const hit = exact.get(`${g}|${vill}`);
    if (hit) return hit;
    if (hand.detected_spot === "rfi" || hand.detected_spot === "iso") {
      return opens.get(g) ?? null;
    }
    return null;
  };
}

function stat(
  key: string,
  label: string,
  cases: number,
  opportunities: number,
  unit: string = "pct",
): HudStat {
  return {
    key,
    label,
    value: unit === "pct" ? pct(cases, opportunities) : null,
    samples: opportunities,
    cases,
    opportunities,
    unit,
  };
}

type C = {
  hands: number;
  profit_bb: number;
  profit_money: number;
  vpip: number;
  vpip_opp: number;
  pfr: number;
  pfr_opp: number;
  three_bet: number;
  three_bet_opp: number;
  fold_to_3bet: number;
  fold_to_3bet_opp: number;
  four_bet: number;
  four_bet_opp: number;
  ats: number;
  ats_opp: number;
  fold_bb_steal: number;
  fold_bb_steal_opp: number;
  limp: number;
  saw_flop: number;
  cbet: number;
  cbet_opp: number;
  fold_to_cbet: number;
  fold_to_cbet_opp: number;
  bets: number;
  raises: number;
  calls: number;
  wtsd: number;
  wtsd_opp: number;
  wsd_won: number;
  wwsf: number;
  wwsf_opp: number;
};

function emptyC(): C {
  return {
    hands: 0,
    profit_bb: 0,
    profit_money: 0,
    vpip: 0,
    vpip_opp: 0,
    pfr: 0,
    pfr_opp: 0,
    three_bet: 0,
    three_bet_opp: 0,
    fold_to_3bet: 0,
    fold_to_3bet_opp: 0,
    four_bet: 0,
    four_bet_opp: 0,
    ats: 0,
    ats_opp: 0,
    fold_bb_steal: 0,
    fold_bb_steal_opp: 0,
    limp: 0,
    saw_flop: 0,
    cbet: 0,
    cbet_opp: 0,
    fold_to_cbet: 0,
    fold_to_cbet_opp: 0,
    bets: 0,
    raises: 0,
    calls: 0,
    wtsd: 0,
    wtsd_opp: 0,
    wsd_won: 0,
    wwsf: 0,
    wwsf_opp: 0,
  };
}

function apply(c: C, h: HandRow, f: HudFlags) {
  c.hands += 1;
  c.profit_bb += h.hero_net_bb ?? 0;
  c.profit_money += h.hero_net ?? 0;
  if (f.vpip_opp) c.vpip_opp += 1;
  if (f.vpip) c.vpip += 1;
  if (f.pfr_opp) c.pfr_opp += 1;
  if (f.pfr) c.pfr += 1;
  if (f.three_bet_opp) c.three_bet_opp += 1;
  if (f.three_bet) c.three_bet += 1;
  if (f.fold_to_3bet_opp) c.fold_to_3bet_opp += 1;
  if (f.fold_to_3bet) c.fold_to_3bet += 1;
  if (f.four_bet_opp) c.four_bet_opp += 1;
  if (f.four_bet) c.four_bet += 1;
  if (f.ats_opp) c.ats_opp += 1;
  if (f.ats) c.ats += 1;
  if (f.fold_bb_steal_opp) c.fold_bb_steal_opp += 1;
  if (f.fold_bb_steal) c.fold_bb_steal += 1;
  if (f.limp) c.limp += 1;
  if (f.saw_flop) {
    c.saw_flop += 1;
    c.wtsd_opp += 1;
    c.wwsf_opp += 1;
  }
  if (f.cbet_opp) c.cbet_opp += 1;
  if (f.cbet) c.cbet += 1;
  if (f.fold_to_cbet_opp) c.fold_to_cbet_opp += 1;
  if (f.fold_to_cbet) c.fold_to_cbet += 1;
  c.bets += f.postflop_bets;
  c.raises += f.postflop_raises;
  c.calls += f.postflop_calls;
  if (f.saw_flop && f.went_to_showdown) {
    c.wtsd += 1;
    if (f.won_at_showdown) c.wsd_won += 1;
  }
  if (f.won_when_saw_flop) c.wwsf += 1;
}

function countersToStats(c: C): HudStat[] {
  const afqDen = c.bets + c.raises + c.calls;
  const afStat: HudStat = {
    key: "af",
    label: "AF",
    value: ratio(c.bets + c.raises, c.calls),
    samples: afqDen,
    cases: c.bets + c.raises,
    opportunities: afqDen,
    unit: "ratio",
  };
  return [
    stat("vpip", "VPIP", c.vpip, c.vpip_opp || c.hands),
    stat("pfr", "PFR", c.pfr, c.pfr_opp || c.hands),
    stat("three_bet", "3-bet", c.three_bet, c.three_bet_opp),
    stat("fold_to_3bet", "Fold to 3-bet", c.fold_to_3bet, c.fold_to_3bet_opp),
    stat("four_bet", "4-bet", c.four_bet, c.four_bet_opp),
    stat("ats", "Steal", c.ats, c.ats_opp),
    stat("fold_bb_steal", "Fold BB to steal", c.fold_bb_steal, c.fold_bb_steal_opp),
    stat("limp", "Limp", c.limp, c.vpip_opp || c.hands),
    stat("cbet", "C-bet flop", c.cbet, c.cbet_opp),
    stat("fold_to_cbet", "Fold to C-bet", c.fold_to_cbet, c.fold_to_cbet_opp),
    afStat,
    stat("afq", "AFq", c.bets + c.raises, afqDen),
    stat("wtsd", "WTSD", c.wtsd, c.wtsd_opp),
    stat("wsd", "W$SD", c.wsd_won, c.wtsd),
    stat("wwsf", "WWSF", c.wwsf, c.wwsf_opp),
  ];
}

function buildAnalysis(strategyId: string, hands: HandRow[]): StrategyAnalysis {
  const total = emptyC();
  const byPosMap = new Map<string, C>();
  const curve: AnalysisCurvePoint[] = [];
  let cumBb = 0;
  let cumMoney = 0;
  let cumWsdBb = 0;
  let cumWwsdBb = 0;
  let cumWsdM = 0;
  let cumWwsdM = 0;
  let cumEvBb = 0;
  let cumEvM = 0;
  let compared = 0;
  let compliant = 0;

  const sorted = [...hands].sort((a, b) =>
    (a.played_at || "").localeCompare(b.played_at || ""),
  );

  sorted.forEach((h, i) => {
    const f = flagsOf(h);
    apply(total, h, f);
    const pos = (h.hero_position || "?").toUpperCase();
    let pc = byPosMap.get(pos);
    if (!pc) {
      pc = emptyC();
      byPosMap.set(pos, pc);
    }
    apply(pc, h, f);

    const netBb = h.hero_net_bb ?? 0;
    const netM = h.hero_net ?? 0;
    const wsdBb = h.hero_net_wsd_bb ?? (h.went_to_showdown ? netBb : 0);
    const wwsdBb = h.hero_net_wwsd_bb ?? (h.went_to_showdown ? 0 : netBb);
    const wsdM = h.hero_net_wsd ?? (h.went_to_showdown ? netM : 0);
    const wwsdM = h.hero_net_wwsd ?? (h.went_to_showdown ? 0 : netM);

    cumBb += netBb;
    cumMoney += netM;
    cumWsdBb += wsdBb;
    cumWwsdBb += wwsdBb;
    cumWsdM += wsdM;
    cumWwsdM += wwsdM;
    // All-In EV: without equity solver use realized net (same fallback as no-AI path)
    cumEvBb += netBb;
    cumEvM += netM;

    const n = sorted.length;
    if (n <= 2500 || i % Math.ceil(n / 2000) === 0 || i === n - 1) {
      const compliance = compared ? Math.round((10000 * compliant) / compared) / 100 : 100;
      curve.push({
        hand_index: i + 1,
        cum_total_bb: Math.round(cumBb * 10000) / 10000,
        cum_wwsd_bb: Math.round(cumWwsdBb * 10000) / 10000,
        cum_wsd_bb: Math.round(cumWsdBb * 10000) / 10000,
        cum_total_money: Math.round(cumMoney * 10000) / 10000,
        cum_wwsd_money: Math.round(cumWwsdM * 10000) / 10000,
        cum_wsd_money: Math.round(cumWsdM * 10000) / 10000,
        cum_ev_bb: Math.round(cumEvBb * 10000) / 10000,
        cum_ev_money: Math.round(cumEvM * 10000) / 10000,
        compliance_rate: compliance,
      });
    }
  });

  // compliance filled in deviations pass — leave curve rates; update after if needed
  void compared;
  void compliant;

  const n = total.hands;
  const by_position: PositionHudRow[] = [...byPosMap.entries()]
    .map(([position, r]) => ({
      position,
      hands: r.hands,
      vpip: pct(r.vpip, r.vpip_opp || r.hands),
      pfr: pct(r.pfr, r.pfr_opp || r.hands),
      three_bet: pct(r.three_bet, r.three_bet_opp),
      winrate_bb100: r.hands ? Math.round((r.profit_bb / r.hands) * 1000) / 10 : null,
      profit_bb: Math.round(r.profit_bb * 100) / 100,
    }))
    .sort((a, b) => {
      const ia = POS_ORDER.indexOf(a.position);
      const ib = POS_ORDER.indexOf(b.position);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return {
    strategy_id: strategyId,
    hands: n,
    winrate_bb100: n ? Math.round((total.profit_bb / n) * 1000) / 10 : null,
    total_profit_bb: Math.round(total.profit_bb * 100) / 100,
    total_profit_money: Math.round(total.profit_money * 100) / 100,
    stats: countersToStats(total),
    by_position,
    curve,
  };
}

/** Yield long enough for React to paint progress (Math tab pattern + rAF). */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function emptyDeviations(strategyId: string): StrategyDeviationsResponse {
  return {
    strategy_id: strategyId,
    total: 0,
    decisions: 0,
    correct: 0,
    correct_pct: 100,
    open_decisions: 0,
    open_correct: 0,
    open_pct: 100,
    play_decisions: 0,
    play_correct: 0,
    play_pct: 100,
    opens: {
      decisions: 0,
      opened: 0,
      folded: 0,
      called: 0,
      should_open: 0,
      opened_correct: 0,
      missed_opens: 0,
      should_fold: 0,
      folded_correct: 0,
      wrong_opens: 0,
      open_follow_pct: 100,
      fold_follow_pct: 100,
      accuracy_pct: 100,
    },
    by_spot: [],
    by_position: [],
    by_branch: [],
    chart_errors: [],
    deviations: [],
    leak_finder: {
      missed_profit_money: 0,
      critical_errors: 0,
      insights: [],
      heat: [],
    },
  };
}

async function buildDeviations(
  strategyId: string,
  hands: HandRow[],
  spots: StrategySpot[],
  onProgress?: (p: ProgressPayload) => void,
): Promise<StrategyDeviationsResponse> {
  // Spots are already synced from the constructor (orphans deleted).
  // No second branch filter here — that was zeroing out real strategies.
  if (!spots.length) {
    return emptyDeviations(strategyId);
  }

  const treeBranches = collectAnalysisBranches(loadTree(strategyId).root);

  const cellsBySpot = new Map<string, Map<string, StrategyCell>>();
  const BATCH = 8;
  const spotTotal = Math.max(1, spots.length);
  for (let i = 0; i < spots.length; i += BATCH) {
    const slice = spots.slice(i, i + BATCH);
    const loaded = await Promise.all(
      slice.map(async (spot) => {
        try {
          const cells = await listCells(spot.id);
          const painted = cells.some(
            (c) => Number(c.raise_freq) > 0 || Number(c.call_freq) > 0,
          );
          if (!painted) return null;
          const map = new Map<string, StrategyCell>();
          for (const c of cells) map.set(c.hand_code, c);
          return [spot.id, map] as const;
        } catch {
          return null;
        }
      }),
    );
    for (const row of loaded) {
      if (row) cellsBySpot.set(row[0], row[1]);
    }
    const doneSpots = Math.min(i + BATCH, spots.length);
    onProgress?.({
      done: 0,
      total: Math.max(1, hands.length),
      phase: "deviations",
      message: `Загружаем стратегию… ${doneSpots.toLocaleString("ru-RU")} / ${spotTotal.toLocaleString("ru-RU")}`,
      pct: Math.round((15 * doneSpots) / spotTotal),
    });
    await yieldToUi();
  }

  if (cellsBySpot.size === 0) {
    return emptyDeviations(strategyId);
  }

  let deviations: StrategyDeviation[] = [];
  let decisions = 0;
  let correct = 0;
  let openDec = 0;
  let openCor = 0;
  let playDec = 0;
  let playCor = 0;

  let rfiOpened = 0;
  let rfiFolded = 0;
  let rfiCalled = 0;
  let shouldOpen = 0;
  let openedCorrect = 0;
  let missedOpens = 0;
  let shouldFold = 0;
  let foldedCorrect = 0;
  let wrongOpens = 0;

  const spotStats = new Map<string, [number, number]>();
  const posStats = new Map<
    string,
    {
      decisions: number;
      opened: number;
      folded: number;
      called: number;
      should_open: number;
      opened_correct: number;
      missed_opens: number;
      should_fold: number;
      folded_correct: number;
      wrong_opens: number;
      correct: number;
    }
  >();
  const branchStats = new Map<string, [number, number, number, number]>();
  const chartMap = new Map<
    string,
    Map<
      string,
      {
        errors: number;
        raise: number;
        call: number;
        fold: number;
        actual: string;
        expected: string;
      }
    >
  >();
  const chartSpotIds = new Map<string, string>();

  const emptyPos = () => ({
    decisions: 0,
    opened: 0,
    folded: 0,
    called: 0,
    should_open: 0,
    opened_correct: 0,
    missed_opens: 0,
    should_fold: 0,
    folded_correct: 0,
    wrong_opens: 0,
    correct: 0,
  });

  const findSpot = buildSpotIndex(spots);
  const MAX_DEV_LIST = 300;
  /** Keep UI at ~60fps like Math tab — process until budget, then paint. */
  const FRAME_MS = 12;
  let deviantTotal = 0;
  let criticalTotal = 0;
  let missedEvTotal = 0;
  const totalHands = hands.length;
  let i = 0;
  while (i < totalHands) {
    const t0 = performance.now();
    while (i < totalHands && performance.now() - t0 < FRAME_MS) {
      const h = hands[i];
      i += 1;
      if (!h.hero_hand_code || !h.hero_preflop_action) continue;
      // Only constructor-synced spots (exact matchup). No chart cell → skip.
      const spot = findSpot(h);
      if (!spot) continue;
      const cellMap = cellsBySpot.get(spot.id);
      if (!cellMap) continue;
      const cell = cellMap.get(h.hero_hand_code);
      if (!cell) continue;

      const raiseF = Number(cell.raise_freq) || 0;
      const callF = Number(cell.call_freq) || 0;
      const foldF = Number(cell.fold_freq) || 0;
      const actual = h.hero_preflop_action;
      const deviant = isDeviation(actual, raiseF, callF, foldF);
      const expected = pickExpected(raiseF, callF, foldF);

      decisions += 1;
      const spotKey = spot.spot_key;
      const heroPos = spot.hero_position || h.hero_position || "?";
      // Aggregate by painted chart only — never invent branches from hand.villain.
      const villPos = spot.villain_position ?? null;
      const villKey = villPos || "";
      const branchKey = `${spotKey}|${heroPos}|${villKey}`;

      const ss = spotStats.get(spotKey) || [0, 0];
      ss[0] += 1;
      if (!deviant) ss[1] += 1;
      spotStats.set(spotKey, ss);

      const bs = branchStats.get(branchKey) || [0, 0, 0, 0];
      bs[0] += 1;
      bs[2] += h.hero_net ?? 0;
      bs[3] += h.hero_net_bb ?? 0;
      if (!deviant) bs[1] += 1;
      branchStats.set(branchKey, bs);

      if (!deviant) correct += 1;

      if (spotKey === "rfi") {
        openDec += 1;
        let ps = posStats.get(heroPos);
        if (!ps) {
          ps = emptyPos();
          posStats.set(heroPos, ps);
        }
        ps.decisions += 1;
        if (!deviant) {
          openCor += 1;
          ps.correct += 1;
        }
        if (actual === "raise") {
          rfiOpened += 1;
          ps.opened += 1;
        } else if (actual === "fold") {
          rfiFolded += 1;
          ps.folded += 1;
        } else {
          rfiCalled += 1;
          ps.called += 1;
        }
        const inRange = isInPlayRange(raiseF, callF);
        if (inRange) {
          shouldOpen += 1;
          ps.should_open += 1;
          if (actual === "raise" || actual === "call") {
            openedCorrect += 1;
            ps.opened_correct += 1;
          } else if (actual === "fold" && deviant) {
            missedOpens += 1;
            ps.missed_opens += 1;
          }
        } else {
          shouldFold += 1;
          ps.should_fold += 1;
          if (actual === "raise" || actual === "call") {
            wrongOpens += 1;
            ps.wrong_opens += 1;
          } else {
            foldedCorrect += 1;
            ps.folded_correct += 1;
          }
        }
      } else {
        playDec += 1;
        if (!deviant) playCor += 1;
      }

      if (!deviant) continue;

      deviantTotal += 1;
      chartSpotIds.set(branchKey, spot.id);
      let cmap = chartMap.get(branchKey);
      if (!cmap) {
        cmap = new Map();
        chartMap.set(branchKey, cmap);
      }
      let err = cmap.get(h.hero_hand_code);
      if (!err) {
        err = { errors: 0, raise: 0, call: 0, fold: 0, actual, expected };
        cmap.set(h.hero_hand_code, err);
      }
      err.errors += 1;
      if (actual === "raise" || actual === "call" || actual === "fold") err[actual] += 1;
      err.actual = actual;
      err.expected = expected;

      const freqs: Record<string, number> = { raise: raiseF, call: callF, fold: foldF };
      const actualFreq = freqs[actual] ?? 0;
      const expectedFreq = freqs[expected] ?? 0;
      const severity = Math.round(Math.abs(expectedFreq - actualFreq) * 1000) / 1000;
      if (severity >= 0.5) criticalTotal += 1;
      const missedEv =
        expected === "fold" && (actual === "call" || actual === "raise")
          ? actual === "raise"
            ? 2.5
            : 1
          : 0;
      missedEvTotal += missedEv;

      if (deviations.length >= MAX_DEV_LIST) continue;
      deviations.push({
        id: `local-${h.external_hand_id}`,
        hand_id: h.key,
        hand_code: h.hero_hand_code,
        actual_action: actual.toUpperCase(),
        expected_action: expected.toUpperCase(),
        actual_freq: actualFreq,
        expected_freq: expectedFreq,
        severity,
        spot_key: spotKey,
        spot_label: spot.label || spotKey,
        hero_position: heroPos,
        villain_position: villPos,
        external_hand_id: h.external_hand_id,
        played_at: h.played_at,
        hero_net_bb: h.hero_net_bb ?? 0,
        missed_ev_money: missedEv,
      });
    }

    // Always refresh counter each frame (Math tab style — no time throttle).
    onProgress?.({
      done: i,
      total: Math.max(1, totalHands),
      phase: "deviations",
      message: `Разбор сессии… ${i.toLocaleString("ru-RU")} / ${totalHands.toLocaleString("ru-RU")}`,
      pct: 20 + Math.round((70 * i) / Math.max(totalHands, 1)),
    });
    await yieldToUi();
  }

  onProgress?.({
    done: totalHands,
    total: Math.max(1, totalHands),
    phase: "deviations",
    message: "Собираем итоги…",
    pct: 92,
  });
  await yieldToUi();

  deviations.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));

  const by_spot: PreflopSpotAccuracy[] = SPOT_ORDER.filter((k) => spotStats.has(k)).map((k) => {
    const [dec, cor] = spotStats.get(k)!;
    return {
      spot_key: k,
      label: k,
      decisions: dec,
      correct: cor,
      correct_pct: dec ? Math.round((1000 * cor) / dec) / 10 : 100,
    };
  });

  const by_position: PreflopPositionOpenRow[] = [...posStats.entries()]
    .map(([position, ps]) => ({
      position,
      decisions: ps.decisions,
      opened: ps.opened,
      folded: ps.folded,
      called: ps.called,
      should_open: ps.should_open,
      opened_correct: ps.opened_correct,
      missed_opens: ps.missed_opens,
      should_fold: ps.should_fold,
      folded_correct: ps.folded_correct,
      wrong_opens: ps.wrong_opens,
      accuracy_pct: ps.decisions
        ? Math.round((1000 * ps.correct) / ps.decisions) / 10
        : 100,
    }))
    .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position));

  let by_branch: PreflopBranchAccuracy[] = [...branchStats.entries()].map(([key, bs]) => {
    const [spot_key, hero_position, villain_position] = key.split("|");
    const vill = villain_position || null;
    const [dec, cor, profitM, profitBb] = bs;
    return {
      spot_key,
      spot_label: branchTag(spot_key, hero_position, vill),
      hero_position,
      villain_position: vill,
      pot_kind: spotPotKind(spot_key),
      pot_tag: spotPotTag(spot_key),
      matchup: treeMatchupLabel(spot_key, hero_position, vill),
      decisions: dec,
      correct: cor,
      correct_pct: dec ? Math.round((1000 * cor) / dec) / 10 : 100,
      profit_money: Math.round(profitM * 100) / 100,
      profit_bb: Math.round(profitBb * 100) / 100,
      winrate_bb100: dec ? Math.round((profitBb / dec) * 1000) / 10 : undefined,
    };
  });

  let rawChartErrors: ChartErrorSpot[] = [...chartMap.entries()].map(([key, cmap]) => {
    const [spot_key, hero_position, villain_position] = key.split("|");
    const vill = villain_position || null;
    return {
      spot_key,
      hero_position,
      villain_position: vill,
      label: treeMatchupLabel(spot_key, hero_position, vill),
      spot_id: chartSpotIds.get(key) ?? null,
      cells: [...cmap.entries()].map(([hand_code, e]) => ({
        hand_code,
        errors: e.errors,
        raise_count: e.raise,
        call_count: e.call,
        fold_count: e.fold,
        actual_action: e.actual,
        expected_action: e.expected,
      })),
    };
  });

  // Report accuracy only for branches that exist in the strategy (constructor).
  // HH-only lines are not scored here — UI offers «Добавить в стратегию».
  if (treeBranches.length) {
    const coverOpts = { strictOpen: true, strictPot: true } as const;
    const branchAcc = new Map<string, PreflopBranchAccuracy>();
    for (const row of by_branch) {
      const spotLike = {
        spot_key: row.spot_key,
        hero_position: row.hero_position,
        villain_position: row.villain_position,
      };
      const sessionPot = spotPotKind(row.spot_key);
      const branch = treeBranches.find(
        (b) =>
          b.potKind === sessionPot &&
          spotCoveredByBranches(spotLike, [b], coverOpts),
      );
      if (!branch) continue;
      const mu = branch.label;
      const potKind: BranchPotKind = branch.potKind;
      const accKey = constructorTagKey(potKind, mu);
      const prev = branchAcc.get(accKey);
      if (!prev) {
        branchAcc.set(accKey, {
          ...row,
          matchup: mu,
          spot_label: mu,
          pot_kind: potKind,
          pot_tag: potKindTag(potKind),
        });
        continue;
      }
      const decisions = prev.decisions + row.decisions;
      const correct = prev.correct + row.correct;
      const profit_money = (prev.profit_money ?? 0) + (row.profit_money ?? 0);
      const profit_bb = (prev.profit_bb ?? 0) + (row.profit_bb ?? 0);
      branchAcc.set(accKey, {
        ...prev,
        decisions,
        correct,
        correct_pct: decisions ? Math.round((1000 * correct) / decisions) / 10 : 100,
        profit_money: Math.round(profit_money * 100) / 100,
        profit_bb: Math.round(profit_bb * 100) / 100,
        winrate_bb100: decisions
          ? Math.round((profit_bb / decisions) * 1000) / 10
          : undefined,
      });
    }
    by_branch = [...branchAcc.values()].sort(
      (a, b) => (b.decisions ?? 0) - (a.decisions ?? 0),
    );

    const grouped = groupChartErrorsByTreeBranches(
      rawChartErrors,
      treeBranches,
      coverOpts,
    );
    rawChartErrors = grouped.map((g) => ({
      ...g.primary,
      label: g.matchup,
      pot_kind: g.potKind,
      cells: g.cells,
    }));
  } else {
    by_branch = [];
    rawChartErrors = [];
  }

  const chart_errors = rawChartErrors;

  const opens: PreflopOpenBreakdown = {
    decisions: openDec,
    opened: rfiOpened,
    folded: rfiFolded,
    called: rfiCalled,
    should_open: shouldOpen,
    opened_correct: openedCorrect,
    missed_opens: missedOpens,
    should_fold: shouldFold,
    folded_correct: foldedCorrect,
    wrong_opens: wrongOpens,
    open_follow_pct: shouldOpen
      ? Math.round((1000 * openedCorrect) / shouldOpen) / 10
      : 100,
    fold_follow_pct: shouldFold
      ? Math.round((1000 * foldedCorrect) / shouldFold) / 10
      : 100,
    accuracy_pct: openDec ? Math.round((1000 * openCor) / openDec) / 10 : 100,
  };

  return {
    strategy_id: strategyId,
    total: Math.min(MAX_DEV_LIST, deviantTotal),
    decisions,
    correct,
    correct_pct: decisions ? Math.round((1000 * correct) / decisions) / 10 : 100,
    open_decisions: openDec,
    open_correct: openCor,
    open_pct: openDec ? Math.round((1000 * openCor) / openDec) / 10 : 100,
    play_decisions: playDec,
    play_correct: playCor,
    play_pct: playDec ? Math.round((1000 * playCor) / playDec) / 10 : 100,
    opens,
    by_spot,
    by_position,
    by_branch,
    chart_errors,
    deviations,
    leak_finder: {
      missed_profit_money: Math.round(missedEvTotal * 100) / 100,
      critical_errors: criticalTotal,
      insights: [],
      heat: [],
    },
  };
}

/**
 * Chart/branch comparison only (like Math tab) — does not rebuild HUD/session.
 */
export async function buildLocalChartDeviations(
  strategyId: string,
  onProgress?: (message: string) => void,
): Promise<{ deviations: StrategyDeviationsResponse; spots: StrategySpot[]; hands: number }> {
  onProgress?.("Проверяем стратегию…");
  await yieldToUi();

  // Hands first — show N/N counter immediately (same feel as Math tab).
  const hands = await listHandsForStrategy(strategyId);
  const total = hands.length;
  if (total > 0) {
    onProgress?.(`Разбор сессии… 0 / ${total.toLocaleString("ru-RU")}`);
  } else {
    onProgress?.("Нет раздач в сессии");
  }
  await yieldToUi();

  // Sync constructor BEFORE cache check — otherwise edited charts still look "fresh".
  onProgress?.("Сверяем ветки конструктора…");
  await yieldToUi();
  try {
    await ensureConstructorChartsSynced(strategyId);
  } catch {
    /* offline — score whatever painted spots remain */
  }

  // Fast path: reuse cached strategy compare when hands + charts fingerprint match.
  const chartsRev = readChartsRevision(strategyId);
  const cached = peekAnalysisCache(strategyId);
  const cachedBranches = cached?.deviations?.by_branch ?? [];
  // Reject pre-fix caches (collapsed pots / soft cross-pot error attribution).
  const potAwareCache =
    cachedBranches.length === 0 ||
    (cachedBranches.some((b) => Boolean(b.pot_kind && b.pot_tag)) &&
      (cached?.deviations?.chart_errors ?? []).every(
        (c) => !c.label || Boolean(c.pot_kind),
      ));
  if (
    cached &&
    cached.deviations &&
    potAwareCache &&
    (cachedBranches.length > 0 || (cached.deviations.deviations?.length ?? 0) > 0) &&
    cached.handTotal === total &&
    cached.chartsRev === chartsRev &&
    chartsRev != null &&
    total > 0 &&
    // Bust soft-pot compare caches from before strictPot grouping.
    cached.chartCompareVer === CHART_COMPARE_VER
  ) {
    onProgress?.("Готово (кэш)");
    return {
      deviations: cached.deviations,
      spots: cached.spots ?? [],
      hands: total,
    };
  }

  let spots: StrategySpot[] = [];
  try {
    spots = await listSpots(strategyId);
  } catch {
    spots = [];
  }

  const deviations = await buildDeviations(strategyId, hands, spots, (p) => {
    onProgress?.(p.message);
  });

  let strategyUpdatedAt: string | null = null;
  try {
    strategyUpdatedAt = (await getStrategy(strategyId)).updated_at ?? null;
  } catch {
    strategyUpdatedAt = null;
  }

  // Cache write off the critical path — stringify can freeze the counter at the end.
  const existingCache = peekAnalysisCache(strategyId);
  if (existingCache?.analysis) {
    const rate =
      existingCache.analysis.curve.length && deviations.decisions
        ? Math.round((10000 * (deviations.correct || 0)) / deviations.decisions) / 100
        : null;
    const nextChartsRev = readChartsRevision(strategyId);
    window.setTimeout(() => {
      const latest = peekAnalysisCache(strategyId);
      if (!latest?.analysis) return;
      if (rate != null) {
        for (const pt of latest.analysis.curve) pt.compliance_rate = rate;
      }
      writeAnalysisCache(strategyId, {
        ...latest,
        deviations,
        spots,
        chartsRev: nextChartsRev,
        strategyUpdatedAt,
        chartCompareVer: CHART_COMPARE_VER,
      });
    }, 0);
  }

  return { deviations, spots, hands: hands.length };
}

/**
 * F5 / reopen: rebuild HUD from IndexedDB only. No constructor sync, no
 * strategy compare — that runs when the user opens «Стратегии».
 */
export async function restoreLocalSessionReport(
  strategyId: string,
): Promise<{ hands: number } | null> {
  const hands = await listHandsForStrategy(strategyId);
  if (!hands.length) return null;
  const analysis = buildAnalysis(strategyId, hands);
  const prev = peekAnalysisCache(strategyId);
  writeAnalysisCache(strategyId, {
    fingerprint: `local:${strategyId}:${hands.length}:restore`,
    analysis,
    deviations: prev?.deviations ?? {
      strategy_id: strategyId,
      total: 0,
      decisions: 0,
      correct: 0,
      correct_pct: 100,
      open_decisions: 0,
      open_correct: 0,
      open_pct: 100,
      play_decisions: 0,
      play_correct: 0,
      play_pct: 100,
      opens: {
        decisions: 0,
        opened: 0,
        folded: 0,
        called: 0,
        should_open: 0,
        opened_correct: 0,
        missed_opens: 0,
        should_fold: 0,
        folded_correct: 0,
        wrong_opens: 0,
        open_follow_pct: 100,
        fold_follow_pct: 100,
        accuracy_pct: 100,
      },
      by_spot: [],
      by_position: [],
      by_branch: [],
      chart_errors: [],
      deviations: [],
      leak_finder: {
        missed_profit_money: 0,
        critical_errors: 0,
        insights: [],
        heat: [],
      },
    },
    spots: prev?.spots ?? [],
    missing: prev?.missing ?? [],
    handTotal: hands.length,
    chartsRev: prev?.chartsRev ?? readChartsRevision(strategyId),
    strategyUpdatedAt: prev?.strategyUpdatedAt ?? null,
  });
  return { hands: hands.length };
}

export async function finalizeLocalAnalysis(
  strategyId: string,
  onProgress?: (p: ProgressPayload) => void,
): Promise<{ hands: number }> {
  clearLocalRecommendationsCache();
  onProgress?.({
    done: 0,
    total: 1,
    phase: "hud",
    message: "Собираем HUD и график…",
    pct: 85,
  });

  const hands = await listHandsForStrategy(strategyId);
  const analysis = buildAnalysis(strategyId, hands);

  onProgress?.({
    done: 0,
    total: 1,
    phase: "deviations",
    message: "Сверяем ветки конструктора…",
    pct: 88,
  });
  try {
    await ensureConstructorChartsSynced(strategyId);
  } catch {
    /* offline */
  }

  onProgress?.({
    done: 0,
    total: 1,
    phase: "deviations",
    message: "Проверяем стратегию…",
    pct: 90,
  });

  let spots: StrategySpot[] = [];
  try {
    spots = await listSpots(strategyId);
  } catch {
    spots = [];
  }

  const deviations = await buildDeviations(strategyId, hands, spots, onProgress);

  if (analysis.curve.length && deviations.decisions) {
    const rate =
      Math.round((10000 * (deviations.correct || 0)) / deviations.decisions) / 100;
    for (const pt of analysis.curve) pt.compliance_rate = rate;
  }

  let strategyUpdatedAt: string | null = null;
  try {
    strategyUpdatedAt = (await getStrategy(strategyId)).updated_at ?? null;
  } catch {
    strategyUpdatedAt = null;
  }

  writeAnalysisCache(strategyId, {
    fingerprint: `local:${strategyId}:${hands.length}:${Date.now()}`,
    analysis,
    deviations,
    spots,
    missing: [],
    handTotal: hands.length,
    chartsRev: readChartsRevision(strategyId),
    strategyUpdatedAt,
    chartCompareVer: CHART_COMPARE_VER,
  });

  onProgress?.({
    done: hands.length,
    total: hands.length || 1,
    phase: "done",
    message: `Отчёт готов · ${hands.length.toLocaleString("ru-RU")} рук`,
    pct: 95,
  });

  return { hands: hands.length };
}
